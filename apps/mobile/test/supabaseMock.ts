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

const fixtures: Record<string, () => unknown[]> = {
  'rpc:get_my_profile': () => (state.signedIn ? [ownProfile()] : []),
  'rpc:get_discover_deck': () => [
    { id: OTHER, name: 'Bruno', birth_date: '1994-07-01', city: 'Lisbon', bio: 'Surf', intention: 'serious', verified: true, is_discoverable: true, distance_km: 3, friday_answer: 'Beach' },
  ],
  'rpc:get_events': () => [
    { id: 'e1', title: 'Sunset mixer', description: 'Drinks', category: 'Nightlife', city: 'Lisbon', venue: 'Rooftop', starts_at: NOW, ends_at: null, capacity: 20, creator_id: OTHER, cover_url: null, going_count: 3, interested_count: 1, my_status: null, lat: null, lng: null, creator_name: 'Bruno', creator_photo: null, attendee_photos: [] },
  ],
  'rpc:get_live_rooms': () => [
    { id: 'l1', host_id: OTHER, host_name: 'Bruno', guest_id: null, guest_name: null, title: 'Rooftop sunset talk', category: 'Talk', is_live_match: false, started_at: NOW, viewers: 7, reactions: 12, is_mine: false },
  ],
  'rpc:get_live_state': () => [{ status: 'live', viewers: 8, reactions: 12, yes_votes: 3, no_votes: 1, my_vote: null }],
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
  'table:posts': () => [
    { id: 'p1', user_id: OTHER, type: 'text', content: 'Best pastel de nata?', media_url: null, poll_options: null, created_at: NOW, like_count: 2, comment_count: 1 },
  ],
};

type Result = { data: unknown; error: null; count?: number };

function builder(key: string) {
  let single = false;
  const resolve = (): Result => {
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
  rpc: (fn: string) => builder(`rpc:${fn}`),
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
  },
};
