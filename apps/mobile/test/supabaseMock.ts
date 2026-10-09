/**
 * In-memory stand-in for the Supabase client used by the screen smoke tests.
 * Every query builder call is chainable and resolves to an empty result, except
 * for a handful of "fixtures" (own profile, events, posts) so screens render
 * their populated states too. No network access happens in tests.
 */

export const ME = '00000000-0000-4000-8000-000000000001';
export const OTHER = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-08T12:00:00Z').toISOString();

export const state = { signedIn: true, onboarded: true };
/** Auth calls the app made (for asserting forgot-password / reset flows). */
export const authCalls: { fn: string; args: unknown[] }[] = [];
const track =
  (fn: string, result: unknown = { data: {}, error: null }) =>
  async (...args: unknown[]) => {
    authCalls.push({ fn, args });
    return result;
  };

export const ownProfile = () => ({
  id: ME,
  name: 'Ana',
  birth_date: '1996-02-10',
  gender: 'woman',
  city: 'Lisbon',
  bio: 'Coffee, sea, jazz.',
  intention: 'serious',
  friday_answer: 'Sunset at Miradouro',
  verified: true,
  is_discoverable: true,
  onboarding_complete: state.onboarded,
  created_at: NOW,
  updated_at: NOW,
  incognito: false,
  show_distance: true,
  show_online: true,
  read_receipts: true,
  max_distance_km: 50,
  min_age: 18,
  max_age: 99,
});

/** Mutable LIVE fixtures so tests can switch eligibility / room type. */
export const liveMock = {
  elig: null as null | Record<string, unknown>,
  roomType: 'standard' as 'standard' | 'speed_dating' | 'question_night',
  reset() {
    this.elig = null;
    this.roomType = 'standard';
  },
};
const ELIGIBLE = { can_watch: true, can_interact: true, missing: [], can_host: true, host_block: null, host_ready_at: null, host_min_days: 7, verified_required: false };

const fixtures: Record<string, () => unknown[]> = {
  'rpc:get_my_profile': () => (state.signedIn ? [ownProfile()] : []),
  'rpc:get_discover_deck': () => [
    { id: OTHER, name: 'Bruno', birth_date: '1994-07-01', city: 'Lisbon', bio: 'Surf', intention: 'serious', verified: true, is_discoverable: true, distance_km: 3, friday_answer: 'Beach' },
  ],
  'rpc:get_events': () => [
    { id: 'e1', title: 'Sunset mixer', description: 'Drinks', category: 'Nightlife', city: 'Lisbon', venue: 'Rooftop', starts_at: NOW, ends_at: null, capacity: 20, creator_id: OTHER, cover_url: null, going_count: 3, interested_count: 1, my_status: null, lat: null, lng: null, creator_name: 'Bruno', creator_photo: null, attendee_photos: [] },
  ],
  'rpc:get_live_rooms': () => [
    { id: 'l1', host_id: OTHER, host_name: 'Bruno', guest_id: null, guest_name: null, title: 'Rooftop sunset talk', category: 'Talk', is_live_match: false, started_at: NOW, viewers: 7, reactions: 12, is_mine: false, room_type: liveMock.roomType, question: liveMock.roomType === 'question_night' ? 'What does your perfect Friday night look like?' : null, daters: liveMock.roomType === 'speed_dating' ? 2 : 0 },
  ],
  'rpc:get_live_state': () => [
    {
      status: 'live', viewers: 8, reactions: 12, yes_votes: 3, no_votes: 1, my_vote: null,
      room_type: liveMock.roomType,
      question: liveMock.roomType === 'question_night' ? 'What does your perfect Friday night look like?' : null,
      comments_muted: false,
      pinned: liveMock.roomType === 'question_night' ? { id: 'm1', user_id: OTHER, name: 'Bruno', body: 'Sunset at a miradouro' } : null,
      round_number: liveMock.roomType === 'speed_dating' ? 1 : 0,
      round_started_at: liveMock.roomType === 'speed_dating' ? new Date(Date.now() - 30_000).toISOString() : null,
      round_ends_at: liveMock.roomType === 'speed_dating' ? new Date(Date.now() + 150_000).toISOString() : null,
      round_pair: liveMock.roomType === 'speed_dating' ? [OTHER, 'd2'] : null,
      stage: [
        { id: OTHER, name: 'Bruno', role: 'host', seat: 0, liked: false, matched: false },
        ...(liveMock.roomType === 'speed_dating' ? [{ id: 'd2', name: 'Dina', role: 'dater', seat: 1, liked: false, matched: false }] : []),
      ],
      my_status: 'ok',
      can_interact: liveMock.elig ? liveMock.elig.can_interact !== false : true,
    },
  ],
  'rpc:join_live': () => ['viewer'],
  'table:live_messages': () => [{ id: 'm1', stream_id: 'l1', user_id: OTHER, body: 'Welcome everyone!', created_at: NOW }],
  // chat with OTHER (conversation id = OTHER for the /chat/<OTHER> smoke test)
  'table:conversations': () => [{ id: OTHER, match_id: 'mt1' }],
  'table:matches': () => [{ id: 'mt1', user_a: ME, user_b: OTHER, created_at: NOW }],
  'table:profiles': () => [{ id: OTHER, name: 'Bruno', intention: 'serious' }],
  'table:messages': () => [
    { id: 'msg1', conversation_id: OTHER, sender_id: OTHER, type: 'call', content: 'missed:video', media_url: null, media_path: null, duration_ms: null, waveform: null, read_at: null, created_at: NOW },
  ],
  'table:coin_packs': () => [
    { product_id: 'coins_100', coins: 100, sort: 1 },
    { product_id: 'coins_550', coins: 550, sort: 2 },
    { product_id: 'coins_1200', coins: 1200, sort: 3 },
  ],
  'table:wallets': () => [{ coins: 42, diamonds: 7 }],
  // chats that don't die: the match with OTHER went quiet and is expiring
  'table:match_lifecycle': () => [
    { match_id: 'mt1', user_a: ME, user_b: OTHER, state: 'expiring', matched_at: '2026-10-01T12:00:00Z', last_message_at: null, expires_at: new Date(Date.now() + 30 * 3600_000).toISOString(), extended_a_at: null, extended_b_at: null, video_suggested_at: null, nudged_at: '2026-10-02T12:00:00Z' },
  ],
  'rpc:get_conversation_starters': () => ["What's the last jazz song you had on repeat? 🎧", 'Your perfect Friday is “Beach” — what would make it a 10/10?'],
  'rpc:get_trust_badges': () => [{ user_id: OTHER, real_photos: true }],
  'table:posts': () => [
    { id: 'p1', user_id: OTHER, type: 'text', content: 'Best pastel de nata?', media_url: null, poll_options: null, created_at: NOW, like_count: 2, comment_count: 1 },
  ],
};

/** RPCs that return a single JSON value (not rows). */
const scalarFixtures: Record<string, () => unknown> = {
  'rpc:get_daily_picks': () => ({
    pick_date: '2026-10-08',
    refreshes_at: new Date(Date.now() + 5 * 3600_000).toISOString(),
    quota: 7,
    picks: [
      { id: OTHER, name: 'Bruno', birth_date: '1994-07-01', city: 'Lisbon', bio: 'Surf', intention: 'serious', verified: true, friday_answer: 'Beach', distance_km: 3, super_liked_me: false, reason: 'You both love jazz and sushi', rank: 1, acted: null },
    ],
  }),
  'rpc:mark_we_met': () => ({ me: true, them: false, notified: true }),
  'rpc:get_live_eligibility': () => liveMock.elig ?? ELIGIBLE,
  'rpc:like_from_live': () => ({ liked: true, matched: true, match_id: 'mt1', conversation_id: OTHER, name: 'Bruno' }),
};

/** Every rpc() call the app made (name + args). */
export const rpcCalls: { fn: string; args: unknown }[] = [];

type Result = { data: unknown; error: null; count?: number };

function builder(key: string) {
  let single = false;
  const resolve = (): Result => {
    if (scalarFixtures[key]) return { data: scalarFixtures[key](), error: null };
    const rows = fixtures[key]?.() ?? [];
    return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null, count: rows.length };
  };
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, bad);
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => {
          single = true;
          return proxy;
        };
      }
      return () => proxy;
    },
  });
  return proxy;
}

function channel() {
  const ch: any = {
    on: () => ch,
    subscribe: (cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED');
      return ch;
    },
    send: async () => 'ok',
    track: async () => 'ok',
    unsubscribe: async () => 'ok',
    presenceState: () => ({}),
  };
  return ch;
}

const session = () =>
  state.signedIn
    ? { access_token: 't', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: ME, email: 'ana@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: NOW } }
    : null;

export const supabase = {
  from: (table: string) => builder(`table:${table}`),
  rpc: (fn: string, args?: unknown) => {
    rpcCalls.push({ fn, args });
    return builder(`rpc:${fn}`);
  },
  channel: () => channel(),
  removeChannel: async () => 'ok',
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: {
    from: () => ({
      upload: async () => ({ data: { path: 'x' }, error: null }),
      remove: async () => ({ data: [], error: null }),
      getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/x.jpg' } }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.com/x.jpg' }, error: null }),
      createSignedUrls: async () => ({ data: [], error: null }),
    }),
  },
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => ({ data: { user: session()?.user ?? null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    signUp: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: track('resetPasswordForEmail'),
    updateUser: track('updateUser', { data: { user: null }, error: null }),
    setSession: track('setSession', { data: { session: null }, error: null }),
    exchangeCodeForSession: track('exchangeCodeForSession', { data: { session: null }, error: null }),
    startAutoRefresh: async () => {},
    stopAutoRefresh: async () => {},
  },
};
