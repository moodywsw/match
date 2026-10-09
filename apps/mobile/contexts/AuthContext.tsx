import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { authErrorMessage } from '@/lib/errors';
import { clearPushToken, registerForPushNotifications } from '@/lib/notifications';
import { ensureProfileStub, type Profile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

type ProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True while the session is restored or the signed-in user's profile is first loaded. */
  loading: boolean;
  /** The profile couldn't be loaded (offline / server error) — show a retry, not onboarding. */
  profileError: boolean;
  /** Signed in through a password-reset link: the user must set a new password. */
  recovery: boolean;
  /** Last problem with an auth deep link (expired / invalid reset link). */
  linkError: string | null;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  clearLinkError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Where the reset email sends people back to (match://reset-password, or exp://…/--/reset-password in Expo Go). */
export function passwordResetRedirect(): string {
  return Linking.createURL('reset-password');
}

/** Read params from both the query string and the #fragment (Supabase puts tokens in the fragment). */
function authParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (part: string | undefined) => {
    if (!part) return;
    for (const kv of part.split('&')) {
      const [k, v = ''] = kv.split('=');
      if (!k) continue;
      try {
        out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
      } catch {
        out[k] = v;
      }
    }
  };
  const [beforeHash, hash] = url.split('#');
  take(beforeHash.split('?')[1]);
  take(hash);
  return out;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [recovery, setRecovery] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const pushAttempted = useRef<string | null>(null);
  const pushToken = useRef<{ uid: string; token: string } | null>(null);
  const loadedFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (user: User, silent = false) => {
    if (!silent) setProfileStatus('loading');
    try {
      const row = await ensureProfileStub(user.id, user.email);
      setProfile(row);
      setProfileStatus('ready');
    } catch (err) {
      console.warn('[match] profile bootstrap failed', err);
      if (!silent) {
        setProfile(null);
        setProfileStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        const u = data.session?.user;
        if (u) {
          loadedFor.current = u.id;
          void loadProfile(u);
        }
      })
      .finally(() => mounted && setRestoring(false));

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      const u = next?.user;
      if (!u) {
        loadedFor.current = null;
        setProfile(null);
        setProfileStatus('idle');
        setRecovery(false);
        pushAttempted.current = null;
        return;
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      // Only (re)load the profile for a new user or an explicit account update — not on
      // every TOKEN_REFRESHED. Deferred: calling Supabase inside this callback can deadlock.
      if (loadedFor.current !== u.id) {
        loadedFor.current = u.id;
        setTimeout(() => void loadProfile(u), 0);
      } else if (event === 'USER_UPDATED') {
        setTimeout(() => void loadProfile(u, true), 0);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  /* ---------- auth deep links (password reset) ---------- */
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const p = authParams(url);
      const isAuthLink = url.includes('reset-password') || !!p.access_token || !!p.code || !!p.error_description;
      if (!isAuthLink) return;
      if (p.error_description || p.error) {
        setLinkError(authErrorMessage({ message: p.error_description || p.error, code: p.error_code }, 'This link is invalid or has expired — request a new one.'));
        return;
      }
      try {
        if (p.access_token && p.refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
          if (error) throw error;
        } else if (p.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(p.code);
          if (error) throw error;
        } else {
          return;
        }
        setLinkError(null);
        if (p.type === 'recovery' || url.includes('reset-password')) setRecovery(true);
      } catch (err) {
        setLinkError(authErrorMessage(err as { message?: string }, 'This link is invalid or has expired — request a new one.'));
      }
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => void handle(url));
    return () => sub.remove();
  }, []);

  // Best-effort push permission + token capture after session is ready
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || pushAttempted.current === uid) return;
    pushAttempted.current = uid;
    registerForPushNotifications(uid).then((result) => {
      if (result.token) pushToken.current = { uid, token: result.token };
      if (result.status !== 'registered') {
        console.info('[match] push registration:', result.status, result.detail ?? '');
      }
    });
  }, [session?.user?.id]);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    // Retry after an error shows the splash again; otherwise refresh in place.
    await loadProfile(session.user, profileStatus === 'ready');
  }, [loadProfile, session?.user, profileStatus]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? authErrorMessage(error) : null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: authErrorMessage(error) };
    // Supabase answers an existing (confirmed) email with a user that has no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: 'An account with this email already exists — sign in instead.' };
    }
    return { error: null, needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    // Unlink this device's push token first (needs the session for RLS) so the
    // next person signing in here doesn't receive the previous user's pushes.
    const reg = pushToken.current;
    pushToken.current = null;
    if (reg) await clearPushToken(reg.uid, reg.token).catch(() => {});
    const { error } = await supabase.auth.signOut();
    // Offline sign-out still clears the local session.
    if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    setProfile(null);
    setRecovery(false);
    pushAttempted.current = null;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: passwordResetRedirect() });
    return { error: error ? authErrorMessage(error) : null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: authErrorMessage(error) };
    setRecovery(false);
    return { error: null };
  }, []);

  const clearLinkError = useCallback(() => setLinkError(null), []);

  const loading = restoring || (!!session?.user && profileStatus !== 'ready' && profileStatus !== 'error');

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileError: !!session?.user && profileStatus === 'error',
      recovery,
      linkError,
      refreshProfile,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      clearLinkError,
    }),
    [session, profile, loading, profileStatus, recovery, linkError, refreshProfile, signIn, signUp, signOut, requestPasswordReset, updatePassword, clearLinkError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
