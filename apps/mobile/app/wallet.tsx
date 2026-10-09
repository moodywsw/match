import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Coins } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WalletView } from '@/components/app/Wallet';
import { IconBtn } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';

/** Wallet screen: balance, top up, earn free coins, history. Reachable from Profile, Live and gift sheets. */
export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { need } = useLocalSearchParams<{ need?: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: T.ink, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
        <IconBtn label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}>
          <ChevronLeft size={18} color={T.text} />
        </IconBtn>
        <Coins size={18} color={T.amber} />
        <Txt v="display" size={20} style={{ flex: 1 }}>
          Wallet
        </Txt>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: insets.bottom + 40 }}>
        <WalletView need={need ? Number(need) || undefined : undefined} />
      </ScrollView>
    </View>
  );
}
