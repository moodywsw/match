-- Video stories, server-side subscriptions/entitlements (RevenueCat webhook is
-- the only writer), premium gating enforced in the DB, 18+ age gate, and FK
-- fixes so account deletion can cascade cleanly.

------------------------------------------------------------------------------
-- 1. video stories
------------------------------------------------------------------------------
alter table public.stories
  add column if not exists duration_ms integer,
  add column if not exists thumb_path text;

alter table public.stories drop constraint if exists stories_type_check;
alter table public.stories add constraint stories_type_check
  check (type in ('photo', 'video', 'text', 'question', 'poll'));

alter table public.stories drop constraint if exists stories_shape_check;
alter table public.stories add constraint stories_shape_check check (
  pg_column_size(content) < 4000
  and (thumb_path is null or thumb_path like user_id::text || '/%')
  and (
    (type = 'photo' and media_path is not null and media_path like user_id::text || '/%')
    or (type = 'video' and media_path is not null and media_path like user_id::text || '/%'
        and duration_ms between 500 and 31000)
    or (type in ('text', 'question') and media_path is null
        and char_length(coalesce(content->>'text', content->>'question', '')) between 1 and 280)
    or (type = 'poll' and media_path is null
        and char_length(coalesce(content->>'question', '')) between 1 and 280
        and jsonb_typeof(content->'options') = 'array'
        and jsonb_array_length(content->'options') between 2 and 4)
  )
);

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif',
                                  'video/mp4','video/quicktime']
 where id = 'story-media';

drop policy if exists "story media readable when story visible" on storage.objects;
create policy "story media readable when story visible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'story-media'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.stories s
        where s.media_path = objects.name or s.thumb_path = objects.name
      )
    )
  );

------------------------------------------------------------------------------
-- 2. subscriptions / payments — written only by the revenuecat-webhook
--    Edge Function (service role). Clients can read their own rows.
------------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists product_id text,
  add column if not exists environment text,
  add column if not exists will_renew boolean,
  add column if not exists original_transaction_id text,
  add column if not exists last_event_id text,
  add column if not exists last_event_type text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.subscriptions drop constraint if exists subscriptions_store_check;
alter table public.subscriptions add constraint subscriptions_store_check
  check (store in ('app_store', 'play_store', 'amazon', 'stripe', 'promotional', 'test_store', 'other'));

create unique index if not exists subscriptions_user_tier_key on public.subscriptions (user_id, tier);

alter table public.payments
  add column if not exists product_id text,
  add column if not exists environment text,
  add column if not exists event_id text;
create unique index if not exists payments_event_id_key on public.payments (event_id);
create index if not exists payments_user_idx on public.payments (user_id);
create index if not exists payments_subscription_idx on public.payments (subscription_id);

-- Defense in depth on top of RLS (no write policies exist): API roles may
-- only read, and anon nothing at all.
revoke all on public.subscriptions from anon;
revoke all on public.payments from anon;
revoke insert, update, delete, truncate, references, trigger on public.subscriptions from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.payments from authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.payments to authenticated;

drop policy if exists "users can view only their own subscription" on public.subscriptions;
create policy "users can view only their own subscription" on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "users can view only their own payments" on public.payments;
create policy "users can view only their own payments" on public.payments
  for select to authenticated using (user_id = (select auth.uid()));

-- Realtime so the app flips to premium as soon as the webhook lands.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subscriptions'
  ) then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
end;
$$;

-- Active tier for a user ('super_match' > 'match_plus' > 'free').
-- Cancelled subscriptions stay valid until current_period_end.
create or replace function private.active_tier(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.tier
    from public.subscriptions s
    where s.user_id = p_user
      and s.status in ('active', 'canceled', 'in_grace_period')
      and (s.current_period_end is null or s.current_period_end > now())
    order by (s.tier = 'super_match') desc
    limit 1
  ), 'free');
$$;
revoke all on function private.active_tier(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. premium gating enforced server-side
------------------------------------------------------------------------------
-- Free: 25 likes / rolling 24h, 1 super like / 24h.
-- MATCH+: unlimited likes, 5 super likes / 24h. SUPER MATCH: unlimited.
create or replace function private.enforce_like_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tier text := private.active_tier(new.liker_id);
  v_likes int;
  v_supers int;
begin
  if v_tier = 'super_match' then
    return new;
  end if;
  if new.is_super_like then
    select count(*) into v_supers from public.likes
     where liker_id = new.liker_id and is_super_like and created_at > now() - interval '24 hours';
    if v_supers >= (case when v_tier = 'match_plus' then 5 else 1 end) then
      raise exception 'super_like_limit' using errcode = 'P0001',
        hint = 'Upgrade for more super likes';
    end if;
  end if;
  if v_tier = 'free' then
    select count(*) into v_likes from public.likes
     where liker_id = new.liker_id and created_at > now() - interval '24 hours';
    if v_likes >= 25 then
      raise exception 'daily_like_limit' using errcode = 'P0001',
        hint = 'MATCH+ unlocks unlimited likes';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_like_limits() from public, anon, authenticated;
drop trigger if exists enforce_like_limits on public.likes;
create trigger enforce_like_limits before insert on public.likes
  for each row execute function private.enforce_like_limits();
create index if not exists likes_liker_created_idx on public.likes (liker_id, created_at desc);

-- "See who liked you" is a MATCH+ feature: incoming likes are no longer
-- readable directly; use the RPCs below.
drop policy if exists "users see only likes they sent or received" on public.likes;
drop policy if exists "users see only likes they sent" on public.likes;
create policy "users see only likes they sent" on public.likes
  for select to authenticated using (liker_id = (select auth.uid()));

create or replace function private.likes_received_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.likes l
  where l.liked_id = (select auth.uid())
    and not exists (select 1 from public.likes back where back.liker_id = l.liked_id and back.liked_id = l.liker_id)
    and not public.is_blocked_either_way(l.liker_id, l.liked_id);
$$;

create or replace function private.likes_received()
returns table (liker_id uuid, name text, birth_date date, city text, is_super_like boolean, liked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.active_tier((select auth.uid())) = 'free' then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'MATCH+ shows who liked you';
  end if;
  return query
    select l.liker_id, p.name, p.birth_date, p.city, l.is_super_like, l.created_at
    from public.likes l
    join public.profiles p on p.id = l.liker_id
    where l.liked_id = (select auth.uid())
      and not exists (select 1 from public.likes back where back.liker_id = l.liked_id and back.liked_id = l.liker_id)
      and not public.is_blocked_either_way(l.liker_id, l.liked_id)
    order by l.is_super_like desc, l.created_at desc
    limit 100;
end;
$$;

create or replace function private.my_tier()
returns text language sql stable security definer set search_path = '' as $$
  select private.active_tier((select auth.uid()));
$$;

revoke all on function private.likes_received_count() from public, anon;
revoke all on function private.likes_received() from public, anon;
revoke all on function private.my_tier() from public, anon;
grant execute on function private.likes_received_count() to authenticated;
grant execute on function private.likes_received() to authenticated;
grant execute on function private.my_tier() to authenticated;

create or replace function public.get_likes_received_count()
returns integer language sql stable security invoker set search_path = '' as $$
  select private.likes_received_count();
$$;
create or replace function public.get_likes_received()
returns table (liker_id uuid, name text, birth_date date, city text, is_super_like boolean, liked_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from private.likes_received();
$$;
create or replace function public.get_my_tier()
returns text language sql stable security invoker set search_path = '' as $$
  select private.my_tier();
$$;
revoke all on function public.get_likes_received_count() from public, anon;
revoke all on function public.get_likes_received() from public, anon;
revoke all on function public.get_my_tier() from public, anon;
grant execute on function public.get_likes_received_count() to authenticated;
grant execute on function public.get_likes_received() to authenticated;
grant execute on function public.get_my_tier() to authenticated;

------------------------------------------------------------------------------
-- 4. 18+ age gate (also validated in onboarding)
------------------------------------------------------------------------------
create or replace function private.enforce_adult()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.birth_date is null or new.birth_date > (current_date - interval '18 years')::date then
    raise exception 'must_be_18' using errcode = 'P0001', hint = 'MATCH is for adults (18+) only';
  end if;
  if new.birth_date < (current_date - interval '100 years')::date then
    raise exception 'invalid_birth_date' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_adult() from public, anon, authenticated;
drop trigger if exists enforce_adult on public.profiles;
create trigger enforce_adult before insert or update of birth_date on public.profiles
  for each row execute function private.enforce_adult();

------------------------------------------------------------------------------
-- 5. FKs so deleting an auth user cascades through everything
------------------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete cascade;
alter table public.live_streams drop constraint if exists live_streams_guest_id_fkey;
alter table public.live_streams add constraint live_streams_guest_id_fkey
  foreign key (guest_id) references public.profiles(id) on delete set null;
alter table public.payments drop constraint if exists payments_subscription_id_fkey;
alter table public.payments add constraint payments_subscription_id_fkey
  foreign key (subscription_id) references public.subscriptions(id) on delete set null;
