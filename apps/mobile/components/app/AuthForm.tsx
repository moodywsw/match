import { useRouter } from 'expo-router';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/app/Bars';
import { Backdrop, FadeUp, IconBtn, PrimaryButton, RadialBlob } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

export const inputStyle = {
  width: '100%' as const,
  paddingVertical: 16,
  paddingHorizontal: 18,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: T.border,
  backgroundColor: T.surface2,
  color: T.text,
  fontSize: 16,
  ...body(400),
};

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [show, setShow] = useState(false);
  const isUp = mode === 'sign-up';
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function onReset() {
    setError(null);
    setInfo(null);
    if (!validEmail) {
      setError('Enter the email you signed up with.');
      return;
    }
    setBusy(true);
    const res = await requestPasswordReset(email.trim().toLowerCase());
    setBusy(false);
    if (res.error) setError(res.error);
    else setInfo(`If ${email.trim()} has an account, a reset link is on its way. Open it on this phone to choose a new password.`);
  }

  async function onSubmit() {
    setError(null);
    setInfo(null);
    if (busy) return;
    if (!validEmail) {
      setError('That email address doesn’t look right.');
      return;
    }
    if (isUp && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    if (isUp) {
      const res = await signUp(email.trim().toLowerCase(), password);
      setBusy(false);
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) setInfo('Almost there — check your inbox to confirm your email, then sign in.');
    } else {
      const res = await signIn(email.trim().toLowerCase(), password);
      setBusy(false);
      if (res.error) setError(res.error);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Backdrop />
      <RadialBlob color={T.rose} size={260} opacity={0.25} style={{ top: -90, right: -70 }} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
          <IconBtn size={36} label="Back" onPress={() => (forgot ? setForgot(false) : router.canGoBack() ? router.back() : router.replace('/'))}>
            <ArrowLeft size={17} color={T.text} />
          </IconBtn>
          <Wordmark size={20} match={14} />
          <View style={{ width: 36 }} />
        </View>
        <FadeUp key={forgot ? 'forgot' : mode}>
          <Txt v="display" size={30} style={{ marginBottom: 6 }}>
            {forgot ? 'Reset your password' : isUp ? 'Create your account' : 'Welcome back'}
          </Txt>
          <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
            {forgot ? "Enter your email and we'll send you a link to choose a new password." : isUp ? 'It takes a minute. Your taste does the rest.' : 'Sign in to see who matches your vibe.'}
          </Txt>
          <TextInput
            style={[inputStyle, { marginBottom: 12 }]}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            autoCorrect={false}
            textContentType="emailAddress"
            placeholder="Email"
            placeholderTextColor={T.mutedDim}
            value={email}
            onChangeText={setEmail}
            returnKeyType={forgot ? 'send' : 'next'}
            onSubmitEditing={forgot ? onReset : undefined}
          />
          {forgot ? null : (
            <View>
              <TextInput
                style={[inputStyle, { paddingRight: 52 }]}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoComplete={isUp ? 'new-password' : 'current-password'}
                textContentType={isUp ? 'newPassword' : 'password'}
                placeholder={isUp ? 'Password (min. 8 characters)' : 'Password'}
                placeholderTextColor={T.mutedDim}
                value={password}
                onChangeText={setPassword}
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
              <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={{ position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' }} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff size={18} color={T.muted} /> : <Eye size={18} color={T.muted} />}
              </Pressable>
            </View>
          )}
          {!isUp && !forgot ? (
            <Pressable
              onPress={() => {
                setForgot(true);
                setError(null);
                setInfo(null);
              }}
              hitSlop={8}
              style={{ alignSelf: 'flex-end', paddingTop: 12 }}>
              <Txt size={13} color={T.muted}>
                Forgot password?
              </Txt>
            </Pressable>
          ) : null}
          {error ? (
            <Txt size={13} color={T.rose} style={{ marginTop: 12 }}>
              {error}
            </Txt>
          ) : null}
          {info ? (
            <Txt size={13} color={T.mint} style={{ marginTop: 12 }}>
              {info}
            </Txt>
          ) : null}
          {forgot ? (
            <>
              <PrimaryButton label="Send reset link" onPress={onReset} loading={busy} disabled={!email} style={{ marginTop: 24 }} />
              <Pressable onPress={() => setForgot(false)} style={{ alignSelf: 'center', paddingVertical: 16 }}>
                <Txt size={13.5} color={T.muted}>
                  Remembered it?{' '}
                  <Txt w={700} size={13.5} color={T.rose}>
                    Sign in
                  </Txt>
                </Txt>
              </Pressable>
            </>
          ) : (
            <PrimaryButton
              label={isUp ? 'Create account' : 'Sign in'}
              onPress={onSubmit}
              loading={busy}
              disabled={!email || !password}
              style={{ marginTop: 24 }}
            />
          )}
          {forgot ? null : (
          <Pressable onPress={() => router.replace(isUp ? '/(auth)/sign-in' : '/(auth)/sign-up')} style={{ alignSelf: 'center', paddingVertical: 16 }}>
            <Txt size={13.5} color={T.muted}>
              {isUp ? 'Already have an account? ' : 'New to MATCH? '}
              <Txt w={700} size={13.5} color={T.rose}>
                {isUp ? 'Sign in' : 'Create an account'}
              </Txt>
            </Txt>
          </Pressable>
          )}
          <Txt size={11.5} color={T.mutedDim} center style={{ marginTop: 10, lineHeight: 17 }}>
            MATCH is for adults 18+. By continuing you agree to our{' '}
            <Txt size={11.5} color={T.muted} onPress={() => router.push('/legal/terms')}>
              Terms
            </Txt>{' '}
            and{' '}
            <Txt size={11.5} color={T.muted} onPress={() => router.push('/legal/privacy')}>
              Privacy Policy
            </Txt>
            .
          </Txt>
        </FadeUp>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
