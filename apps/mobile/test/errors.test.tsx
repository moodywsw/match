import { authErrorMessage, friendlyError, isCancelled } from '@/lib/errors';

describe('friendlyError', () => {
  test('maps server guard codes', () => {
    expect(friendlyError({ message: 'daily_like_limit' })).toMatch(/out of likes/);
    expect(friendlyError({ message: 'insufficient_coins' })).toMatch(/Not enough coins/);
  });
  test('hides raw Postgres / network text', () => {
    expect(friendlyError({ message: 'new row violates row-level security policy for table "x"' }, 'Nope')).toBe("You can't do that");
    expect(friendlyError({ message: 'column foo does not exist' }, 'Nope')).toBe('Nope');
    expect(friendlyError(new TypeError('Network request failed'))).toMatch(/No connection/);
    expect(friendlyError({ message: 'some_unknown_code' }, 'Nope')).toBe('Nope');
  });
  test('keeps short human messages', () => {
    expect(friendlyError(new Error('Pick a shorter title'))).toBe('Pick a shorter title');
  });
});

describe('isCancelled', () => {
  test('detects user cancellation only', () => {
    expect(isCancelled(new Error('cancelled'))).toBe(true);
    expect(isCancelled(new Error('Upload failed'))).toBe(false);
    expect(isCancelled({ message: 'event_cancelled' })).toBe(false);
  });
});

describe('authErrorMessage', () => {
  test('plain English for common auth failures', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toMatch(/password/i);
    expect(authErrorMessage({ message: 'User already registered' })).toMatch(/already/i);
  });
});
