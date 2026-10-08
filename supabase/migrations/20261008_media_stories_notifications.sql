-- Chat media (images + voice), real stories (photo/text/question/poll) with
-- responses + views, notifications populated by triggers, Friday answer.
-- RLS everywhere; helper functions live in a non-exposed `private` schema.

------------------------------------------------------------------------------
-- 0. private helpers
------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conversation_id is not null and exists (
    select 1
    from public.conversations c
    join public.matches m on m.id = c.match_id
    where c.id = p_conversation_id
      and ((select auth.uid()) in (m.user_a, m.user_b))
  );
$$;

create or replace function private.are_matched(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.matches m
    where (m.user_a = a and m.user_b = b) or (m.user_a = b and m.user_b = a)
  );
$$;

-- Can the current user see content (stories) authored by p_author?
-- Self; otherwise not blocked either way AND (matched OR author discoverable).
create or replace function private.can_see_user(p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    p_author = (select auth.uid())
    or (
      not public.is_blocked_either_way(p_author, (select auth.uid()))
      and (
        private.are_matched(p_author, (select auth.uid()))
        or exists (select 1 from public.profiles p where p.id = p_author and p.is_discoverable)
      )
    )
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.try_uuid(text) to authenticated;
grant execute on function private.is_conversation_member(uuid) to authenticated;
grant execute on function private.are_matched(uuid, uuid) to authenticated;
grant execute on function private.can_see_user(uuid) to authenticated;

------------------------------------------------------------------------------
-- 1. chat media
------------------------------------------------------------------------------
alter table public.messages
  add column if not exists media_path text,
  add column if not exists duration_ms integer,
  add column if not exists waveform jsonb;

alter table public.messages drop constraint if exists messages_shape_check;
alter table public.messages add constraint messages_shape_check check (
  (type = 'text' and content is not null and char_length(content) between 1 and 4000 and media_path is null)
  or (
    type in ('image', 'voice')
    and media_path is not null
    and media_path like conversation_id::text || '/' || sender_id::text || '/%'
    and (content is null or char_length(content) <= 500)
  )
);
alter table public.messages drop constraint if exists messages_voice_meta_check;
alter table public.messages add constraint messages_voice_meta_check check (
  (duration_ms is null or duration_ms between 0 and 600000)
  and (waveform is null or (jsonb_typeof(waveform) = 'array' and jsonb_array_length(waveform) <= 64))
);

-- Participants may only flip read_at (previously they could edit any column).
revoke update on public.messages from anon, authenticated;
grant update (read_at) on public.messages to authenticated;

-- Private bucket; objects at {conversation_id}/{sender_id}/{file}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif',
        'audio/m4a','audio/x-m4a','audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/3gpp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat media readable by conversation members" on storage.objects;
create policy "chat media readable by conversation members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and private.is_conversation_member(private.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists "chat media uploadable by sender in own conversation" on storage.objects;
create policy "chat media uploadable by sender in own conversation" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.is_conversation_member(private.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists "chat media deletable by sender" on storage.objects;
create policy "chat media deletable by sender" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

------------------------------------------------------------------------------
-- 2. stories
------------------------------------------------------------------------------
alter table public.stories add column if not exists media_path text;
alter table public.stories drop constraint if exists stories_type_check;
alter table public.stories add constraint stories_type_check
  check (type in ('photo', 'text', 'question', 'poll'));
alter table public.stories drop constraint if exists stories_shape_check;
alter table public.stories add constraint stories_shape_check check (
  pg_column_size(content) < 4000
  and (
    (type = 'photo' and media_path is not null and media_path like user_id::text || '/%')
    or (type in ('text', 'question') and media_path is null
        and char_length(coalesce(content->>'text', content->>'question', '')) between 1 and 280)
    or (type = 'poll' and media_path is null
        and char_length(coalesce(content->>'question', '')) between 1 and 280
        and jsonb_typeof(content->'options') = 'array'
        and jsonb_array_length(content->'options') between 2 and 4)
  )
);

create index if not exists stories_user_created_idx on public.stories (user_id, created_at desc);
create index if not exists stories_expires_idx on public.stories (expires_at);

-- Server-controlled 24h window.
create or replace function private.stories_set_window()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  return new;
end;
$$;
drop trigger if exists stories_set_window on public.stories;
create trigger stories_set_window before insert on public.stories
  for each row execute function private.stories_set_window();

drop policy if exists "stories are viewable by authenticated users until they expire" on public.stories;
drop policy if exists "users manage only their own stories" on public.stories;
drop policy if exists "stories visible for 24h to permitted viewers" on public.stories;
drop policy if exists "users create their own stories" on public.stories;
drop policy if exists "users delete their own stories" on public.stories;

create policy "stories visible for 24h to permitted viewers" on public.stories
  for select to authenticated
  using (
    expires_at > now()
    and created_at > now() - interval '24 hours'
    and private.can_see_user(user_id)
  );
create policy "users create their own stories" on public.stories
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "users delete their own stories" on public.stories
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- views: may only record a view of a story you can see
drop policy if exists "users can record only their own view" on public.story_views;
create policy "users can record only their own view" on public.story_views
  for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (select 1 from public.stories s where s.id = story_id)
  );

-- responses: poll votes, question answers, replies, likes
create table if not exists public.story_responses (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  responder_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('vote', 'answer', 'reply', 'like')),
  option_index smallint check (option_index between 0 and 3),
  body text check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint story_responses_shape_check check (
    (kind = 'vote' and option_index is not null and body is null)
    or (kind in ('answer', 'reply') and body is not null and option_index is null)
    or (kind = 'like' and body is null and option_index is null)
  )
);
create unique index if not exists story_responses_one_vote_like
  on public.story_responses (story_id, responder_id, kind) where kind in ('vote', 'like');
create index if not exists story_responses_story_idx on public.story_responses (story_id);
create index if not exists story_responses_responder_idx on public.story_responses (responder_id);

alter table public.story_responses enable row level security;

drop policy if exists "responders and story owners read responses" on public.story_responses;
create policy "responders and story owners read responses" on public.story_responses
  for select to authenticated
  using (
    responder_id = (select auth.uid())
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "users respond to visible stories as themselves" on public.story_responses;
create policy "users respond to visible stories as themselves" on public.story_responses
  for insert to authenticated
  with check (
    responder_id = (select auth.uid())
    and exists (
      select 1 from public.stories s
      where s.id = story_id
        and (
          (kind = 'vote' and s.type = 'poll'
             and option_index < jsonb_array_length(s.content->'options'))
          or (kind = 'answer' and s.type = 'question')
          or kind in ('reply', 'like')
        )
    )
  );

drop policy if exists "users delete their own responses" on public.story_responses;
create policy "users delete their own responses" on public.story_responses
  for delete to authenticated
  using (responder_id = (select auth.uid()));

-- Aggregate poll results without exposing who voted for what.
create or replace function public.get_story_poll_counts(p_story_id uuid)
returns table (option_index smallint, votes bigint)
language sql stable security definer set search_path = '' as $$
  select r.option_index, count(*)::bigint
  from public.story_responses r
  join public.stories s on s.id = r.story_id
  where r.story_id = p_story_id
    and r.kind = 'vote'
    and s.expires_at > now()
    and private.can_see_user(s.user_id)
  group by r.option_index;
$$;
revoke all on function public.get_story_poll_counts(uuid) from public, anon;
grant execute on function public.get_story_poll_counts(uuid) to authenticated;

-- Story images: private bucket, objects at {user_id}/{file}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-media', 'story-media', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "story media readable when story visible" on storage.objects;
create policy "story media readable when story visible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'story-media'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.stories s where s.media_path = objects.name)
    )
  );

drop policy if exists "users upload own story media" on storage.objects;
create policy "users upload own story media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "users delete own story media" on storage.objects;
create policy "users delete own story media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Hourly cleanup of expired story rows (views/responses cascade).
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-expired-stories';
select cron.schedule(
  'purge-expired-stories',
  '17 * * * *',
  $$delete from public.stories where expires_at < now() - interval '1 hour'$$
);

------------------------------------------------------------------------------
-- 3. notifications
------------------------------------------------------------------------------
alter table public.notifications
  add column if not exists actor_id uuid references public.profiles(id) on delete cascade,
  add column if not exists pushed_at timestamptz;
alter table public.notifications alter column payload set default '{}'::jsonb;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('match', 'message', 'post_like', 'comment', 'story_reply'));

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_actor_idx on public.notifications (actor_id);

-- Users may only flip read_at on their own rows (policy already scopes rows).
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "users can mark only their own notifications read" on public.notifications;
create policy "users can mark only their own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function private.add_notification(p_user uuid, p_actor uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  if p_actor is not null and public.is_blocked_either_way(p_user, p_actor) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (p_user, p_actor, p_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function private.on_match_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.add_notification(new.user_a, new.user_b, 'match', jsonb_build_object('match_id', new.id));
  perform private.add_notification(new.user_b, new.user_a, 'match', jsonb_build_object('match_id', new.id));
  return new;
end;
$$;

create or replace function private.on_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_other uuid;
  v_preview text;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
    into v_other
  from public.conversations c
  join public.matches m on m.id = c.match_id
  where c.id = new.conversation_id;

  if v_other is null then
    return new;
  end if;

  v_preview := case new.type
    when 'image' then '📷 Photo'
    when 'voice' then '🎤 Voice message'
    else left(coalesce(new.content, ''), 120)
  end;

  -- Collapse a burst of messages into the existing unread notification.
  update public.notifications n
     set payload = jsonb_build_object(
           'conversation_id', new.conversation_id,
           'message_id', new.id,
           'preview', v_preview,
           'count', coalesce((n.payload->>'count')::int, 1) + 1),
         created_at = now(),
         pushed_at = null
   where n.user_id = v_other
     and n.actor_id = new.sender_id
     and n.type = 'message'
     and n.read_at is null
     and n.payload->>'conversation_id' = new.conversation_id::text;

  if not found then
    perform private.add_notification(v_other, new.sender_id, 'message', jsonb_build_object(
      'conversation_id', new.conversation_id,
      'message_id', new.id,
      'preview', v_preview,
      'count', 1));
  end if;
  return new;
end;
$$;

create or replace function private.on_post_like_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_preview text;
begin
  select p.user_id, left(coalesce(p.content, ''), 80) into v_owner, v_preview
  from public.posts p where p.id = new.post_id;
  if v_owner is null then
    return new;
  end if;
  -- Unlike/relike must not spam.
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_owner and n.actor_id = new.user_id and n.type = 'post_like'
      and n.payload->>'post_id' = new.post_id::text
  ) then
    return new;
  end if;
  perform private.add_notification(v_owner, new.user_id, 'post_like',
    jsonb_build_object('post_id', new.post_id, 'preview', v_preview));
  return new;
end;
$$;

create or replace function private.on_comment_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  select p.user_id into v_owner from public.posts p where p.id = new.post_id;
  perform private.add_notification(v_owner, new.user_id, 'comment', jsonb_build_object(
    'post_id', new.post_id, 'comment_id', new.id, 'preview', left(coalesce(new.content, ''), 120)));
  return new;
end;
$$;

create or replace function private.on_story_response_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if new.kind not in ('reply', 'answer') then
    return new;
  end if;
  select s.user_id into v_owner from public.stories s where s.id = new.story_id;
  perform private.add_notification(v_owner, new.responder_id, 'story_reply', jsonb_build_object(
    'story_id', new.story_id, 'response_id', new.id, 'kind', new.kind,
    'preview', left(coalesce(new.body, ''), 120)));
  return new;
end;
$$;

revoke all on function private.add_notification(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.on_match_notify() from public, anon, authenticated;
revoke all on function private.on_message_notify() from public, anon, authenticated;
revoke all on function private.on_post_like_notify() from public, anon, authenticated;
revoke all on function private.on_comment_notify() from public, anon, authenticated;
revoke all on function private.on_story_response_notify() from public, anon, authenticated;
revoke all on function private.stories_set_window() from public, anon, authenticated;

drop trigger if exists on_match_notify on public.matches;
create trigger on_match_notify after insert on public.matches
  for each row execute function private.on_match_notify();
drop trigger if exists on_message_notify on public.messages;
create trigger on_message_notify after insert on public.messages
  for each row execute function private.on_message_notify();
drop trigger if exists on_post_like_notify on public.post_likes;
create trigger on_post_like_notify after insert on public.post_likes
  for each row execute function private.on_post_like_notify();
drop trigger if exists on_comment_notify on public.comments;
create trigger on_comment_notify after insert on public.comments
  for each row execute function private.on_comment_notify();
drop trigger if exists on_story_response_notify on public.story_responses;
create trigger on_story_response_notify after insert on public.story_responses
  for each row execute function private.on_story_response_notify();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

------------------------------------------------------------------------------
-- 4. onboarding "Perfect Friday night?" answer
------------------------------------------------------------------------------
alter table public.profiles add column if not exists friday_answer text;
alter table public.profiles drop constraint if exists profiles_friday_answer_check;
alter table public.profiles add constraint profiles_friday_answer_check
  check (friday_answer is null or char_length(friday_answer) <= 120);
