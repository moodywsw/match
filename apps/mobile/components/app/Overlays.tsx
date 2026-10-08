import { Check, Crown, Eye, EyeOff, RotateCcw, X, Zap } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CenterModal, Sheet } from '@/components/ui/Sheet';
import { IconBtn, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { purchaseEntitlement, type EntitlementId } from '@/lib/iap';
import { NOTIFS } from '@/lib/mock';

export type NotifItem = { icon: string; text: string; time: string };

export function NotificationsPanel({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: NotifItem[] }) {
  const insets = useSafeAreaInsets();
  const list = items.length ? items : NOTIFS;
  return (
    <CenterModal visible={visible} onClose={onClose} top={insets.top + 60} style={{ width: '94%', maxWidth: 460, maxHeight: '78%', padding: 20, borderRadius: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Txt v="display" size={19}>
          Notifications
        </Txt>
        <IconBtn onPress={onClose}>
          <X size={16} color={T.text} />
        </IconBtn>
      </View>
      {list.map((n, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: i < list.length - 1 ? 1 : 0, borderBottomColor: T.border }}>
          <Txt size={18}>{n.icon}</Txt>
          <Txt size={13} style={{ flex: 1 }}>
            {n.text}
          </Txt>
          <Txt size={11} color={T.mutedDim}>
            {n.time}
          </Txt>
        </View>
      ))}
    </CenterModal>
  );
}

function FeatureIcon({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: T.surface2, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4 }}>
      <View style={{ marginBottom: 4 }}>{icon}</View>
      <Txt size={9.5} color={T.muted}>
        {label}
      </Txt>
    </View>
  );
}

const PLANS: Record<EntitlementId, { name: string; price: string; color: string; features: string[] }> = {
  match_plus: { name: 'MATCH+', price: '€14.99/mo', color: T.violet, features: ['Unlimited likes', 'See who liked you', 'Advanced filters', '5 boosts / month', 'Rewind last swipe'] },
  super_match: { name: 'SUPER MATCH', price: '€24.99/mo', color: T.amber, features: ['Everything in MATCH+', 'Incognito mode', 'Unlimited messages', 'Weekly profile boost', 'Exclusive events access'] },
};

export function PremiumModal({ visible, onClose, toast }: { visible: boolean; onClose: () => void; toast: (m: string) => void }) {
  const [plan, setPlan] = useState<EntitlementId>('match_plus');
  const [busy, setBusy] = useState(false);
  const p = PLANS[plan];
  async function onContinue() {
    setBusy(true);
    const res = await purchaseEntitlement(plan);
    setBusy(false);
    if (!res.ok) toast('In-app purchases arrive with the App Store release ✨');
  }
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} maxHeight="88%">
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <Crown size={30} color={T.amber} />
        <Txt v="display" size={24} style={{ marginTop: 8, marginBottom: 4 }}>
          Go further with MATCH+
        </Txt>
        <Txt size={13} color={T.muted} center>
          Cancel anytime. Your free experience stays fully usable.
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
        {(Object.keys(PLANS) as EntitlementId[]).map((key) => {
          const pl = PLANS[key];
          const on = plan === key;
          return (
            <Pressable key={key} onPress={() => setPlan(key)} style={{ flex: 1, padding: 16, borderRadius: 18, borderWidth: 2, borderColor: on ? pl.color : T.border, backgroundColor: on ? `${pl.color}18` : T.surface2 }}>
              <Txt w={800} size={13}>
                {pl.name}
              </Txt>
              <Txt v="mono" size={15} color={pl.color} style={{ marginTop: 6 }}>
                {pl.price}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 10, marginBottom: 22 }}>
        {p.features.map((f) => (
          <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Check size={16} color={p.color} />
            <Txt size={13.5}>{f}</Txt>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <FeatureIcon icon={<Zap size={16} color={T.amber} />} label="Boost" />
        <FeatureIcon icon={<Eye size={16} color={T.amber} />} label="See likes" />
        <FeatureIcon icon={<RotateCcw size={16} color={T.amber} />} label="Rewind" />
        <FeatureIcon icon={<EyeOff size={16} color={T.amber} />} label="Incognito" />
      </View>
      <PrimaryButton label={`Continue with ${p.name}`} colors={[p.color, T.rose]} onPress={onContinue} loading={busy} />
      <TextButton label="Maybe later" onPress={onClose} size={13} />
    </Sheet>
  );
}
