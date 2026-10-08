-- Security hardening pass (see docs/SECURITY.md).
--  A. Grants: no anon access except the public interests catalogue; no TRUNCATE/REFERENCES/TRIGGER.
--  B. profiles PII: column-level SELECT (no birth_date / gender / interested_in / settings for others);
--     own full row through get_my_profile(); RPCs return an age-anchored date instead of the real DOB.
--  C. Privileged columns (verified, is_admin, hidden_at, report status, verification status,
--     notification payloads) are not writable by clients: column-level INSERT/UPDATE grants.
--  D. Server-side rate limits (BEFORE INSERT triggers on abusive actions).
--  E. Input length / shape checks.
--  F. Moderation: admin flag, report queue with targets, auto-hide after 3 distinct reporters,
--     admin RPCs (list/resolve reports, review verifications).
--  G. Advisor fixes: ensure_conversation / get_blocked_peer_ids bodies move to private;
--     every SECURITY DEFINER function gets search_path = ''.
--  H. Storage: profile-photos listing only for signed-in users.

-- ───────────────────────── A. grants ─────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.interests to anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- ───────────────────────── F(1). moderation columns ─────────────────────────
alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists hidden_at timestamptz;
alter table public.posts add column if not exists hidden_at timestamptz;
alter table public.comments add column if not exists hidden_at timestamptz;

alter table public.reports alter column reported_id drop not null;
alter table public.reports
  add column if not exists post_id uuid references public.posts(id) on delete set null,
  add column if not exists comment_id uuid references public.comments(id) on delete set null,
  add column if not exists live_stream_id uuid references public.live_streams(id) on delete set null,
  add column if not exists resolution text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;
create index if not exists reports_reported_idx on public.reports (reported_id, created_at);
create index if not exists reports_post_idx on public.reports (post_id) where post_id is not null;
create index if not exists reports_comment_idx on public.reports (comment_id) where comment_id is not null;
create index if not exists reports_status_idx on public.reports (status, created_at);

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false);
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create or replace function private.is_hidden_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.hidden_at is not null);
$$;
revoke all on function private.is_hidden_user(uuid) from public, anon;
grant execute on function private.is_hidden_user(uuid) to authenticated;

-- ───────────────────────── E. input checks ─────────────────────────
alter table public.profiles drop constraint if exists profiles_text_lengths_check;
alter table public.profiles add constraint profiles_text_lengths_check check (
  (name is null or char_length(btrim(name)) between 1 and 50)
  and (bio is null or char_length(bio) <= 500)
  and (city is null or char_length(city) <= 80)
  and (gender is null or char_length(gender) <= 40)
  and (interested_in is null or cardinality(interested_in) <= 6)
);
alter table public.posts drop constraint if exists posts_content_check;
alter table public.posts add constraint posts_content_check check (
  (content is null or char_length(content) <= 2000)
  and (type <> 'text' or char_length(btrim(coalesce(content, ''))) >= 1)
  and (media_url is null or char_length(media_url) <= 1024)
  and (poll_options is null or (jsonb_typeof(poll_options) = 'array' and jsonb_array_length(poll_options) between 2 and 4 and pg_column_size(poll_options) < 1024))
);
alter table public.comments drop constraint if exists comments_content_check;
alter table public.comments add constraint comments_content_check check (char_length(btrim(content)) between 1 and 500);
alter table public.reports drop constraint if exists reports_shape_check;
alter table public.reports add constraint reports_shape_check check (
  category = any (array['spam','harassment','inappropriate','fake_profile','underage','scam','other','app_problem'])
  and (details is null or char_length(details) <= 1000)
  and (reported_id is null or reported_id <> reporter_id)
  and (reported_id is not null or category = 'app_problem')
  and (resolution is null or resolution = any (array['dismissed','actioned','unhidden']))
);
alter table public.photos drop constraint if exists photos_url_check;
alter table public.photos add constraint photos_url_check check (
  char_length(url) <= 1024
  and url like ('%/storage/v1/object/public/profile-photos/' || user_id::text || '/%')
  and "position" between 0 and 20
);
alter table public.push_tokens drop constraint if exists push_tokens_lengths_check;
alter table public.push_tokens add constraint push_tokens_lengths_check check (
  char_length(token) <= 255 and (device_name is null or char_length(device_name) <= 120)
);
alter table public.verifications drop constraint if exists verifications_selfie_check;
alter table public.verifications add constraint verifications_selfie_check check (selfie_url is null or char_length(selfie_url) <= 1024);

-- ───────────────────────── C. column-level write grants ─────────────────────────
-- profiles: everything except verified / is_admin / hidden_at / created_at.
revoke insert, update on public.profiles from authenticated;
grant insert (id, name, birth_date, gender, interested_in, city, intention, bio, is_discoverable, show_online_status,
              show_distance, who_can_message, onboarding_complete, updated_at, friday_answer, incognito, read_receipts)
  on public.profiles to authenticated;
grant update (id, name, birth_date, gender, interested_in, city, intention, bio, is_discoverable, show_online_status,
              show_distance, who_can_message, onboarding_complete, updated_at, friday_answer, incognito, read_receipts)
  on public.profiles to authenticated;
-- B. profiles: other people only get public card columns; own full row via get_my_profile().
revoke select on public.profiles from authenticated;
grant select (id, name, city, intention, bio, verified, friday_answer, created_at, updated_at, onboarding_complete, is_discoverable)
  on public.profiles to authenticated;

revoke insert, update on public.posts from authenticated;
grant insert (user_id, type, content, media_url, poll_options) on public.posts to authenticated;
grant update (content, poll_options) on public.posts to authenticated;

revoke insert, update on public.comments from authenticated;
grant insert (post_id, user_id, content) on public.comments to authenticated;

revoke insert, update, delete on public.reports from authenticated;
grant insert (reporter_id, reported_id, category, details, post_id, comment_id, live_stream_id) on public.reports to authenticated;

revoke insert, update, delete on public.verifications from authenticated;
grant insert (user_id, selfie_url) on public.verifications to authenticated;

revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke insert, update on public.photos from authenticated;
grant insert (user_id, url, position, is_primary) on public.photos to authenticated;
grant update (position, is_primary) on public.photos to authenticated;

-- ───────────────────────── RLS policy tightening ─────────────────────────
-- profiles: hidden (moderated) and blocked people disappear.
drop policy if exists "profiles are viewable by authenticated users" on public.profiles;
create policy "profiles are viewable by authenticated users" on public.profiles for select to authenticated
  using (is_discoverable = true and hidden_at is null and ((incognito = false) or private.incognito_allows(id))
         and not private.blocked_with_me(id));
drop policy if exists "users can view their own full profile" on public.profiles;
create policy "users can view their own full profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists "users can insert only their own profile" on public.profiles;
create policy "users can insert only their own profile" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists "users can update only their own profile" on public.profiles;
create policy "users can update only their own profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- posts / comments / likes / photos: block- and moderation-aware.
drop policy if exists "posts are viewable by authenticated users" on public.posts;
create policy "posts are viewable by authenticated users" on public.posts for select to authenticated
  using (user_id = (select auth.uid())
         or (hidden_at is null and not private.blocked_with_me(user_id) and not private.is_hidden_user(user_id)));
drop policy if exists "users manage only their own posts" on public.posts;
create policy "users create their own posts" on public.posts for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users edit their own posts" on public.posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users delete their own posts" on public.posts for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "comments are viewable by authenticated users" on public.comments;
create policy "comments are viewable by authenticated users" on public.comments for select to authenticated
  using (user_id = (select auth.uid())
         or (hidden_at is null and not private.blocked_with_me(user_id) and not private.is_hidden_user(user_id)));
drop policy if exists "users can comment as themselves" on public.comments;
create policy "users can comment as themselves" on public.comments for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.posts p where p.id = post_id and p.hidden_at is null
                          and not private.blocked_with_me(p.user_id)));
drop policy if exists "users can delete only their own comments" on public.comments;
create policy "users can delete only their own comments" on public.comments for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "post likes are viewable by authenticated users" on public.post_likes;
create policy "post likes are viewable by authenticated users" on public.post_likes for select to authenticated
  using (not private.blocked_with_me(user_id));
drop policy if exists "users can like as themselves" on public.post_likes;
create policy "users can like as themselves" on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.posts p where p.id = post_id and not private.blocked_with_me(p.user_id)));
drop policy if exists "users can unlike only their own like" on public.post_likes;
create policy "users can unlike only their own like" on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "photos are viewable by authenticated users" on public.photos;
create policy "photos are viewable by authenticated users" on public.photos for select to authenticated
  using (user_id = (select auth.uid()) or (not private.blocked_with_me(user_id) and not private.is_hidden_user(user_id)));
drop policy if exists "users manage only their own photos" on public.photos;
create policy "users add their own photos" on public.photos for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users edit their own photos" on public.photos for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users delete their own photos" on public.photos for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "user interests are viewable by authenticated users" on public.user_interests;
create policy "user interests are viewable by authenticated users" on public.user_interests for select to authenticated
  using (user_id = (select auth.uid()) or not private.blocked_with_me(user_id));
drop policy if exists "users manage only their own interests" on public.user_interests;
create policy "users manage only their own interests" on public.user_interests for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- reports: file as yourself; admins see the whole queue.
drop policy if exists "users can file reports only as themselves" on public.reports;
create policy "users can file reports only as themselves" on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
drop policy if exists "users can see only reports they filed" on public.reports;
create policy "users see reports they filed; admins see all" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_admin());

-- remaining policies on role public → authenticated (same predicates).
drop policy if exists "users can block only as themselves" on public.blocks;
create policy "users can block only as themselves" on public.blocks for all to authenticated
  using ((select auth.uid()) = blocker_id) with check ((select auth.uid()) = blocker_id);
drop policy if exists "users can see only their own block list" on public.blocks;
drop policy if exists "only match participants can see the conversation" on public.conversations;
create policy "only match participants can see the conversation" on public.conversations for select to authenticated
  using (exists (select 1 from public.matches m where m.id = conversations.match_id
                 and ((select auth.uid()) = m.user_a or (select auth.uid()) = m.user_b)));
drop policy if exists "users can only like as themselves" on public.likes;
create policy "users can only like as themselves" on public.likes for insert to authenticated
  with check ((select auth.uid()) = liker_id);
drop policy if exists "users see only their own matches" on public.matches;
create policy "users see only their own matches" on public.matches for select to authenticated
  using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);
drop policy if exists "only conversation participants can read messages" on public.messages;
create policy "only conversation participants can read messages" on public.messages for select to authenticated
  using (private.is_conversation_member(conversation_id));
drop policy if exists "only conversation participants can send messages, as themselves" on public.messages;
create policy "only conversation participants can send messages, as themselves" on public.messages for insert to authenticated
  with check ((select auth.uid()) = sender_id and private.is_conversation_member(conversation_id));
drop policy if exists "users see only their own notifications" on public.notifications;
create policy "users see only their own notifications" on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "users delete only their own push tokens" on public.push_tokens;
drop policy if exists "users see only their own push tokens" on public.push_tokens;
drop policy if exists "users update only their own push tokens" on public.push_tokens;
drop policy if exists "users upsert only their own push tokens" on public.push_tokens;
create policy "users manage only their own push tokens" on public.push_tokens for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "story owners see who viewed; viewers see their own view" on public.story_views;
create policy "story owners see who viewed; viewers see their own view" on public.story_views for select to authenticated
  using ((select auth.uid()) = viewer_id
         or (select auth.uid()) = (select s.user_id from public.stories s where s.id = story_views.story_id));
drop policy if exists "users can start only their own verification" on public.verifications;
create policy "users can start only their own verification" on public.verifications for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "users can view only their own verification status" on public.verifications;
create policy "users can view only their own verification status" on public.verifications for select to authenticated
  using ((select auth.uid()) = user_id or private.is_admin());
drop policy if exists "interests are readable by everyone" on public.interests;
create policy "interests are readable by everyone" on public.interests for select to anon, authenticated using (true);

