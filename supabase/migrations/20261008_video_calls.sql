-- 1:1 video / audio calls between matches (LiveKit media, Supabase signalling).
--
-- public.calls is the signalling state machine:
--   ringing → accepted → ended
--   ringing → declined (callee said no) | missed (caller hung up / nobody answered in 45 s)
-- Clients never write it directly: every transition goes through SECURITY DEFINER
-- functions (private.*) behind SECURITY INVOKER wrappers. Realtime delivers row
-- changes to the two parties only (RLS select policy).

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('video', 'audio')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  caller_seen_at timestamptz not null default now(),
  callee_seen_at timestamptz,
  constraint calls_parties_check check (caller_id <> callee_id)
);

create index if not exists calls_caller_idx on public.calls (caller_id, created_at desc);
create index if not exists calls_callee_idx on public.calls (callee_id, created_at desc);
create index if not exists calls_conversation_idx on public.calls (conversation_id, created_at desc);
create index if not exists calls_match_idx on public.calls (match_id);
create index if not exists calls_ended_by_idx on public.calls (ended_by);
create index if not exists calls_active_idx on public.calls (status, created_at) where status in ('ringing', 'accepted');

alter table public.calls enable row level security;
revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;

drop policy if exists "call parties can see their calls" on public.calls;
create policy "call parties can see their calls" on public.calls
  for select to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Chat: call summary messages ("Missed video call", "Audio call · 3:12").
-- Only the server writes type 'call' (RLS insert check + column grants).
alter table public.messages add column if not exists call_id uuid references public.calls(id) on delete cascade;
create index if not exists messages_call_idx on public.messages (call_id);

alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('text', 'image', 'voice', 'call'));

alter table public.messages drop constraint if exists messages_shape_check;
alter table public.messages add constraint messages_shape_check check (
  (type = 'text' and content is not null and char_length(content) between 1 and 4000 and media_path is null and call_id is null)
  or (type in ('image', 'voice') and media_path is not null
      and media_path like (conversation_id::text || '/' || sender_id::text || '/%')
      and (content is null or char_length(content) <= 500) and call_id is null)
  or (type = 'call' and call_id is not null and media_path is null
      and content ~ '^(missed|declined|ended):(video|audio)$')
);

alter table public.messages drop constraint if exists messages_voice_meta_check;
alter table public.messages add constraint messages_voice_meta_check check (
  (duration_ms is null or (duration_ms >= 0 and (duration_ms <= 600000 or (type = 'call' and duration_ms <= 86400000))))
  and (waveform is null or (jsonb_typeof(waveform) = 'array' and jsonb_array_length(waveform) <= 64))
);

-- Clients may only insert the columns they need (no read_at / is_priority / created_at / call_id).
revoke insert on public.messages from authenticated;
grant insert (conversation_id, sender_id, type, content, media_path, duration_ms, waveform) on public.messages to authenticated;

drop policy if exists "only conversation participants can send messages, as themselves" on public.messages;
create policy "only conversation participants can send messages, as themselves" on public.messages
  for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and type in ('text', 'image', 'voice')
    and private.is_conversation_member(conversation_id)
  );

-- Server-written call summaries don't count against the sender's message rate limits
-- (otherwise a rate-limited user could not hang up).
drop trigger if exists rl_message_day on public.messages;
create trigger rl_message_day before insert on public.messages
  for each row when (new.type <> 'call')
  execute function private.rate_limit_trigger('message_day', '2000', '1 day');
drop trigger if exists rl_message_min on public.messages;
create trigger rl_message_min before insert on public.messages
  for each row when (new.type <> 'call')
  execute function private.rate_limit_trigger('message_min', '30', '1 minute');

-- Call summaries don't create "new message" notifications (missed calls get their own).
create or replace function private.on_message_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other uuid;
  v_preview text;
begin
  if new.type = 'call' then
    return new;
  end if;

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

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'match', 'message', 'post_like', 'comment', 'story_reply', 'super_like', 'story_like',
  'event_update', 'event_cancelled', 'missed_call', 'gift'
]));

-- ---------------------------------------------------------------------------
-- State machine helpers

/** Close a call: final status, chat summary, missed-call notification. Caller must hold the row lock. */
create or replace function private.finish_call(p_call_id uuid, p_status text, p_by uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calls;
  v_ms integer;
begin
  update public.calls
     set status = p_status, ended_at = now(), ended_by = p_by
   where id = p_call_id and status in ('ringing', 'accepted')
  returning * into c;
  if not found then
    select status into p_status from public.calls where id = p_call_id;
    return p_status;
  end if;

  v_ms := case when c.answered_at is not null
               then least(86400000, greatest(0, (extract(epoch from (c.ended_at - c.answered_at)) * 1000)::integer))
          end;

  insert into public.messages (conversation_id, sender_id, type, content, call_id, duration_ms)
  values (c.conversation_id, c.caller_id, 'call', c.status || ':' || c.kind, c.id, v_ms);

  if c.status = 'missed' then
    perform private.add_notification(c.callee_id, c.caller_id, 'missed_call', jsonb_build_object(
      'conversation_id', c.conversation_id, 'call_id', c.id, 'kind', c.kind));
  end if;
  return c.status;
end;
$$;

/** Ringing > 45 s → missed; accepted with both sides silent > 90 s → ended. */
create or replace function private.expire_calls()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, status from public.calls
     where (status = 'ringing' and created_at < now() - interval '45 seconds')
        or (status = 'accepted' and greatest(caller_seen_at, coalesce(callee_seen_at, answered_at)) < now() - interval '90 seconds')
     for update skip locked
  loop
    perform private.finish_call(r.id, case when r.status = 'ringing' then 'missed' else 'ended' end, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function private.start_call(p_conversation_id uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_match public.matches;
  v_peer uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_kind not in ('video', 'audio') then raise exception 'invalid_kind' using errcode = 'P0001'; end if;

  select m.* into v_match
    from public.conversations c join public.matches m on m.id = c.match_id
   where c.id = p_conversation_id;
  if not found or v_uid not in (v_match.user_a, v_match.user_b) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  v_peer := case when v_match.user_a = v_uid then v_match.user_b else v_match.user_a end;

  if public.is_blocked_either_way(v_uid, v_peer)
     or private.is_hidden_user(v_peer) or private.is_hidden_user(v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  perform private.hit_rate_limit('call_start_10m', 8, interval '10 minutes');
  perform private.hit_rate_limit('call_start_day', 60, interval '1 day');

  perform private.expire_calls();
  if exists (
    select 1 from public.calls
     where status in ('ringing', 'accepted')
       and (caller_id in (v_uid, v_peer) or callee_id in (v_uid, v_peer))
  ) then
    raise exception 'busy' using errcode = 'P0001';
  end if;

  insert into public.calls (match_id, conversation_id, caller_id, callee_id, kind)
  values (v_match.id, p_conversation_id, v_uid, v_peer, p_kind)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.answer_call(p_call_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.calls;
begin
  select * into c from public.calls where id = p_call_id for update;
  if not found or c.callee_id is distinct from v_uid then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if c.status <> 'ringing' then return c.status; end if;
  if c.created_at < now() - interval '45 seconds' then
    return private.finish_call(c.id, 'missed', null);
  end if;
  if not p_accept then
    return private.finish_call(c.id, 'declined', v_uid);
  end if;
  if public.is_blocked_either_way(c.caller_id, c.callee_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  update public.calls set status = 'accepted', answered_at = now(), callee_seen_at = now()
   where id = c.id;
  return 'accepted';
end;
$$;

create or replace function private.end_call(p_call_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.calls;
begin
  select * into c from public.calls where id = p_call_id for update;
  if not found or v_uid is null or v_uid not in (c.caller_id, c.callee_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if c.status = 'ringing' then
    return private.finish_call(c.id, case when v_uid = c.caller_id then 'missed' else 'declined' end, v_uid);
  elsif c.status = 'accepted' then
    return private.finish_call(c.id, 'ended', v_uid);
  end if;
  return c.status;
end;
$$;

/** Keep-alive from either party (every ~15 s); returns the current status. */
create or replace function private.call_heartbeat(p_call_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.calls;
begin
  select * into c from public.calls where id = p_call_id for update;
  if not found or v_uid is null or v_uid not in (c.caller_id, c.callee_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if c.status = 'ringing' and c.created_at < now() - interval '45 seconds' then
    return private.finish_call(c.id, 'missed', null);
  end if;
  if c.status in ('ringing', 'accepted') then
    if v_uid = c.caller_id then
      update public.calls set caller_seen_at = now() where id = c.id;
    else
      update public.calls set callee_seen_at = now() where id = c.id;
    end if;
  end if;
  return c.status;
end;
$$;

/** What the livekit-token function may sign: only the two parties, never blocked, only live calls. */
create or replace function private.get_call_token_grant(p_call_id uuid)
returns table (room text, identity text, display_name text, can_publish boolean, kind text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.calls;
begin
  select * into c from public.calls where id = p_call_id;
  if not found or v_uid is null or v_uid not in (c.caller_id, c.callee_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if public.is_blocked_either_way(c.caller_id, c.callee_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if not (c.status = 'accepted' or (c.status = 'ringing' and v_uid = c.caller_id and c.created_at > now() - interval '45 seconds')) then
    raise exception 'call_ended' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('call_token', 60, interval '1 hour');
  return query
    select 'match-call-' || c.id::text, v_uid::text,
           coalesce((select p.name from public.profiles p where p.id = v_uid), 'Member'),
           true, c.kind;
end;
$$;

revoke all on function private.finish_call(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.expire_calls() from public, anon, authenticated;
revoke all on function private.start_call(uuid, text) from public, anon;
revoke all on function private.answer_call(uuid, boolean) from public, anon;
revoke all on function private.end_call(uuid) from public, anon;
revoke all on function private.call_heartbeat(uuid) from public, anon;
revoke all on function private.get_call_token_grant(uuid) from public, anon;
grant execute on function private.start_call(uuid, text) to authenticated;
grant execute on function private.answer_call(uuid, boolean) to authenticated;
grant execute on function private.end_call(uuid) to authenticated;
grant execute on function private.call_heartbeat(uuid) to authenticated;
grant execute on function private.get_call_token_grant(uuid) to authenticated;

-- Public SECURITY INVOKER wrappers (PostgREST surface).
create or replace function public.start_call(p_conversation_id uuid, p_kind text default 'video')
returns uuid language sql security invoker set search_path = ''
as $$ select private.start_call(p_conversation_id, p_kind) $$;

create or replace function public.answer_call(p_call_id uuid, p_accept boolean)
returns text language sql security invoker set search_path = ''
as $$ select private.answer_call(p_call_id, p_accept) $$;

create or replace function public.end_call(p_call_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.end_call(p_call_id) $$;

create or replace function public.call_heartbeat(p_call_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.call_heartbeat(p_call_id) $$;

create or replace function public.get_call_token_grant(p_call_id uuid)
returns table (room text, identity text, display_name text, can_publish boolean, kind text)
language sql security invoker set search_path = ''
as $$ select * from private.get_call_token_grant(p_call_id) $$;

revoke all on function public.start_call(uuid, text) from public, anon;
revoke all on function public.answer_call(uuid, boolean) from public, anon;
revoke all on function public.end_call(uuid) from public, anon;
revoke all on function public.call_heartbeat(uuid) from public, anon;
revoke all on function public.get_call_token_grant(uuid) from public, anon;
grant execute on function public.start_call(uuid, text) to authenticated;
grant execute on function public.answer_call(uuid, boolean) to authenticated;
grant execute on function public.end_call(uuid) to authenticated;
grant execute on function public.call_heartbeat(uuid) to authenticated;
grant execute on function public.get_call_token_grant(uuid) to authenticated;

-- Crashed clients: sweep every minute.
select cron.unschedule('calls-housekeeping') where exists (select 1 from cron.job where jobname = 'calls-housekeeping');
select cron.schedule('calls-housekeeping', '* * * * *', $$ select private.expire_calls(); $$);
