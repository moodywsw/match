-- public.is_blocked_either_way is not executable by `authenticated` (hardened
-- earlier), so RLS policies must go through a private SECURITY DEFINER helper.
create or replace function private.blocked_with_me(p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_other is not null and public.is_blocked_either_way(p_other, (select auth.uid()));
$$;
revoke all on function private.blocked_with_me(uuid) from public, anon;
grant execute on function private.blocked_with_me(uuid) to authenticated;

drop policy if exists "events readable by signed-in users" on public.events;
create policy "events readable by signed-in users" on public.events for select to authenticated
  using (not private.blocked_with_me(creator_id));
