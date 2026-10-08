import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
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
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isUp = mode === 'sign-up';

  async function onSubmit() {
    setError(null);
    setInfo(null);
    if (isUp && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    if (isUp) {
      const res = await signUp(email.trim(), password);
      setBusy(false);
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) setInfo('Almost there — check your inbox to confirm your email, then sign in.');
    } else {
      const res = await signIn(email.trim(), password);
      setBusy(false);
      if (res.error) setError(res.error);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Backdrop />
      <RadialBlob color={T.rose} size={260} opacity={0.25} style={{ top: -90, right: -70 }} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
          <IconBtn size={36} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
            <ArrowLeft size={17} color={T.text} />
          </IconBtn>
          <Wordmark size={20} match={14} />
          <View style={{ width: 36 }} />
        </View>
        <FadeUp key={mode}>
          <Txt v="display" size={30} style={{ marginBottom: 6 }}>
            {isUp ? 'Create your account' : 'Welcome back'}
          </Txt>
          <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
            {isUp ? 'It takes a minute. Your taste does the rest.' : 'Sign in to see who matches your vibe.'}
          </Txt>
          <TextInput
            style={[inputStyle, { marginBottom: 12 }]}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={T.mutedDim}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={inputStyle}
            secureTextEntry
            placeholder={isUp ? 'Password (min. 6 characters)' : 'Password'}
            placeholderTextColor={T.mutedDim}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSubmit}
          />
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
          <PrimaryButton
            label={isUp ? 'Create account' : 'Sign in'}
            onPress={onSubmit}
            loading={busy}
            disabled={!email || !password}
            style={{ marginTop: 24 }}
          />
          <Pressable onPress={() => router.replace(isUp ? '/(auth)/sign-in' : '/(auth)/sign-up')} style={{ alignSelf: 'center', paddingVertical: 16 }}>
            <Txt size={13.5} color={T.muted}>
              {isUp ? 'Already have an account? ' : 'New to MATCH? '}
              <Txt w={700} size={13.5} color={T.rose}>
                {isUp ? 'Sign in' : 'Create an account'}
              </Txt>
            </Txt>
          </Pressable>
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
