-- Applied to project pkpdheytmbwvqhpcaigm via Supabase MCP apply_migration
-- (chat_realtime_and_profile_photos)

-- Auto-create conversation on match
create or replace function public.create_conversation_for_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversations (match_id)
  values (new.id)
  on conflict (match_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_match_create_conversation on public.matches;
create trigger on_match_create_conversation
  after insert on public.matches
  for each row execute function public.create_conversation_for_match();

create or replace function public.ensure_conversation(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ok boolean;
begin
  select exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
  ) into v_ok;
  if not v_ok then
    raise exception 'not a participant of this match';
  end if;
  insert into public.conversations (match_id)
  values (p_match_id)
  on conflict (match_id) do nothing;
  select id into v_id from public.conversations where match_id = p_match_id;
  return v_id;
end;
$$;

grant execute on function public.ensure_conversation(uuid) to authenticated;

-- Storage bucket: profile-photos (public read; users write only under {uid}/…)
-- Plus messages UPDATE policy for read receipts and realtime publication.
