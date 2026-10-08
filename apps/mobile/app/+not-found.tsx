import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: T.ink }}>
        <Txt v="display" size={22}>
          This screen doesn't exist.
        </Txt>
        <Link href="/" style={{ marginTop: 15, paddingVertical: 15 }}>
          <Txt w={600} color={T.rose}>
            Go to home screen
          </Txt>
        </Link>
      </View>
    </>
  );
}
