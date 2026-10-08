import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LitMatch } from '@/components/ui/LitMatch';
import { Backdrop, FadeUp, PopIn, PrimaryButton, RadialBlob } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

/** Landing: only "MATCH" + lit match, tagline, emoji chips, [Enter MATCH]. */
export default function Landing() {
  const router = useRouter();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  if (session) return <View style={{ flex: 1, backgroundColor: T.ink }} />;

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Backdrop />
      <RadialBlob color={T.rose} size={260} opacity={0.33} style={{ top: -80 + insets.top, right: -60 }} />
      <RadialBlob color={T.violet} size={240} opacity={0.27} style={{ bottom: -60, left: -60 }} />
      <FadeUp style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Txt v="display" w={600} size={64} style={{ letterSpacing: -2, lineHeight: 72 }}>
            MATCH
          </Txt>
          <LitMatch size={30} />
        </View>
        <Txt v="display" w={500} size={21} center style={{ marginTop: 22, maxWidth: 320 }}>
          Meet people who match your vibe.
        </Txt>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 36 }}>
          {['🎵', '🍣', '✈️', '🎬', '🏋️'].map((e, i) => (
            <PopIn key={e} delay={i * 80} duration={400}>
              <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={18}>{e}</Txt>
              </View>
            </PopIn>
          ))}
        </View>

        <PrimaryButton label="Enter MATCH" onPress={() => router.push('/(auth)/sign-in')} style={{ marginTop: 44, width: '100%', maxWidth: 280 }} />
      </FadeUp>
    </View>
  );
}
