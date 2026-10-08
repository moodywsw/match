import { Stack } from 'expo-router';

import { T } from '@/constants/theme';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.ink }, animation: 'fade' }} />;
}
