import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { clearPushToken, registerForPushNotifications } from '@/lib/notifications';
import { ensureProfileStub, type Profile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const pushAttempted = useRef<string | null>(null);
  const pushToken = useRef<{ uid: string; token: string } | null>(null);

  const loadProfile = useCallback(async (user: User) => {
    try {
      const row = await ensureProfileStub(user.id, user.email);
      setProfile(row);
    } catch (err) {
      console.warn('[match] profile bootstrap failed', err);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        loadProfile(next.user);
      } else {
        setProfile(null);
        pushAttempted.current = null;
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

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
    await loadProfile(session.user);
  }, [loadProfile, session?.user]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    // Without a session (email confirmation on) RLS would reject the stub;
    // AuthProvider creates it on first sign-in instead.
    if (data.user && data.session) {
      try {
        await ensureProfileStub(data.user.id, data.user.email ?? email);
      } catch (err) {
        console.warn('[match] profile stub after sign-up failed', err);
      }
    }
    return { error: null, needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    // Unlink this device's push token first (needs the session for RLS) so the
    // next person signing in here doesn't receive the previous user's pushes.
    const reg = pushToken.current;
    pushToken.current = null;
    if (reg) await clearPushToken(reg.uid, reg.token).catch(() => {});
    await supabase.auth.signOut();
    setProfile(null);
    pushAttempted.current = null;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      refreshProfile,
      signIn,
      signUp,
      signOut,
    }),
    [session, profile, loading, refreshProfile, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
