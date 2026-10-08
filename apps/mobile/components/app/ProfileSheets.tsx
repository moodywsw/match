import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, Camera, Check, ChevronRight, Eye, EyeOff, Lock, MapPin, Shield, Users } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, TextInput, View } from 'react-native';

import { CenterModal, Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, EmptyState, PrimaryButton, SafetyLink, SettingRow, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllInterests, fetchUserInterestIds, setUserInterests, type Interest } from '@/lib/interests';
import { INTENTIONS } from '@/lib/mock';
import { fetchPrivacySettings, updatePrivacySettings, upsertOwnProfile, type PrivacySettings } from '@/lib/profile';
import { fetchMyBlocks, unblockUser, type BlockedRow } from '@/lib/safety';

import { inputStyle } from './AuthForm';

/* ------------------------------ settings ------------------------------ */
export function SettingsSheet({ visible, onClose, verified, onVerified }: { visible: boolean; onClose: () => void; verified: boolean; onVerified: () => void }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [privacy, setPrivacy] = useState<PrivacySettings>({ show_online_status: true, show_distance: true, is_discoverable: true, who_can_message: 'matches' });
  const [local, setLocal] = useState({ readReceipts: true, incognito: false });
  const [showVerify, setShowVerify] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id) return;
    fetchPrivacySettings(user.id)
      .then((p) => p && setPrivacy(p))
      .catch(() => {});
  }, [visible, user?.id]);

  const setP = async (fields: Partial<PrivacySettings>) => {
    if (!user?.id) return;
    const prev = privacy;
    setPrivacy((p) => ({ ...p, ...fields }));
    try {
      await updatePrivacySettings(user.id, fields);
    } catch (err) {
      setPrivacy(prev);
      toast(err instanceof Error ? err.message : 'Could not save setting');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Safety & privacy" icon={<Shield size={18} color={T.mint} />}>
      <SettingRow icon={<Eye size={16} color={T.text} />} label="Show online status" active={privacy.show_online_status} onPress={() => setP({ show_online_status: !privacy.show_online_status })} />
      <SettingRow icon={<MapPin size={16} color={T.text} />} label="Show distance" active={privacy.show_distance} onPress={() => setP({ show_distance: !privacy.show_distance })} />
      <SettingRow icon={<Check size={16} color={T.text} />} label="Read receipts" active={local.readReceipts} onPress={() => setLocal((l) => ({ ...l, readReceipts: !l.readReceipts }))} />
      <SettingRow icon={<EyeOff size={16} color={T.text} />} label="Incognito mode (MATCH+)" active={local.incognito} onPress={() => setLocal((l) => ({ ...l, incognito: !l.incognito }))} />
      <SettingRow icon={<Users size={16} color={T.text} />} label="Discoverable in search" active={privacy.is_discoverable} onPress={() => setP({ is_discoverable: !privacy.is_discoverable })} />

      <Txt w={700} size={13} color={T.muted} style={{ marginTop: 18, marginBottom: 8 }}>
        WHO CAN MESSAGE YOU
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['everyone', 'Everyone'],
            ['matches', 'Matches only'],
          ] as const
        ).map(([val, label]) => (
          <Pressable key={val} onPress={() => setP({ who_can_message: val })} style={{ flex: 1, padding: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: privacy.who_can_message === val ? T.rose : T.border, backgroundColor: privacy.who_can_message === val ? `${T.rose}22` : T.surface2 }}>
            <Txt size={12.5}>{label}</Txt>
          </Pressable>
        ))}
      </View>

      <Txt w={700} size={13} color={T.muted} style={{ marginTop: 20, marginBottom: 8 }}>
        ACCOUNT
      </Txt>
      <SafetyLink icon={<Lock size={16} color={T.text} />} label="Blocked accounts" onPress={() => setShowBlocked(true)} trailing={<ChevronRight size={15} color={T.mutedDim} />} />
      <SafetyLink icon={<Shield size={16} color={T.text} />} label="Report a problem" onPress={() => setShowReport(true)} trailing={<ChevronRight size={15} color={T.mutedDim} />} />
      <SafetyLink
        icon={<BadgeCheck size={16} color={verified ? T.mint : T.text} />}
        label={verified ? 'Verified ✓' : 'Get verified'}
        onPress={() => !verified && setShowVerify(true)}
        trailing={<ChevronRight size={15} color={T.mutedDim} />}
      />

      <Txt size={11} color={T.mutedDim} style={{ marginTop: 18, lineHeight: 16.5 }}>
        MATCH only ever shows an approximate distance — your exact location is never shared with other users. Built with GDPR-ready data controls.
      </Txt>
      <PrimaryButton label="Done" onPress={onClose} style={{ marginTop: 18 }} />

      <VerificationModal
        visible={showVerify}
        onClose={() => setShowVerify(false)}
        onDone={() => {
          setShowVerify(false);
          onVerified();
        }}
      />
      <BlockedAccountsSheet visible={showBlocked} onClose={() => setShowBlocked(false)} />
      <ReportProblemSheet visible={showReport} onClose={() => setShowReport(false)} />
    </Sheet>
  );
}

function BlockedAccountsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { toast, reloadPeople } = useApp();
  const [rows, setRows] = useState<BlockedRow[]>([]);
  useEffect(() => {
    if (!visible || !user?.id) return;
    fetchMyBlocks(user.id).then(setRows).catch(() => setRows([]));
  }, [visible, user?.id]);
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Blocked accounts" icon={<Lock size={17} color={T.text} />}>
      {rows.length === 0 ? (
        <EmptyState text="You haven't blocked anyone. Blocked profiles will show up here." />
      ) : (
        rows.map((r) => (
          <View key={r.blocked_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border }}>
            <Avatar uri={null} name={r.name} size={34} />
            <Txt size={13.5} style={{ flex: 1 }}>
              {r.name}
            </Txt>
            <Pressable
              onPress={async () => {
                if (!user?.id) return;
                try {
                  await unblockUser(user.id, r.blocked_id);
                  setRows((x) => x.filter((y) => y.blocked_id !== r.blocked_id));
                  toast(`${r.name} unblocked`);
                  void reloadPeople();
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Unblock failed');
                }
              }}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: T.border }}>
              <Txt w={600} size={12} color={T.rose}>
                Unblock
              </Txt>
            </Pressable>
          </View>
        ))
      )}
      <PrimaryButton label="Close" onPress={onClose} style={{ marginTop: 12 }} />
    </Sheet>
  );
}

function ReportProblemSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!visible) {
      setSent(false);
      setCategory(null);
      setDetails('');
    }
  }, [visible]);
  const cats = ['Fake profile', 'Inappropriate content', 'Harassment', 'App bug', 'Other'];
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep}>
      {!sent ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Shield size={17} color={T.mint} />
            <Txt v="display" size={19}>
              Report a problem
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {cats.map((c) => (
              <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
          <TextInput value={details} onChangeText={setDetails} placeholder="Tell us what happened…" placeholderTextColor={T.mutedDim} multiline style={[inputStyle, { fontSize: 13.5, minHeight: 100, textAlignVertical: 'top', borderRadius: 14, marginBottom: 16 }]} />
          <PrimaryButton label="Submit report" disabled={!category} onPress={() => setSent(true)} />
          <Txt size={11} color={T.mutedDim} center style={{ marginTop: 10 }}>
            To report a specific person, use ⋯ on their card or in your chat.
          </Txt>
        </>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Check size={30} color={T.mint} style={{ marginBottom: 10 }} />
          <Txt v="display" size={18} style={{ marginBottom: 6 }}>
            Report submitted
          </Txt>
          <Txt size={12.5} color={T.muted} center style={{ marginBottom: 18 }}>
            Thanks — our safety team reviews every report within 24h.
          </Txt>
          <PrimaryButton label="Done" onPress={onClose} style={{ alignSelf: 'stretch' }} />
        </View>
      )}
    </Sheet>
  );
}

function VerificationModal({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { me } = useApp();
  const [step, setStep] = useState<'intro' | 'scanning' | 'done'>('intro');
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) setStep('intro');
  }, [visible]);
  useEffect(() => {
    if (step !== 'scanning') return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    const t = setTimeout(() => setStep('done'), 2200);
    return () => {
      loop.stop();
      clearTimeout(t);
    };
  }, [step, spin]);
  return (
    <CenterModal visible={visible} onClose={onClose} dismissable={step !== 'scanning'} style={{ width: '88%', maxWidth: 340, paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center' }}>
      {step === 'intro' ? (
        <>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${T.mint}22`, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Camera size={26} color={T.mint} />
          </View>
          <Txt v="display" size={19} style={{ marginBottom: 8 }}>
            Photo verification
          </Txt>
          <Txt size={12.5} color={T.muted} center lh={1.5} style={{ marginBottom: 18 }}>
            Take a quick live selfie matching a pose we show you. We compare it to your profile photos — it's never shared with other users.
          </Txt>
          <PrimaryButton label="Start face scan" colors={[T.mint, '#2FB89E']} onPress={() => setStep('scanning')} style={{ alignSelf: 'stretch' }} />
          <TextButton label="Not now" onPress={onClose} color={T.mutedDim} size={12.5} />
        </>
      ) : step === 'scanning' ? (
        <>
          <View style={{ width: 96, height: 96, marginBottom: 16 }}>
            <View style={{ position: 'absolute', inset: 0, borderRadius: 48, borderWidth: 3, borderColor: T.surface3 }} />
            <Animated.View style={{ position: 'absolute', inset: 0, borderRadius: 48, borderWidth: 3, borderColor: 'transparent', borderTopColor: T.mint, borderRightColor: T.mint, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />
            <View style={{ position: 'absolute', inset: 14, borderRadius: 34, overflow: 'hidden' }}>
              <Avatar uri={me?.photo} name={me?.name} size={68} />
            </View>
          </View>
          <Txt v="display" size={17} style={{ marginBottom: 6 }}>
            Verifying your photo…
          </Txt>
          <Txt size={12} color={T.muted}>
            Matching facial landmarks — hold still.
          </Txt>
        </>
      ) : (
        <>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${T.mint}22`, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <BadgeCheck size={28} color={T.mint} />
          </View>
          <Txt v="display" size={19} style={{ marginBottom: 8 }}>
            You're verified! ✓
          </Txt>
          <Txt size={12.5} color={T.muted} center style={{ marginBottom: 18 }}>
            A verified badge now appears on your profile so matches know it's really you.
          </Txt>
          <PrimaryButton label="Done" onPress={onDone} style={{ alignSelf: 'stretch' }} />
        </>
      )}
    </CenterModal>
  );
}

/* ------------------------------ edit profile ------------------------------ */
export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const { toast, refreshMe, reloadPeople } = useApp();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [intention, setIntention] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id) return;
    setName(profile?.name ?? '');
    setCity(profile?.city ?? '');
    setBio(profile?.bio ?? '');
    setIntention(profile?.intention ?? null);
    Promise.all([fetchAllInterests(), fetchUserInterestIds(user.id)])
      .then(([all, mine]) => {
        setCatalog(all);
        setSelected(mine);
      })
      .catch(() => {});
  }, [visible, user?.id, profile]);

  const save = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await upsertOwnProfile(user.id, {
        name: name.trim() || profile?.name || 'Member',
        birth_date: profile?.birth_date,
        city: city.trim() || null,
        bio: bio.trim() || null,
        intention: intention ?? profile?.intention ?? 'figuring_out',
        onboarding_complete: true,
      });
      await setUserInterests(user.id, selected);
      await Promise.all([refreshProfile(), refreshMe()]);
      void reloadPeople();
      toast('Profile saved ✨');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const groups: [string, Interest[]][] = (['music', 'food', 'lifestyle', 'movies'] as const).map((c) => [c, catalog.filter((i) => i.category === c)]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit profile" maxHeight="90%">
      <TextInput value={name} onChangeText={setName} placeholder="Your first name" placeholderTextColor={T.mutedDim} style={[inputStyle, { marginBottom: 10 }]} />
      <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={T.mutedDim} style={[inputStyle, { marginBottom: 10 }]} />
      <TextInput value={bio} onChangeText={setBio} placeholder="A line about you" placeholderTextColor={T.mutedDim} multiline style={[inputStyle, { minHeight: 80, textAlignVertical: 'top', marginBottom: 16 }]} />
      <Txt v="mono" size={11} color={T.mutedDim} style={{ letterSpacing: 1, marginBottom: 8 }}>
        LOOKING FOR
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {INTENTIONS.map((i) => (
          <Chip key={i.code} label={i.label} active={intention === i.code} onPress={() => setIntention(i.code)} small />
        ))}
      </View>
      {groups.map(([cat, items]) =>
        items.length ? (
          <View key={cat} style={{ marginBottom: 14 }}>
            <Txt v="mono" size={11} color={T.mutedDim} style={{ letterSpacing: 1, marginBottom: 8 }}>
              {cat.toUpperCase()}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {items.map((i) => (
                <Chip key={i.id} label={i.label} small active={selected.includes(i.id)} onPress={() => setSelected((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id]))} />
              ))}
            </View>
          </View>
        ) : null
      )}
      <PrimaryButton label="Save" onPress={save} loading={saving} style={{ marginTop: 8 }} />
    </Sheet>
  );
}

export function ProfileGradientButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.9 : 1 })}>
      <LinearGradient colors={[T.violet, '#5D3FE0']} start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 0.7 }} style={{ padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {children}
      </LinearGradient>
    </Pressable>
  );
}
