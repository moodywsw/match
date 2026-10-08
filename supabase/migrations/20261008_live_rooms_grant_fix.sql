-- can_publish was NULL (not false) for viewers when the stream has no guest.
create or replace function private.live_token_grant(p_stream_id uuid)
returns table (room text, identity text, display_name text, can_publish boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into s from public.live_streams where id = p_stream_id;
  if not found or not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  return query
    select 'match-live-' || s.id::text, v_uid::text,
           coalesce((select p.name from public.profiles p where p.id = v_uid), 'Member'),
           (v_uid = s.host_id or v_uid is not distinct from s.guest_id);
end;
$$;
revoke all on function private.live_token_grant(uuid) from public, anon;
grant execute on function private.live_token_grant(uuid) to authenticated;
