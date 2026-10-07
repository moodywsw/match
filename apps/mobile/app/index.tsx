import { Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Redirect href="/(tabs)/discover" />;
  return <Redirect href="/(auth)/sign-in" />;
}
