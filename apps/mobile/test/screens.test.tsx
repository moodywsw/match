/**
 * Smoke test: every route renders through the real root layout (auth gate,
 * providers, tab bar) with a mocked Supabase client, without throwing and
 * without React reporting errors.
 */
import { act, fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import path from 'path';

import { OTHER, state } from './supabaseMock';

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

  test('wallet shows balance, disabled packs and no cash-out', async () => {
    const view = await open('/profile');
    await act(async () => {
      fireEvent.press(view.getByText('Wallet · MATCH coins'));
    });
    await settle();
    expect(view.getByText('42')).toBeTruthy();
    expect(view.getByText('1,200 coins')).toBeTruthy();
    expect(view.getByText(/Coin packs (can be bought in the installed MATCH app|open as soon as the store is connected)/)).toBeTruthy();
    expect(view.getByText(/payouts coming soon/)).toBeTruthy();
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
    expect(errors).toEqual([]);
  });
});
