import { Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { LitMatch } from '@/components/ui/LitMatch';
import { PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { AppProvider } from '@/contexts/AppContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CallProvider } from '@/contexts/CallContext';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: T.ink, card: T.surface, primary: T.rose, text: T.text, border: T.border },
};

function AuthGate({ children, fontsReady }: { children: React.ReactNode; fontsReady: boolean }) {
  const { session, profile, loading, profileError, recovery, refreshProfile, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading || !fontsReady) return;
    const root = segments[0] as string | undefined;
    const inAuth = root === '(auth)';
    const inOnboarding = root === '(onboarding)';
    const onLanding = !root || root === 'index';
    // Legal pages are reachable signed in or out (sign-up, paywall, settings).
    if (root === 'legal') return;
    // Password reset link: the user must choose a new password before anything else.
    if (recovery) {
      if (root !== 'reset-password') router.replace('/reset-password');
      return;
    }
    if (root === 'reset-password') return;

    if (!session) {
      if (!inAuth && !onLanding) router.replace('/');
      return;
    }
    // Signed in but no complete profile yet → prototype onboarding flow.
    if (profileError) return;
    if (!profile || !profile.onboarding_complete) {
      if (!inOnboarding) router.replace('/(onboarding)');
      return;
    }
    if (inAuth || inOnboarding || onLanding) router.replace('/(tabs)/home');
  }, [session, profile, loading, profileError, recovery, fontsReady, segments, router]);

  useEffect(() => {
    if (!loading && fontsReady) SplashScreen.hideAsync();
  }, [loading, fontsReady]);

  if (loading || !fontsReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.ink }}>
        <LitMatch size={28} />
      </View>
    );
  }
  if (profileError && !recovery) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.ink, padding: 32, gap: 14 }}>
        <LitMatch size={28} />
        <Txt v="display" size={22} center>
          We couldn't load your profile
        </Txt>
        <Txt size={14} color={T.muted} center>
          Check your connection and try again.
        </Txt>
        <PrimaryButton label="Try again" onPress={() => void refreshProfile()} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        <TextButton label="Sign out" onPress={() => void signOut()} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  return (
    <AuthProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <AuthGate fontsReady={fontsLoaded || !!fontError}>
          <AppProvider>
            <CallProvider>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.ink }, animation: 'fade' }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="chat/[conversationId]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="event/[eventId]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="post/[postId]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="story/[storyId]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="legal/privacy" options={{ animation: 'slide_from_bottom' }} />
                <Stack.Screen name="legal/terms" options={{ animation: 'slide_from_bottom' }} />
                <Stack.Screen name="wallet" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="reset-password" options={{ animation: 'fade', gestureEnabled: false }} />
                <Stack.Screen name="+not-found" />
              </Stack>
            </CallProvider>
          </AppProvider>
        </AuthGate>
      </ThemeProvider>
    </AuthProvider>
  );
}
