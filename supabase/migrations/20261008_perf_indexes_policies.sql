-- Performance advisor follow-ups (no behaviour change).

-- 1) Covering indexes for foreign keys (RLS/block checks and cascades scan these).
create index if not exists blocks_blocked_idx              on public.blocks (blocked_id);
create index if not exists comments_post_idx               on public.comments (post_id);
create index if not exists comments_user_idx               on public.comments (user_id);
create index if not exists conversation_reads_user_idx     on public.conversation_reads (user_id);
create index if not exists event_participants_user_idx     on public.event_participants (user_id);
create index if not exists likes_liked_idx                 on public.likes (liked_id);
create index if not exists live_match_votes_voter_idx      on public.live_match_votes (voter_id);
create index if not exists live_messages_user_idx          on public.live_messages (user_id);
create index if not exists live_streams_guest_idx          on public.live_streams (guest_id);
create index if not exists live_viewers_viewer_idx         on public.live_viewers (viewer_id);
create index if not exists matches_user_b_idx              on public.matches (user_b);
create index if not exists messages_conversation_idx       on public.messages (conversation_id, created_at);
create index if not exists messages_sender_idx             on public.messages (sender_id);
create index if not exists passes_passed_idx               on public.passes (passed_id);
create index if not exists photos_user_idx                 on public.photos (user_id, position);
create index if not exists post_likes_user_idx             on public.post_likes (user_id);
create index if not exists posts_user_idx                  on public.posts (user_id, created_at desc);
create index if not exists reports_live_stream_idx         on public.reports (live_stream_id);
create index if not exists reports_reporter_idx            on public.reports (reporter_id);
create index if not exists reports_reviewed_by_idx         on public.reports (reviewed_by);
create index if not exists story_views_viewer_idx          on public.story_views (viewer_id);
create index if not exists swipe_rewinds_target_idx        on public.swipe_rewinds (target_id);
create index if not exists user_interests_interest_idx     on public.user_interests (interest_id);

-- 2) One permissive SELECT policy per table/role (same visibility as before).
drop policy if exists "profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "users can view their own full profile" on public.profiles;
create policy "profiles visible to self and permitted members" on public.profiles
  for select to authenticated
  using (
    (select auth.uid()) = id
    or (
      is_discoverable = true
      and hidden_at is null
      and (incognito = false or private.incognito_allows(id))
      and not private.blocked_with_me(id)
    )
  );

drop policy if exists "users manage only their own interests" on public.user_interests;
create policy "users add their own interests" on public.user_interests
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users update their own interests" on public.user_interests
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users remove their own interests" on public.user_interests
  for delete to authenticated using (user_id = (select auth.uid()));
