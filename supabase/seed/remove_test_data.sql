-- Removes ALL seeded test data (accounts flagged profiles.is_test or emails @match.test).
--
-- Safe to run repeatedly. Deleting the auth user cascades to profiles and from there to
-- every app table (photos rows, interests, likes, passes, matches -> conversations ->
-- messages, lifecycle, date confirmations/feedback, reports, notifications they caused,
-- stories, posts, comments, events they host, RSVPs, picks...).
--
-- NOT covered by SQL: the photo FILES in Storage (Supabase blocks direct deletes on
-- storage.objects). Run `python3 supabase/seed/remove_test_data.py` instead, which deletes
-- the files first and then runs this script. Or delete the folders named after the ids
-- listed by the first query in Dashboard > Storage > profile-photos.

-- 1) Preview what will be removed.
select u.id, u.email, p.name
  from auth.users u left join public.profiles p on p.id = u.id
 where u.email like '%@match.test' or p.is_test
 order by u.email;

-- 2) Remove.
do $rm$
declare v_ids uuid[];
begin
  select array_agg(u.id) into v_ids
    from auth.users u left join public.profiles p on p.id = u.id
   where u.email like '%@match.test' or coalesce(p.is_test, false);
  if v_ids is null then raise notice 'no test data found'; return; end if;

  if to_regclass('private.rate_limits') is not null then
    delete from private.rate_limits where user_id = any (v_ids);
  end if;
  -- Picks already shown to real users that pointed at test profiles (also cascades; explicit for clarity).
  delete from public.daily_picks where target_id = any (v_ids);
  delete from auth.users where id = any (v_ids);
  -- Let real users get a fresh set of picks today instead of a run that counted test profiles.
  delete from private.pick_runs r
   where r.pick_date >= current_date - 1
     and not exists (select 1 from public.daily_picks d where d.user_id = r.user_id);
  raise notice 'removed % test accounts', cardinality(v_ids);
end $rm$;

-- 3) Verify (all zeros).
select (select count(*) from auth.users where email like '%@match.test') as auth_users,
       (select count(*) from public.profiles where is_test) as profiles;
