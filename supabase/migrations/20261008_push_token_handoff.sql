-- A device's Expo push token belongs to whoever is signed in on it *now*.
-- When a token is (re)registered for a user, unlink it from every other
-- account so a shared/handed-down phone never receives the previous user's
-- pushes (the client also deletes its row on sign-out; this covers offline
-- sign-outs, reinstalls and crashes).
create or replace function private.push_token_handoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_tokens
  where token = new.token
    and user_id <> new.user_id;
  return null;
end;
$$;

revoke all on function private.push_token_handoff() from public, anon, authenticated;

drop trigger if exists push_tokens_handoff on public.push_tokens;
create trigger push_tokens_handoff
after insert or update of token, user_id on public.push_tokens
for each row execute function private.push_token_handoff();
