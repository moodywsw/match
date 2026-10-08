-- Advisor follow-ups (lint 0029):
-- * get_story_poll_counts: public wrapper is SECURITY INVOKER; the privileged
--   aggregate lives in the non-exposed private schema.
-- * is_blocked_either_way(a,b) let any signed-in user probe whether two other
--   users blocked each other. It is only needed inside definer functions, so
--   revoke it from API roles.

create or replace function private.story_poll_counts(p_story_id uuid)
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
revoke all on function private.story_poll_counts(uuid) from public, anon;
grant execute on function private.story_poll_counts(uuid) to authenticated;

drop function if exists public.get_story_poll_counts(uuid);
create function public.get_story_poll_counts(p_story_id uuid)
returns table (option_index smallint, votes bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.story_poll_counts(p_story_id);
$$;
revoke all on function public.get_story_poll_counts(uuid) from public, anon;
grant execute on function public.get_story_poll_counts(uuid) to authenticated;

revoke execute on function public.is_blocked_either_way(uuid, uuid) from public, anon, authenticated;
