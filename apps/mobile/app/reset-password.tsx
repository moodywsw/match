import { useRouter } from 'expo-router';
import { Eye, EyeOff, KeyRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inputStyle } from '@/components/app/AuthForm';
import { Wordmark } from '@/components/app/Bars';
import { Backdrop, FadeUp, PrimaryButton, RadialBlob, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

/** Landing screen for the password-reset email link (match://reset-password#…). */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, recovery, linkError, updatePassword, clearLinkError } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [waited, setWaited] = useState(false);

  // The link is processed asynchronously; if nothing arrives, say so instead of spinning forever.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const canSet = !!session && (recovery || done);

  const submit = async () => {
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    const res = await updatePassword(password);
    setBusy(false);
    if (res.error) return setError(res.error);
    setDone(true);
  };

  const goSignIn = () => {
    clearLinkError();
    router.replace('/(auth)/sign-in');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Backdrop />
      <RadialBlob color={T.rose} size={260} opacity={0.25} style={{ top: -90, right: -70 }} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 36 }}>
          <Wordmark size={20} match={14} />
        </View>
        <FadeUp>
          {done ? (
            <>
              <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                Password updated
              </Txt>
              <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
                You're signed in. Use your new password next time.
              </Txt>
              <PrimaryButton label="Continue" onPress={() => router.replace('/')} />
            </>
          ) : linkError ? (
            <>
              <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                Link expired
              </Txt>
              <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
                {linkError}
              </Txt>
              <PrimaryButton label="Back to sign in" onPress={goSignIn} />
            </>
          ) : canSet ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <KeyRound size={22} color={T.amber} />
                <Txt v="display" size={30}>
                  New password
                </Txt>
              </View>
              <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
                Choose a new password for {session?.user?.email ?? 'your account'}.
              </Txt>
              <View>
                <TextInput
                  style={[inputStyle, { paddingRight: 52 }]}
                  secureTextEntry={!show}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  placeholder="New password (min. 8 characters)"
                  placeholderTextColor={T.mutedDim}
                  value={password}
                  onChangeText={setPassword}
                  autoFocus
                />
                <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={{ position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' }} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={18} color={T.muted} /> : <Eye size={18} color={T.muted} />}
                </Pressable>
              </View>
              <TextInput
                style={[inputStyle, { marginTop: 12 }]}
                secureTextEntry={!show}
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="Repeat new password"
                placeholderTextColor={T.mutedDim}
                value={confirm}
                onChangeText={setConfirm}
                onSubmitEditing={submit}
              />
              {error ? (
                <Txt size={13} color={T.rose} style={{ marginTop: 12 }}>
                  {error}
                </Txt>
              ) : null}
              <PrimaryButton label="Save new password" onPress={submit} loading={busy} disabled={!password || !confirm} style={{ marginTop: 24 }} />
            </>
          ) : waited ? (
            <>
              <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                Open the link again
              </Txt>
              <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
                We couldn't read your reset link. Open the newest reset email on this phone, or request a new link.
              </Txt>
              <PrimaryButton label="Back to sign in" onPress={goSignIn} />
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 14 }}>
              <ActivityIndicator color={T.rose} />
              <Txt size={14} color={T.muted}>
                Opening your reset link…
              </Txt>
            </View>
          )}
          {!done && canSet ? <TextButton label="Cancel" onPress={goSignIn} /> : null}
        </FadeUp>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
