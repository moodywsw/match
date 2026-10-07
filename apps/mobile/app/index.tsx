import { Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function Index() {
  const { session, profile, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (profile && !profile.onboarding_complete) return <Redirect href="/(onboarding)" />;
  return <Redirect href="/(tabs)/discover" />;
}
