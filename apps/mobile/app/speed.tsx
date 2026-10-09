import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Zap } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupRooms, SpeedNightBanner, SpeedOneOnOne } from '@/components/app/SpeedDating';
import { IconBtn } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { DEFAULT_SPEED_PREFS, fetchSpeedNight, type SpeedNight, type SpeedPrefs } from '@/lib/speed';

/** Speed Dating: 1:1 two-minute video dates + group dating rooms. Reachable from Live and Home. */
export default function SpeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'one' | 'group'>(params.tab === 'group' ? 'group' : 'one');
  const [prefs, setPrefs] = useState<SpeedPrefs>(DEFAULT_SPEED_PREFS);
  const [night, setNight] = useState<SpeedNight | null>(null);
  useFocusEffect(
    useCallback(() => {
      fetchSpeedNight()
        .then(setNight)
        .catch(() => setNight(null));
    }, [])
  );
  const fixProfile = () => router.navigate('/(tabs)/profile');
  return (
    <View style={{ flex: 1, backgroundColor: T.ink, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
        <IconBtn label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/live'))}>
          <ChevronLeft size={18} color={T.text} />
        </IconBtn>
        <Zap size={18} color={T.amber} />
        <Txt v="display" size={20} style={{ flex: 1 }}>
          Speed Dating
        </Txt>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: insets.bottom + 40 }}>
        <SpeedNightBanner night={night} onPress={() => setTab('one')} />
        <View style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: T.surface2, marginBottom: 16 }}>
          {(
            [
              ['one', '💞 1:1 dates'],
              ['group', '👥 Group rooms'],
            ] as const
          ).map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => setTab(id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999, backgroundColor: tab === id ? `${T.rose}33` : 'transparent' }}>
              <Txt w={700} size={13} color={tab === id ? '#fff' : T.muted}>
                {label}
              </Txt>
            </Pressable>
          ))}
        </View>
        {tab === 'one' ? <SpeedOneOnOne prefs={prefs} setPrefs={setPrefs} onFixProfile={fixProfile} /> : <GroupRooms prefs={prefs} setPrefs={setPrefs} onFixProfile={fixProfile} />}
      </ScrollView>
    </View>
  );
}
