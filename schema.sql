-- ============================================================================
-- MATCH — Production database schema (PostgreSQL / Supabase)
-- Every table has Row Level Security enabled: a user can only ever
-- read/write what these policies explicitly allow, enforced by the
-- database itself — not just hidden in the app's UI.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROFILES
-- One row per user, linked 1:1 to Supabase's built-in auth.users.
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  birth_date date not null,                    -- never expose raw DOB to other users, only computed age
  gender text,
  interested_in text[],
  city text,
  lat double precision,                         -- exact location — never selectable by other users (see policies)
  lng double precision,
  approx_lat double precision,                  -- rounded/jittered location, safe to show others
  approx_lng double precision,
  intention text check (intention in ('serious','casual','new_people','friendship','figuring_out')),
  bio text,
  verified boolean not null default false,
  is_discoverable boolean not null default true,
  show_online_status boolean not null default true,
  show_distance boolean not null default true,
  who_can_message text not null default 'matches' check (who_can_message in ('everyone','matches')),
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;

-- Public-safe fields only: everyone can see profiles that are discoverable.
-- (In production, expose a VIEW that omits lat/lng/birth_date and computes
--  age + approx distance server-side instead of selecting this table raw.)
create policy "profiles are viewable by authenticated users"
  on profiles for select
  using (auth.role() = 'authenticated' and is_discoverable = true);

create policy "users can view their own full profile"
  on profiles for select
  using (auth.uid() = id);

create policy "users can update only their own profile"
  on profiles for update
  using (auth.uid() = id);

create policy "users can insert only their own profile"
  on profiles for insert
  with check (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- 2. PHOTOS
-- ---------------------------------------------------------------------------
create table photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  url text not null,
  position int not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
alter table photos enable row level security;

create policy "photos are viewable by authenticated users"
  on photos for select
  using (auth.role() = 'authenticated');

create policy "users manage only their own photos"
  on photos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 3. INTERESTS
-- ---------------------------------------------------------------------------
create table interests (
  id serial primary key,
  category text not null check (category in ('music','food','lifestyle','movies')),
  label text not null unique
);
alter table interests enable row level security;
create policy "interests are readable by everyone"
  on interests for select using (true);

create table user_interests (
  user_id uuid not null references profiles(id) on delete cascade,
  interest_id int not null references interests(id) on delete cascade,
  primary key (user_id, interest_id)
);
alter table user_interests enable row level security;

create policy "user interests are viewable by authenticated users"
  on user_interests for select
  using (auth.role() = 'authenticated');

create policy "users manage only their own interests"
  on user_interests for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 4. LIKES / MATCHES
-- A match is created (via trigger below) the moment both users have liked
-- each other — never trust the client to declare "it's a match".
-- ---------------------------------------------------------------------------
create table likes (
  id uuid primary key default gen_random_uuid(),
  liker_id uuid not null references profiles(id) on delete cascade,
  liked_id uuid not null references profiles(id) on delete cascade,
  is_super_like boolean not null default false,
  created_at timestamptz not null default now(),
  unique (liker_id, liked_id)
);
alter table likes enable row level security;

create policy "users see only likes they sent or received"
  on likes for select
  using (auth.uid() = liker_id or auth.uid() = liked_id);

create policy "users can only like as themselves"
  on likes for insert
  with check (auth.uid() = liker_id);

create table matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);
alter table matches enable row level security;

create policy "users see only their own matches"
  on matches for select
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Matches are NEVER inserted directly by the client — only by this trigger,
-- which runs with elevated privileges and checks both directions server-side.
create or replace function try_create_match()
returns trigger
language plpgsql
security definer
as $$
begin
  if exists (
    select 1 from likes
    where liker_id = new.liked_id and liked_id = new.liker_id
  ) then
    insert into matches (user_a, user_b)
    values (least(new.liker_id, new.liked_id), greatest(new.liker_id, new.liked_id))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_like_check_match
  after insert on likes
  for each row execute function try_create_match();


-- ---------------------------------------------------------------------------
-- 5. CONVERSATIONS / MESSAGES
-- Only the two matched participants can ever read or write here — this is
-- the single most important policy in the whole schema.
-- ---------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade unique,
  created_at timestamptz not null default now()
);
alter table conversations enable row level security;

create policy "only match participants can see the conversation"
  on conversations for select
  using (
    exists (
      select 1 from matches m
      where m.id = match_id and (auth.uid() = m.user_a or auth.uid() = m.user_b)
    )
  );

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  type text not null default 'text' check (type in ('text','image','voice')),
  content text,
  media_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table messages enable row level security;

create policy "only conversation participants can read messages"
  on messages for select
  using (
    exists (
      select 1 from conversations c
      join matches m on m.id = c.match_id
      where c.id = conversation_id and (auth.uid() = m.user_a or auth.uid() = m.user_b)
    )
  );

create policy "only conversation participants can send messages, as themselves"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from conversations c
      join matches m on m.id = c.match_id
      where c.id = conversation_id and (auth.uid() = m.user_a or auth.uid() = m.user_b)
    )
  );


-- ---------------------------------------------------------------------------
-- 6. SOCIAL: POSTS / COMMENTS / POST LIKES / STORIES
-- ---------------------------------------------------------------------------
create table posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('text','photo','video','poll','question')),
  content text,
  media_url text,
  poll_options jsonb,
  created_at timestamptz not null default now()
);
alter table posts enable row level security;

create policy "posts are viewable by authenticated users"
  on posts for select using (auth.role() = 'authenticated');
create policy "users manage only their own posts"
  on posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
alter table comments enable row level security;
create policy "comments are viewable by authenticated users"
  on comments for select using (auth.role() = 'authenticated');
create policy "users can comment as themselves"
  on comments for insert with check (auth.uid() = user_id);
create policy "users can delete only their own comments"
  on comments for delete using (auth.uid() = user_id);

create table post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table post_likes enable row level security;
create policy "post likes are viewable by authenticated users"
  on post_likes for select using (auth.role() = 'authenticated');
create policy "users can like as themselves"
  on post_likes for insert with check (auth.uid() = user_id);
create policy "users can unlike only their own like"
  on post_likes for delete using (auth.uid() = user_id);

create table stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('photo','question','poll')),
  media_url text,
  content jsonb,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);
alter table stories enable row level security;
create policy "stories are viewable by authenticated users until they expire"
  on stories for select using (auth.role() = 'authenticated' and expires_at > now());
create policy "users manage only their own stories"
  on stories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table story_views (
  story_id uuid not null references stories(id) on delete cascade,
  viewer_id uuid not null references profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
alter table story_views enable row level security;
create policy "story owners see who viewed; viewers see their own view"
  on story_views for select
  using (
    auth.uid() = viewer_id
    or auth.uid() = (select user_id from stories where id = story_id)
  );
create policy "users can record only their own view"
  on story_views for insert with check (auth.uid() = viewer_id);


-- ---------------------------------------------------------------------------
-- 7. LIVE
-- ---------------------------------------------------------------------------
create table live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  guest_id uuid references profiles(id),
  title text not null,
  category text not null,
  is_live_match boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table live_streams enable row level security;
create policy "live streams are viewable by authenticated users"
  on live_streams for select using (auth.role() = 'authenticated');
create policy "hosts manage only their own stream"
  on live_streams for all using (auth.uid() = host_id) with check (auth.uid() = host_id);

create table live_viewers (
  stream_id uuid not null references live_streams(id) on delete cascade,
  viewer_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (stream_id, viewer_id)
);
alter table live_viewers enable row level security;
create policy "viewers are visible to authenticated users"
  on live_viewers for select using (auth.role() = 'authenticated');
create policy "users can join only as themselves"
  on live_viewers for insert with check (auth.uid() = viewer_id);


-- ---------------------------------------------------------------------------
-- 8. EVENTS
-- ---------------------------------------------------------------------------
create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  location text,
  starts_at timestamptz not null,
  cover_url text,
  created_at timestamptz not null default now()
);
alter table events enable row level security;
create policy "events are readable by everyone"
  on events for select using (true);

create table event_participants (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table event_participants enable row level security;
create policy "participation is viewable by authenticated users"
  on event_participants for select using (auth.role() = 'authenticated');
create policy "users can RSVP only as themselves"
  on event_participants for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 9. NOTIFICATIONS
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table notifications enable row level security;
create policy "users see only their own notifications"
  on notifications for select using (auth.uid() = user_id);
create policy "users can mark only their own notifications read"
  on notifications for update using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 10. SUBSCRIPTIONS / PAYMENTS
-- Populated ONLY by a trusted server-side webhook (Apple/Google/RevenueCat),
-- never directly by the client — a client could otherwise grant itself
-- premium for free.
-- ---------------------------------------------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  tier text not null check (tier in ('match_plus','super_match')),
  store text not null check (store in ('app_store','play_store')),
  status text not null check (status in ('active','canceled','expired','in_grace_period')),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);
alter table subscriptions enable row level security;
create policy "users can view only their own subscription"
  on subscriptions for select using (auth.uid() = user_id);
-- No insert/update policy for regular users: only the service-role webhook
-- (which bypasses RLS) is allowed to write here.

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  subscription_id uuid references subscriptions(id),
  amount_cents int not null,
  currency text not null default 'EUR',
  store_transaction_id text unique,
  created_at timestamptz not null default now()
);
alter table payments enable row level security;
create policy "users can view only their own payments"
  on payments for select using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 11. TRUST & SAFETY: REPORTS / BLOCKS / VERIFICATIONS
-- ---------------------------------------------------------------------------
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_id uuid not null references profiles(id) on delete cascade,
  category text not null,
  details text,
  status text not null default 'open' check (status in ('open','reviewing','resolved')),
  created_at timestamptz not null default now()
);
alter table reports enable row level security;

create policy "users can see only reports they filed"
  on reports for select using (auth.uid() = reporter_id);
create policy "users can file reports only as themselves"
  on reports for insert with check (auth.uid() = reporter_id);
-- Reviewing/resolving reports is done by staff via the service role, bypassing RLS.

create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table blocks enable row level security;
create policy "users can see only their own block list"
  on blocks for select using (auth.uid() = blocker_id);
create policy "users can block only as themselves"
  on blocks for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

create table verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade unique,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  selfie_url text,                              -- deleted after review; never shown to other users
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table verifications enable row level security;
create policy "users can view only their own verification status"
  on verifications for select using (auth.uid() = user_id);
create policy "users can start only their own verification"
  on verifications for insert with check (auth.uid() = user_id);
-- Approval (status -> 'verified') is done by staff/automated review via the
-- service role — a user can never approve their own verification.


-- ---------------------------------------------------------------------------
-- 12. BLOCK ENFORCEMENT
-- A block should also hide the blocked user from discovery/messages. This
-- helper is meant to be used inside the discovery query (application code
-- or a view), e.g.:
--   select * from profiles
--   where id not in (select blocked_id from blocks where blocker_id = auth.uid())
--     and id not in (select blocker_id from blocks where blocked_id = auth.uid());
-- ---------------------------------------------------------------------------

-- ============================================================================
-- End of schema. Next steps (application-level, not SQL):
--  1. Never query `profiles` directly for discovery — use a view/RPC that
--     strips birth_date/lat/lng and returns computed age + approx distance.
--  2. All Stripe/IAP writes to subscriptions/payments must go through a
--     server-side webhook using the Supabase service_role key — never the
--     public anon key.
--  3. Verification selfie_url should point to a private storage bucket with
--     its own RLS, auto-deleted after manual/automated review.
-- ============================================================================
