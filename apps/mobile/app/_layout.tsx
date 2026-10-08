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
import { T } from '@/constants/theme';
import { AppProvider } from '@/contexts/AppContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: T.ink, card: T.surface, primary: T.rose, text: T.text, border: T.border },
};

function AuthGate({ children, fontsReady }: { children: React.ReactNode; fontsReady: boolean }) {
  const { session, profile, loading } = useAuth();
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

    if (!session) {
      if (!inAuth && !onLanding) router.replace('/');
      return;
    }
    // Signed in but no complete profile yet → prototype onboarding flow.
    if (!profile || !profile.onboarding_complete) {
      if (!inOnboarding) router.replace('/(onboarding)');
      return;
    }
    if (inAuth || inOnboarding || onLanding) router.replace('/(tabs)/home');
  }, [session, profile, loading, fontsReady, segments, router]);

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
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.ink }, animation: 'fade' }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[conversationId]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="legal/privacy" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="legal/terms" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="+not-found" />
            </Stack>
          </AppProvider>
        </AuthGate>
      </ThemeProvider>
    </AuthProvider>
  );
}
