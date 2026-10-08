import { Check, Crown, Eye, EyeOff, RotateCcw, X, Zap } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CenterModal, Sheet } from '@/components/ui/Sheet';
import { IconBtn, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { fallbackPrice, fetchOfferingPrices, getIapStatus, purchaseEntitlement, restorePurchases, type EntitlementId, type Tier } from '@/lib/iap';
import { NOTIFS } from '@/lib/mock';
import { COMPARISON, defaultPaywallLang, PAYWALL_COPY, PLAN_FEATURES, type PaywallLang } from '@/lib/plans';

export type NotifItem = { id?: string; icon: string; text: string; time: string; unread?: boolean; onPress?: () => void };

export function NotificationsPanel({ visible, onClose, items, demoFallback = true }: { visible: boolean; onClose: () => void; items: NotifItem[]; demoFallback?: boolean }) {
  const insets = useSafeAreaInsets();
  const list: NotifItem[] = items.length ? items : demoFallback ? NOTIFS : [];
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
      <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
        {list.length === 0 ? (
          <Txt size={13} color={T.muted} center style={{ paddingVertical: 18 }}>
            Nothing yet — likes, matches and messages will show up here.
          </Txt>
        ) : null}
        {list.map((n, i) => (
          <Pressable
            key={n.id ?? i}
            onPress={n.onPress}
            disabled={!n.onPress}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: i < list.length - 1 ? 1 : 0, borderBottomColor: T.border, opacity: pressed ? 0.7 : 1 })}>
            <Txt size={18}>{n.icon}</Txt>
            <Txt size={13} w={n.unread ? 600 : 400} style={{ flex: 1 }}>
              {n.text}
            </Txt>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Txt size={11} color={T.mutedDim}>
                {n.time}
              </Txt>
              {n.unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: T.rose }} /> : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
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

const PLANS: Record<EntitlementId, { name: string; color: string }> = {
  match_plus: { name: 'MATCH+', color: T.violet },
  super_match: { name: 'SUPER MATCH', color: T.amber },
};

function Cell({ v, color, w = 1 }: { v: string; color: string; w?: number }) {
  return (
    <View style={{ flex: w, alignItems: 'center', justifyContent: 'center' }}>
      {v === '✓' ? (
        <Check size={14} color={color} />
      ) : (
        <Txt v="mono" size={10.5} color={v === '—' ? T.mutedDim : T.text} center>
          {v}
        </Txt>
      )}
    </View>
  );
}

function ComparisonTable({ lang, highlight }: { lang: PaywallLang; highlight: EntitlementId }) {
  const rows = COMPARISON[lang];
  const head: [string, string][] = [
    [PAYWALL_COPY[lang].free, T.muted],
    ['MATCH+', T.violet],
    ['SUPER', T.amber],
  ];
  return (
    <View style={{ borderWidth: 1, borderColor: T.border, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: T.surface2 }}>
        <View style={{ flex: 1.6 }} />
        {head.map(([h, c], i) => (
          <View key={h} style={{ flex: 1, alignItems: 'center' }}>
            <Txt w={800} size={10.5} color={(i === 1 && highlight === 'match_plus') || (i === 2 && highlight === 'super_match') ? c : T.muted}>
              {h}
            </Txt>
          </View>
        ))}
      </View>
      {rows.map(([label, f, plus, sup], i) => (
        <View key={label} style={{ flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 10, borderTopWidth: i ? 1 : 0, borderTopColor: T.border }}>
          <View style={{ flex: 1.6, justifyContent: 'center' }}>
            <Txt size={11.5} color={T.muted}>
              {label}
            </Txt>
          </View>
          <Cell v={f} color={T.muted} />
          <Cell v={plus} color={T.violet} />
          <Cell v={sup} color={T.amber} />
        </View>
      ))}
    </View>
  );
}

export function PremiumModal({
  visible,
  onClose,
  toast,
  tier = 'free',
  initialPlan = 'match_plus',
  refreshTier,
}: {
  visible: boolean;
  onClose: () => void;
  toast: (m: string) => void;
  tier?: Tier;
  initialPlan?: EntitlementId;
  refreshTier?: () => Promise<Tier>;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<EntitlementId>(initialPlan);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [prices, setPrices] = useState<Partial<Record<EntitlementId, string>>>({});
  const [lang, setLang] = useState<PaywallLang>(defaultPaywallLang);
  const c = PAYWALL_COPY[lang];
  const features = PLAN_FEATURES[lang][plan];
  const status = getIapStatus();
  const p = PLANS[plan];
  const current = tier === plan || (tier === 'super_match' && plan === 'match_plus');

  useEffect(() => {
    if (!visible) return;
    setPlan(initialPlan);
    let alive = true;
    void fetchOfferingPrices().then((pr) => alive && setPrices(pr));
    return () => {
      alive = false;
    };
  }, [visible, initialPlan]);

  /** The webhook is the source of truth — wait for it to land (≤ ~20s). */
  async function waitForEntitlement(want: EntitlementId): Promise<boolean> {
    if (!refreshTier) return false;
    for (let i = 0; i < 10; i++) {
      const t = await refreshTier();
      if (t === want || t === 'super_match') return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  async function onContinue() {
    if (current) return onClose();
    setBusy(true);
    const res = await purchaseEntitlement(plan);
    if (!res.ok) {
      setBusy(false);
      if (res.cancelled) return;
      toast(status.configured ? res.error : 'In-app purchases arrive with the App Store release ✨');
      return;
    }
    const ok = await waitForEntitlement(plan);
    setBusy(false);
    if (ok) {
      toast(`Welcome to ${p.name} ✨`);
      onClose();
    } else {
      toast(status.preview ? 'Simulated purchase done — entitlements activate in a store build' : 'Purchase received — activating shortly');
    }
  }

  async function onRestore() {
    setRestoring(true);
    const res = await restorePurchases();
    if (!res.ok) {
      setRestoring(false);
      toast(status.configured ? res.error : 'Restore arrives with the App Store release');
      return;
    }
    const t = refreshTier ? await refreshTier() : 'free';
    setRestoring(false);
    toast(t === 'free' ? 'No active subscription found' : 'Purchases restored ✨');
    if (t !== 'free') onClose();
  }

  function openLegal(path: '/legal/terms' | '/legal/privacy') {
    onClose();
    router.push(path);
  }

  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} maxHeight="88%">
      <View style={{ flexDirection: 'row', alignSelf: 'flex-end', gap: 2, backgroundColor: T.surface2, borderRadius: 999, padding: 3, marginBottom: 4 }}>
        {(['pt', 'en'] as PaywallLang[]).map((l) => (
          <Pressable key={l} onPress={() => setLang(l)} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: lang === l ? T.rose : 'transparent' }}>
            <Txt w={700} size={10.5} color={lang === l ? '#fff' : T.muted}>
              {l.toUpperCase()}
            </Txt>
          </Pressable>
        ))}
      </View>
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <Crown size={30} color={T.amber} />
        <Txt v="display" size={24} center style={{ marginTop: 8, marginBottom: 4 }}>
          {c.title}
        </Txt>
        <Txt size={13} color={T.muted} center>
          {c.subtitle}
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
                {prices[key] ? `${prices[key]}/mo` : fallbackPrice(key)}
              </Txt>
              {tier === key ? (
                <Txt size={10.5} w={700} color={pl.color} style={{ marginTop: 4 }}>
                  {c.current}
                </Txt>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 10, marginBottom: 18 }}>
        {features.map((f) => (
          <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Check size={16} color={p.color} style={{ marginTop: 1 }} />
            <Txt size={13.5} style={{ flex: 1 }}>
              {f}
            </Txt>
          </View>
        ))}
      </View>
      <Txt w={700} size={12} color={T.muted} style={{ marginBottom: 8 }}>
        {c.compare.toUpperCase()}
      </Txt>
      <ComparisonTable lang={lang} highlight={plan} />
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <FeatureIcon icon={<Zap size={16} color={T.amber} />} label="Boost" />
        <FeatureIcon icon={<Eye size={16} color={T.amber} />} label="See likes" />
        <FeatureIcon icon={<RotateCcw size={16} color={T.amber} />} label="Rewind" />
        <FeatureIcon icon={<EyeOff size={16} color={T.amber} />} label="Incognito" />
      </View>
      {status.preview ? (
        <Txt size={11} color={T.mutedDim} center style={{ marginBottom: 8 }}>
          {c.preview}
        </Txt>
      ) : null}
      <PrimaryButton label={current ? c.youHave(p.name) : c.continueWith(p.name)} colors={[p.color, T.rose]} onPress={onContinue} loading={busy} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        <TextButton label={restoring ? c.restoring : c.restore} onPress={onRestore} size={12.5} />
        <TextButton label={c.later} onPress={onClose} size={12.5} />
      </View>
      <Txt size={10} color={T.mutedDim} center style={{ marginTop: 2, lineHeight: 14 }}>
        {c.renew}{' '}
        <Txt size={10} color={T.muted} onPress={() => openLegal('/legal/terms')}>
          {c.terms}
        </Txt>
        {' · '}
        <Txt size={10} color={T.muted} onPress={() => openLegal('/legal/privacy')}>
          {c.privacy}
        </Txt>
      </Txt>
    </Sheet>
  );
}
