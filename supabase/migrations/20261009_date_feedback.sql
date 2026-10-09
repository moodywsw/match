-- Differentiator 3: post-date feedback + trust signal + safety.
-- "We met" (either side) → private feedback (never shown publicly) → aggregated
-- "Real photos — verified by dates" badge; negative feedback files a report automatically.

------------------------------------------------------------------------------
-- 0. report categories for automatic post-date reports
------------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_shape_check;
alter table public.reports add constraint reports_shape_check check (
  category = any (array['spam', 'harassment', 'inappropriate', 'fake_profile', 'underage', 'scam', 'other', 'app_problem',
                        'date_unsafe', 'not_as_pictured'])
  and (details is null or char_length(details) <= 1000)
  and (reported_id is null or reported_id <> reporter_id)
  and (reported_id is not null or category = 'app_problem')
  and (resolution is null or resolution = any (array['dismissed', 'actioned', 'unhidden'])));

------------------------------------------------------------------------------
-- 1. tables
------------------------------------------------------------------------------
create table if not exists public.date_confirmations (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  prompted_at timestamptz,
  primary key (match_id, user_id)
);
create index if not exists date_confirmations_user_idx on public.date_confirmations (user_id);
alter table public.date_confirmations enable row level security;
revoke all on public.date_confirmations from anon, authenticated;
grant select on public.date_confirmations to authenticated;
drop policy if exists "match participants see we-met marks" on public.date_confirmations;
create policy "match participants see we-met marks" on public.date_confirmations
  for select to authenticated using (exists (
    select 1 from public.matches m
     where m.id = date_confirmations.match_id and (select auth.uid()) in (m.user_a, m.user_b)));

-- Private: only the rater can read their own row; the person rated never can.
create table if not exists public.date_feedback (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  rater_id uuid not null references public.profiles(id) on delete cascade,
  ratee_id uuid not null references public.profiles(id) on delete cascade,
  looked_like_photos text not null check (looked_like_photos in ('yes', 'mostly', 'no')),
  felt_safe boolean not null,
  meet_again text not null check (meet_again in ('yes', 'maybe', 'no')),
  note text check (note is null or char_length(note) <= 1000),
  report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (match_id, rater_id),
  check (rater_id <> ratee_id)
);
create index if not exists date_feedback_ratee_idx on public.date_feedback (ratee_id);
alter table public.date_feedback enable row level security;
revoke all on public.date_feedback from anon, authenticated;
grant select on public.date_feedback to authenticated;
drop policy if exists "raters see only their own feedback" on public.date_feedback;
create policy "raters see only their own feedback" on public.date_feedback
  for select to authenticated using (rater_id = (select auth.uid()));

------------------------------------------------------------------------------
-- 2. "We met"
------------------------------------------------------------------------------
create or replace function private.mark_we_met(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches;
  v_other uuid;
  v_new boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_m from public.matches where id = p_match_id;
  if not found or v_uid not in (v_m.user_a, v_m.user_b) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  v_other := case when v_m.user_a = v_uid then v_m.user_b else v_m.user_a end;
  if public.is_blocked_either_way(v_uid, v_other) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('we_met_day', 20, interval '1 day');

  insert into public.date_confirmations (match_id, user_id) values (p_match_id, v_uid)
  on conflict do nothing;
  v_new := found;
  -- A date happened: the chat should not expire under them.
  update public.match_lifecycle
     set state = 'active', expiring_at = null, expires_at = null, updated_at = now()
   where match_id = p_match_id and state = 'expiring';
  if v_new and not exists (select 1 from public.date_confirmations d where d.match_id = p_match_id and d.user_id = v_other) then
    perform private.add_notification(v_other, v_uid, 'we_met', jsonb_build_object(
      'match_id', p_match_id,
      'conversation_id', (select c.id from public.conversations c where c.match_id = p_match_id)));
  end if;
  return jsonb_build_object(
    'me', true,
    'them', exists (select 1 from public.date_confirmations d where d.match_id = p_match_id and d.user_id = v_other),
    'notified', v_new);
end;
$$;
revoke all on function private.mark_we_met(uuid) from public, anon;
grant execute on function private.mark_we_met(uuid) to authenticated;
create or replace function public.mark_we_met(p_match_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.mark_we_met(p_match_id) $$;
revoke all on function public.mark_we_met(uuid) from public, anon;
grant execute on function public.mark_we_met(uuid) to authenticated;

------------------------------------------------------------------------------
-- 3. private feedback (allowed after *I* marked "We met" — even if they never
--    confirm or I blocked them since: safety reports must always get through)
------------------------------------------------------------------------------
create or replace function private.submit_date_feedback(
  p_match_id uuid, p_looked_like_photos text, p_felt_safe boolean, p_meet_again text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches;
  v_other uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_report uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_m from public.matches where id = p_match_id;
  if not found or v_uid not in (v_m.user_a, v_m.user_b) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  v_other := case when v_m.user_a = v_uid then v_m.user_b else v_m.user_a end;
  if not exists (select 1 from public.date_confirmations d where d.match_id = p_match_id and d.user_id = v_uid) then
    raise exception 'mark_met_first' using errcode = 'P0001';
  end if;
  if p_looked_like_photos is null or p_looked_like_photos not in ('yes', 'mostly', 'no')
     or p_felt_safe is null or p_meet_again is null or p_meet_again not in ('yes', 'maybe', 'no')
     or char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'invalid_feedback' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('date_feedback_day', 10, interval '1 day');

  insert into public.date_feedback (match_id, rater_id, ratee_id, looked_like_photos, felt_safe, meet_again, note)
  values (p_match_id, v_uid, v_other, p_looked_like_photos, p_felt_safe, p_meet_again, v_note)
  on conflict (match_id, rater_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'already_submitted' using errcode = 'P0001'; end if;

  -- Negative feedback goes to the moderation queue automatically.
  if p_looked_like_photos = 'no' or not p_felt_safe then
    insert into public.reports (reporter_id, reported_id, category, details)
    values (v_uid, v_other,
            case when not p_felt_safe then 'date_unsafe' else 'not_as_pictured' end,
            left('Post-date feedback: '
                 || case when not p_felt_safe then 'did not feel safe' else 'felt safe' end
                 || '; photos: ' || p_looked_like_photos
                 || coalesce(E'\nNote: ' || v_note, ''), 1000))
    returning id into v_report;
    update public.date_feedback set report_id = v_report where id = v_id;
  end if;
  update public.date_confirmations set prompted_at = coalesce(prompted_at, now())
   where match_id = p_match_id and user_id = v_uid;
  return v_id;
end;
$$;
revoke all on function private.submit_date_feedback(uuid, text, boolean, text, text) from public, anon;
grant execute on function private.submit_date_feedback(uuid, text, boolean, text, text) to authenticated;
create or replace function public.submit_date_feedback(
  p_match_id uuid, p_looked_like_photos text, p_felt_safe boolean, p_meet_again text, p_note text default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.submit_date_feedback(p_match_id, p_looked_like_photos, p_felt_safe, p_meet_again, p_note) $$;
revoke all on function public.submit_date_feedback(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.submit_date_feedback(uuid, text, boolean, text, text) to authenticated;

------------------------------------------------------------------------------
-- 4. trust signal: "Real photos — verified by dates". Only a boolean leaves the DB.
--    Counts distinct raters on matches where BOTH sides confirmed the date,
--    who said photos matched (yes/mostly) AND felt safe; negatives must stay rare.
------------------------------------------------------------------------------
create or replace function private.real_photos_verified(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with f as (
    select f.rater_id, f.looked_like_photos, f.felt_safe
      from public.date_feedback f
      join public.profiles r on r.id = f.rater_id and r.hidden_at is null
     where f.ratee_id = p_user
       and exists (select 1 from public.date_confirmations d where d.match_id = f.match_id and d.user_id = p_user)
  )
  select count(distinct rater_id) filter (where looked_like_photos in ('yes', 'mostly') and felt_safe)
           >= private.setting_num('real_photos_badge_min', 3)
     and count(*) filter (where looked_like_photos = 'no' or not felt_safe) * 3
           < greatest(1, count(*) filter (where looked_like_photos in ('yes', 'mostly') and felt_safe))
  from f;
$$;

create or replace function private.trust_badges(p_ids uuid[])
returns table (user_id uuid, real_photos boolean)
language sql stable security definer set search_path = '' as $$
  select x.id, private.real_photos_verified(x.id)
    from (select distinct unnest(p_ids[1:100]) as id) x
   where (select auth.uid()) is not null and private.visible_person(x.id);
$$;
revoke all on function private.trust_badges(uuid[]) from public, anon;
grant execute on function private.trust_badges(uuid[]) to authenticated;
create or replace function public.get_trust_badges(p_ids uuid[])
returns table (user_id uuid, real_photos boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.trust_badges(p_ids) $$;
revoke all on function public.get_trust_badges(uuid[]) from public, anon;
grant execute on function public.get_trust_badges(uuid[]) to authenticated;

------------------------------------------------------------------------------
-- 5. feedback prompt: 24h after BOTH confirmed, ask each side that hasn't answered
------------------------------------------------------------------------------
create or replace function private.date_feedback_tick()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
  v_after interval := make_interval(hours => private.setting_num('date_feedback_prompt_hours', 24)::integer);
begin
  for r in
    select d.match_id, d.user_id, o.user_id as other_id
      from public.date_confirmations d
      join public.date_confirmations o on o.match_id = d.match_id and o.user_id <> d.user_id
     where d.prompted_at is null
       and greatest(d.created_at, o.created_at) < now() - v_after
       and not exists (select 1 from public.date_feedback f where f.match_id = d.match_id and f.rater_id = d.user_id)
     limit 500
     for update of d skip locked
  loop
    update public.date_confirmations set prompted_at = now() where match_id = r.match_id and user_id = r.user_id;
    perform private.add_notification(r.user_id, r.other_id, 'date_feedback', jsonb_build_object(
      'match_id', r.match_id,
      'conversation_id', (select c.id from public.conversations c where c.match_id = r.match_id)));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.date_feedback_tick() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 6. schedule: every 10 min run the ticks, then ask send-push to deliver the
--    system notifications they wrote (bearer = public anon JWT from Vault).
------------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'match-lifecycle';
select cron.schedule('match-lifecycle', '*/10 * * * *', $cron$
  select private.match_lifecycle_tick();
  select private.date_feedback_tick();
  select net.http_post(
    url := 'https://pkpdheytmbwvqhpcaigm.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'match_cron_anon_key'), '')),
    body := '{"system_sweep": true}'::jsonb,
    timeout_milliseconds := 30000);
$cron$);
