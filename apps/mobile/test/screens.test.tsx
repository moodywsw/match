/**
 * Smoke test: every route renders through the real root layout (auth gate,
 * providers, tab bar) with a mocked Supabase client, without throwing and
 * without React reporting errors.
 */
import { act, fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import path from 'path';

import { authCalls, groupMock, liveMock, OTHER, rpcCalls, speedMock, state, walletMock } from './supabaseMock';

const APP_DIR = path.resolve(__dirname, '../app');

let errors: string[] = [];
const realError = console.error;
beforeEach(() => {
  errors = [];
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    // act() noise from timers inside third-party libs is not a render failure.
    if (/not wrapped in act|inside a test was not wrapped/.test(msg)) return;
    errors.push(msg);
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  console.error = realError;
});

async function open(url: string) {
  // RNTL 14's render() is async; renderRouter attaches the router helpers to
  // the returned promise, so keep both.
  const pending = renderRouter(APP_DIR, { initialUrl: url });
  const rendered = await (pending as unknown as Promise<typeof pending>);
  const view = { ...rendered, toJSON: () => rendered.toJSON(), getPathname: () => pending.getPathname() };
  if (process.env.DUMP_TEXT) {
    const texts: string[] = [];
    const walk = (n: any): void => {
      if (n == null) return;
      if (typeof n === 'string') return void texts.push(n);
      if (Array.isArray(n)) return n.forEach(walk);
      (n.children ?? []).forEach(walk);
    };
    await act(async () => {
      if ('clock' in (setTimeout as unknown as object)) await jest.advanceTimersByTimeAsync(400);
    });
    walk(rendered.toJSON());
    require('fs').appendFileSync('/tmp/screen_text.txt', `\n## ${url} -> ${pending.getPathname()}\n${texts.join(' | ').slice(0, 600)}\n`);
  }
  // Let the auth bootstrap + data effects settle.
  // renderRouter may install fake timers; drive whichever clock is active.
  const fake = 'clock' in (setTimeout as unknown as object);
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      if (fake) await jest.advanceTimersByTimeAsync(50);
      else await new Promise((r) => setTimeout(r, 25));
    });
  }
  return view;
}

const signedInRoutes: [string, string][] = [
  ['/home', '/home'],
  ['/discover', '/discover'],
  ['/social', '/social'],
  ['/live', '/live'],
  ['/events', '/events'],
  ['/matches', '/matches'],
  ['/messages', '/messages'],
  ['/profile', '/profile'],
  [`/chat/${OTHER}`, `/chat/${OTHER}`],
  ['/event/e1', '/event/e1'],
  ['/post/p1', '/post/p1'],
  [`/story/${OTHER}`, `/story/${OTHER}`],
  ['/legal/privacy', '/legal/privacy'],
  ['/legal/terms', '/legal/terms'],
  ['/speed', '/speed'],
  ['/', '/home'],
];

describe('signed in + onboarded', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
  });
  test.each(signedInRoutes)('%s renders', async (url, expected) => {
    const view = await open(url);
    expect(view.toJSON()).not.toBeNull();
    expect(view.getPathname()).toBe(expected);
    expect(errors).toEqual([]);
  });
});

describe('signed out', () => {
  beforeEach(() => {
    state.signedIn = false;
  });
  test.each([
    ['/', '/'],
    ['/sign-in', '/sign-in'],
    ['/sign-up', '/sign-up'],
    ['/home', '/'],
  ])('%s renders', async (url, expected) => {
    const view = await open(url);
    expect(view.toJSON()).not.toBeNull();
    expect(view.getPathname()).toBe(expected);
    expect(errors).toEqual([]);
  });
});

describe('forgot password (signed out)', () => {
  beforeEach(() => {
    state.signedIn = false;
    authCalls.length = 0;
  });
  test('sign-in → "Forgot password?" sends a reset email with an app deep link', async () => {
    const view = await open('/sign-in');
    await act(async () => {
      fireEvent.press(view.getByText('Forgot password?'));
    });
    expect(view.getByText('Send reset link')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText('Email'), '  Ana@Example.com ');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Send reset link'));
    });
    const call = authCalls.find((c) => c.fn === 'resetPasswordForEmail');
    expect(call?.args[0]).toBe('ana@example.com');
    expect(String((call?.args[1] as { redirectTo?: string })?.redirectTo)).toMatch(/reset-password$/);
    expect(view.getByText(/reset link is on its way/)).toBeTruthy();
    expect(errors).toEqual([]);
  });
  test('/reset-password renders without a session', async () => {
    const view = await open('/reset-password');
    expect(view.toJSON()).not.toBeNull();
    expect(view.getPathname()).toBe('/reset-password');
    expect(errors).toEqual([]);
  });
});

describe('signed in, onboarding incomplete', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = false;
  });
  test('redirects to onboarding and renders it', async () => {
    const view = await open('/home');
    expect(view.toJSON()).not.toBeNull();
    expect(view.getPathname()).toBe('/');
    expect(errors).toEqual([]);
  });
});

describe('live rooms (Expo Go runtime)', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
  });
  async function settle() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
    }
  }

  test('real room opens with server chat and the video-gated note', async () => {
    const view = await open('/live');
    expect(view.getByText('Rooftop sunset talk')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Rooftop sunset talk'));
    });
    await settle();
    expect(view.getByText(/Welcome everyone!/)).toBeTruthy();
    expect(view.getByText('8')).toBeTruthy(); // viewer count from get_live_state
    expect(view.getByText(/Video live is available in the app build/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('Go Live sheet opens', async () => {
    const view = await open('/live');
    await act(async () => {
      fireEvent.press(view.getAllByText('Go Live')[0]);
    });
    await settle();
    expect(view.getAllByText(/Go Live|Start/).length).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
});

describe('live, reshaped for dating', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
    liveMock.reset();
    rpcCalls.length = 0;
  });
  afterAll(() => liveMock.reset());
  async function settle() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
    }
  }
  async function openRoom() {
    const view = await open('/live');
    await act(async () => {
      fireEvent.press(view.getByText('Rooftop sunset talk'));
    });
    await settle();
    return view;
  }

  test('watching is open, but an incomplete profile cannot comment or gift', async () => {
    liveMock.elig = { can_watch: true, can_interact: false, missing: ['photo', 'interests'], can_host: false, host_block: 'profile_incomplete', host_ready_at: null, host_min_days: 7, verified_required: false };
    const view = await openRoom();
    expect(view.getByText(/Welcome everyone!/)).toBeTruthy();
    expect(view.getByPlaceholderText('Complete your profile to comment')).toBeTruthy();
    expect(view.getByText(/Add a photo and 3 interests to comment and send gifts/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Send a gift'));
    });
    await settle();
    expect(view.queryByText('Send Bruno a gift')).toBeNull();
    expect(errors).toEqual([]);
  });

  test('like the host from the stage -> MATCH moment', async () => {
    const view = await openRoom();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Like Bruno'));
    });
    await settle();
    const call = rpcCalls.find((c) => c.fn === 'like_from_live');
    expect(call?.args).toEqual({ p_stream_id: 'l1', p_target: OTHER });
    expect(view.getAllByText('MATCH!').length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('Go Live explains why a new account cannot host yet', async () => {
    liveMock.elig = { can_watch: true, can_interact: true, missing: [], can_host: false, host_block: 'account_too_new', host_ready_at: '2026-10-15T10:00:00Z', host_min_days: 7, verified_required: false };
    const view = await open('/live');
    await settle();
    await act(async () => {
      fireEvent.press(view.getAllByText('Go Live')[0]);
    });
    await settle();
    expect(view.getByText(/Hosting opens once your account is 7 days old — from 15 Oct/)).toBeTruthy();
    expect(view.queryByText('Start streaming')).toBeNull();
    expect(errors).toEqual([]);
  });

  test('Go Live offers the themed formats', async () => {
    const view = await open('/live');
    await settle();
    await act(async () => {
      fireEvent.press(view.getAllByText('Go Live')[0]);
    });
    await settle();
    expect(view.getAllByText(/Speed dating$/).length).toBeGreaterThan(0);
    const qotn = view.getAllByText(/Question of the night$/);
    await act(async () => {
      fireEvent.press(qotn[qotn.length - 1]);
    });
    expect(view.getByDisplayValue('What does your perfect Friday night look like?')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('speed dating room shows the badge, the round and the timer', async () => {
    liveMock.roomType = 'speed_dating';
    const view = await open('/live');
    expect(view.getAllByText('⚡ SPEED DATING').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.press(view.getByText('Rooftop sunset talk'));
    });
    await settle();
    expect(view.getByText('Round 1')).toBeTruthy();
    expect(view.getByText(/Bruno 💬 Dina are on a 3-minute date/)).toBeTruthy();
    expect(view.getByText(/^2:[0-5]\d$/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('question of the night shows the question and the pinned answer', async () => {
    liveMock.roomType = 'question_night';
    const view = await openRoom();
    expect(view.getAllByText('What does your perfect Friday night look like?').length).toBeGreaterThan(0);
    expect(view.getByText(/Sunset at a miradouro/)).toBeTruthy();
    expect(view.getByPlaceholderText('Your answer…')).toBeTruthy();
    expect(errors).toEqual([]);
  });
});

describe('calls (Expo Go runtime)', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
  });

  test('video call button shows the installed-app state instead of crashing', async () => {
    const view = await open('/chat/00000000-0000-4000-8000-000000000002');
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
    }
    expect(view.getByText('Missed video call')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Video call'));
    });
    expect(view.getByText('Video calls work in the installed app')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Got it'));
    });
    expect(view.queryByText('Video calls work in the installed app')).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('wallet + gifts (Expo Go runtime)', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
  });
  async function settle() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
    }
  }

  test('wallet screen: balance, priced packs, history, earn coins and no cash-out', async () => {
    walletMock.reset();
    const view = await open('/profile');
    await settle();
    await act(async () => {
      fireEvent.press(view.getByText('Wallet · 42 coins'));
    });
    await settle();
    expect(view.getByLabelText('Balance 42 coins')).toBeTruthy();
    expect(view.getByText('1,200 coins')).toBeTruthy();
    expect(view.getByText('€9.99')).toBeTruthy();
    expect(view.getByText('+20% bonus · best value')).toBeTruthy();
    expect(view.getAllByText(/^(Coming soon|In the MATCH app)$/).length).toBe(3);
    expect(view.getByText('Sent Flame')).toBeTruthy();
    expect(view.getByText(/to Bruno · live/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Purchases'));
    });
    expect(view.queryByText('Sent Flame')).toBeNull();
    expect(view.getByText('100 coin pack')).toBeTruthy();
    expect(view.getByText(/can’t be exchanged for cash/)).toBeTruthy();
    expect(view.queryByText(/payouts/i)).toBeNull();
    expect(view.queryByText(/test coins/)).toBeNull();
    expect(errors).toEqual([]);
  });

  test('wallet: admin sees test coins; invite code can be shared and a friend code redeemed', async () => {
    walletMock.reset();
    walletMock.admin = true;
    rpcCalls.length = 0;
    const view = await open('/wallet');
    await settle();
    expect(view.getByText('🛠️ Add 500 test coins (admin only)')).toBeTruthy();
    expect(view.getByText('K7QX2M')).toBeTruthy();
    expect(view.getByText(/2 joined · 1 rewarded/)).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("Got a friend's code?"), 'ab-cd12');
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('Use invite code'));
    });
    await settle();
    expect(rpcCalls.find((c) => c.fn === 'redeem_referral')?.args).toEqual({ p_code: 'ABCD12' });
    expect(view.getByText(/Code saved. Add .* and you and Bruno both get 50 coins/)).toBeTruthy();
    walletMock.reset();
    expect(errors).toEqual([]);
  });

  test('home: daily streak claim + completeness nudge', async () => {
    walletMock.reset();
    rpcCalls.length = 0;
    const view = await open('/home');
    await settle();
    expect(view.getByText('Day 3 streak — your daily coins are ready')).toBeTruthy();
    expect(view.getByText('Answer the Friday question')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Claim 5 coins, day 3 streak'));
    });
    await settle();
    expect(rpcCalls.some((c) => c.fn === 'claim_daily_reward')).toBe(true);
    expect(view.getByText('+5 coins · day 3 streak 🔥')).toBeTruthy();
    walletMock.reset();
    expect(errors).toEqual([]);
  });

  test('profile shows the strength meter with the next step', async () => {
    const view = await open('/profile');
    await settle();
    expect(view.getByText('Profile strength')).toBeTruthy();
    expect(view.getByText('65%')).toBeTruthy();
    expect(view.getByText('The best conversation starter on MATCH')).toBeTruthy();
    expect(view.getByText('Invite friends · you both get coins')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('live tab has a coin pill that opens the wallet', async () => {
    const view = await open('/live');
    await settle();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Wallet, 42 coins'));
    });
    await settle();
    expect(view.getByText('TOP UP')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('discover: no MATCH+ boost left → boost with coins, low balance → top up', async () => {
    const view = await open('/discover');
    await settle();
    await act(async () => {
      fireEvent.press(view.getByText('Explore more'));
    });
    await settle();
    await act(async () => {
      fireEvent.press(view.getByText('Boost'));
    });
    await settle();
    expect(view.getByText('Boost your profile')).toBeTruthy();
    expect(view.getByText('150 coins')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Top up · need 108 more'));
    });
    await settle();
    expect(view.getByText('TOP UP')).toBeTruthy();
    expect(view.getByText(/108 more coins/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('gift sheet opens from a real live', async () => {
    const view = await open('/live');
    await act(async () => {
      fireEvent.press(view.getByText('Rooftop sunset talk'));
    });
    await settle();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Send a gift'));
    });
    await settle();
    expect(view.getByText('Send Bruno a gift')).toBeTruthy();
    expect(view.getByText('Crown')).toBeTruthy();
    expect(view.getByText('42 coins')).toBeTruthy();
    expect(view.getByLabelText('Top up coins')).toBeTruthy();
    // low balance: Crown costs 999 → the button turns into a top-up with the exact shortfall
    await act(async () => {
      fireEvent.press(view.getByLabelText('Crown, 999 coins'));
    });
    expect(view.getByText(/Low balance: you have 42 coins and this costs 999/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Top up · need 957 more'));
    });
    await settle();
    expect(view.getByText(/957 more coins/)).toBeTruthy();
    expect(errors).toEqual([]);
  });
});

describe('differentiators', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
    rpcCalls.length = 0;
  });
  async function settle() {
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
    }
  }

  test("Discover opens on Today's picks with the why-line, trust badge and countdown", async () => {
    const view = await open('/discover');
    await settle();
    expect(view.getByText("Today's picks")).toBeTruthy();
    expect(view.getByText('You both love jazz and sushi')).toBeTruthy();
    expect(view.getByText('Real photos · verified by dates')).toBeTruthy();
    expect(view.getByText(/1 of 7 left/)).toBeTruthy();
    expect(view.getAllByText(/^0[45]:\d\d:\d\d$/).length).toBeGreaterThan(0);
    const call = rpcCalls.find((c) => c.fn === 'get_daily_picks');
    expect(call).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Explore more'));
    });
    // Bruno is an open pick, so Explore doesn't show him twice.
    expect(view.queryByText('You both love jazz and sushi')).toBeNull();
    expect(errors).toEqual([]);
  });

  test('quiet chat shows the expiring timer, Extend, starters, and the We met flow', async () => {
    const view = await open(`/chat/${OTHER}`);
    await settle();
    expect(view.getByText('Match expiring')).toBeTruthy();
    expect(view.getByText('Extend 48h')).toBeTruthy();
    expect(view.getByText(/last jazz song/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Extend 48h'));
    });
    await settle();
    expect(rpcCalls.some((c) => c.fn === 'extend_match')).toBe(true);
    await act(async () => {
      fireEvent.press(view.getByLabelText('More'));
    });
    expect(view.getByText('Date safety')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('We met 💛'));
    });
    await settle();
    expect(rpcCalls.some((c) => c.fn === 'mark_we_met')).toBe(true);
    expect(view.getByText('Share private feedback')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Share private feedback'));
    });
    expect(view.getByText('Private date feedback')).toBeTruthy();
    expect(view.getByText(/look like their photos/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('Messages shows the expiry timer on a quiet match', async () => {
    const view = await open('/messages');
    await settle();
    expect(view.getByText('Bruno')).toBeTruthy();
    expect(view.getAllByText(/^(29|30)h \d\dm$/).length).toBe(1);
    expect(errors).toEqual([]);
  });
});

describe('speed dating + group rooms (Expo Go runtime)', () => {
  beforeEach(() => {
    state.signedIn = true;
    state.onboarded = true;
    speedMock.reset();
    groupMock.reset();
    rpcCalls.length = 0;
  });
  async function settle(n = 6) {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
    }
  }
  const press = async (el: Parameters<typeof fireEvent.press>[0]) => {
    await act(async () => {
      fireEvent.press(el);
    });
    await settle();
  };

  test('Live has a Speed Dating category; first date is free; queue can be cancelled', async () => {
    const view = await open('/live');
    await settle();
    expect(view.getByLabelText('Speed Dating category')).toBeTruthy();
    await press(view.getByLabelText('Speed Dating'));
    expect(view.getByText('🎟️ Your first date today is free')).toBeTruthy();
    expect(view.getByText(/Coins back if your date doesn't show up or leaves in the first 20s/)).toBeTruthy();
    await press(view.getByText('25–35'));
    await press(view.getByText('Find my date · free'));
    const join = rpcCalls.find((c) => c.fn === 'speed_join');
    expect(join?.args).toEqual({ p_min_age: 25, p_max_age: 35, p_max_km: null, p_same_intention: false });
    expect(view.getByText('Finding your date…')).toBeTruthy();
    await press(view.getByText('Cancel · coins back'));
    expect(rpcCalls.some((c) => c.fn === 'speed_leave_queue')).toBe(true);
    expect(view.getByText('Find my date · free')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('paid date: shows price and a Top up prompt when coins are short', async () => {
    speedMock.freeToday = false;
    speedMock.coins = 20;
    const view = await open('/speed');
    await settle();
    expect(view.getByText('50 coins per date')).toBeTruthy();
    expect(view.getByText('Top up · need 30 more')).toBeTruthy();
    expect(view.getByLabelText('Top up, you have 20 coins')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('before the call → live (photos in Expo Go) → private Match → MATCH moment', async () => {
    speedMock.phase = 'pending';
    const view = await open('/speed');
    await settle();
    expect(view.getByText('BEFORE THE CALL')).toBeTruthy();
    expect(view.getByText('✨ You both like Jazz')).toBeTruthy();
    expect(view.getByText('“Best jazz bar you have ever been to?”')).toBeTruthy();
    expect(view.getByLabelText('Report')).toBeTruthy();
    await press(view.getByText(/^I'm ready/));
    expect(view.getByText(/Video works in the MATCH app/)).toBeTruthy();
    expect(view.getByLabelText('Leave date')).toBeTruthy();
    expect(view.getByLabelText('Report')).toBeTruthy();
    speedMock.phase = 'deciding';
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_100);
    });
    await settle();
    expect(view.getByText('Match with Bruno?')).toBeTruthy();
    expect(view.getByText(/Your pick is private/)).toBeTruthy();
    await press(view.getByText('Match'));
    expect(rpcCalls.find((c) => c.fn === 'speed_choose')?.args).toEqual({ p_session: 'sd1', p_choice: 'match' });
    expect(view.getAllByText(/It's a match with Bruno/).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('report during a date files a report and ends it for free', async () => {
    speedMock.phase = 'live';
    const view = await open('/speed');
    await settle();
    await press(view.getByLabelText('Report'));
    await press(view.getByText('Report and leave'));
    expect(rpcCalls.find((c) => c.fn === 'speed_leave')?.args).toEqual({ p_session: 'sd1', p_reason: 'report' });
    expect(view.getByText(/This date was ended after a report/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('group rooms: lobby modes + invites, roulette room, private picks → matches', async () => {
    const view = await open('/speed?tab=group');
    await settle();
    expect(view.getByText('Bruno invited you')).toBeTruthy();
    expect(view.getByLabelText('Join Hiking room')).toBeTruthy();
    expect(view.getByText('Invite matches')).toBeTruthy();
    await press(view.getByText('Join a roulette room'));
    expect(rpcCalls.find((c) => c.fn === 'group_join')?.args).toMatchObject({ p_mode: 'roulette' });
    expect(view.getByText('Roulette room')).toBeTruthy();
    expect(view.getByLabelText('Leave room')).toBeTruthy();
    expect(view.getByLabelText('Report')).toBeTruthy();
    groupMock.phase = 'picking';
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_100);
    });
    await settle();
    expect(view.getByText('Who did you like?')).toBeTruthy();
    await press(view.getByLabelText('Pick Bruno'));
    await press(view.getByText('Save 1 private pick'));
    expect(rpcCalls.find((c) => c.fn === 'group_pick')?.args).toEqual({ p_room: 'g1', p_picked: [OTHER] });
    expect(view.getByText(/You matched with 1 person/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('Speed Dating Night banner on Home while it is on', async () => {
    speedMock.nightActive = true;
    const view = await open('/home');
    await settle();
    expect(view.getByLabelText('Speed Dating Night is on now')).toBeTruthy();
    expect(errors).toEqual([]);
  });
});
