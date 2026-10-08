import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronLeft, Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inputStyle } from '@/components/app/AuthForm';
import { LitMatch } from '@/components/ui/LitMatch';
import { Backdrop, Chip, FadeUp, GhostButton, PrimaryButton, Skeleton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllInterests, setUserInterests, type Interest } from '@/lib/interests';
import { FRIDAY_OPTIONS, INTENTIONS, ONBOARDING_POOLS } from '@/lib/mock';
import { ageFromBirthDate, defaultBirthDate, upsertOwnProfile } from '@/lib/profile';

const STEPS = ['name', 'intention', 'interests', 'personality'] as const;

/* ------------------------------ BUILDING SCREEN ------------------------------ */
function BuildingScreen({ name }: { name: string }) {
  const [step, setStep] = useState(0);
  const lines = ['Reading your taste…', 'Finding your best matches…', `Almost ready, ${name || 'welcome'}…`];
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, lines.length - 1)), 480);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => {
      clearInterval(t);
      loop.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <View style={{ width: 64, height: 64, marginBottom: 22 }}>
        <View style={{ position: 'absolute', inset: 0, borderRadius: 32, borderWidth: 3, borderColor: T.surface3 }} />
        <Animated.View
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 32,
            borderWidth: 3,
            borderColor: 'transparent',
            borderTopColor: T.rose,
            borderRightColor: T.amber,
            transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
          }}
        />
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <LitMatch size={22} />
        </View>
      </View>
      <Txt v="display" size={17} style={{ marginBottom: 28 }}>
        {lines[step]}
      </Txt>
      <View style={{ width: '100%', maxWidth: 320, gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: 0.9 }}>
            <Skeleton width={44} height={44} radius={22} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width={`${70 - i * 10}%`} height={12} />
              <Skeleton width={`${45 - i * 5}%`} height={10} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function OptionRow({ label, active, onPress, color = T.rose, check }: { label: string; active: boolean; onPress: () => void; color?: string; check?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? color : T.border,
        backgroundColor: active ? `${color}22` : T.surface2,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
      <Txt w={check ? 500 : 400} size={15}>
        {label}
      </Txt>
      {check && active ? <Check size={18} color={color} /> : null}
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [stage, setStage] = useState<'form' | 'building'>('form');
  const isStub = !profile?.onboarding_complete && profile?.name && user?.email?.startsWith(profile.name);
  const [name, setName] = useState(isStub ? '' : profile?.name || '');
  const existingAge = profile?.onboarding_complete ? ageFromBirthDate(profile.birth_date) : null;
  const [age, setAge] = useState(existingAge ? String(existingAge) : '');
  const [city, setCity] = useState(profile?.city || '');
  const [intention, setIntention] = useState<string | null>(profile?.intention ?? null);
  const [picked, setPicked] = useState<string[]>([]);
  const [friday, setFriday] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Interest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllInterests().then(setCatalog).catch((e) => console.warn(e));
  }, []);

  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  function validateBasics(): boolean {
    const n = Number(age);
    if (!name.trim()) {
      setError('Tell us your first name.');
      setStep(0);
      return false;
    }
    if (!Number.isFinite(n) || n < 18 || n > 99) {
      setError('You need to be 18 or older to use MATCH.');
      setStep(0);
      return false;
    }
    setError(null);
    return true;
  }

  async function finish() {
    if (!user?.id || !validateBasics()) return;
    setStage('building');
    const started = Date.now();
    try {
      await upsertOwnProfile(user.id, {
        name: name.trim(),
        birth_date: defaultBirthDate(Number(age)),
        city: city.trim() || null,
        intention: intention ?? 'figuring_out',
        friday_answer: friday,
        onboarding_complete: true,
        is_discoverable: true,
      });
      const byLabel = new Map(catalog.map((c) => [c.label.toLowerCase(), c.id]));
      const ids = picked.map((l) => byLabel.get(l.toLowerCase())).filter((x): x is number => x != null);
      await setUserInterests(user.id, ids);
      const wait = Math.max(0, 1400 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      await refreshProfile();
      router.replace('/(tabs)/home');
    } catch (err) {
      setStage('form');
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    }
  }

  const next = () => {
    if (step === 0 && !validateBasics()) return;
    if (step === STEPS.length - 1) void finish();
    else setStep((s) => s + 1);
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      {stage === 'building' ? (
        <BuildingScreen name={name.trim()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flex: 1, paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + 12 }}>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 28 }}>
              {STEPS.map((_, i) =>
                i <= step ? (
                  <LinearGradient key={i} colors={[T.rose, T.amber]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1, height: 4, borderRadius: 4 }} />
                ) : (
                  <View key={i} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: T.surface2 }} />
                )
              )}
            </View>

            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <FadeUp key={step}>
                {step === 0 && (
                  <View>
                    <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                      What's your name?
                    </Txt>
                    <Txt size={14} color={T.muted} style={{ marginBottom: 26 }}>
                      Let's start with the basics.
                    </Txt>
                    <TextInput value={name} onChangeText={setName} placeholder="Your first name" placeholderTextColor={T.mutedDim} style={inputStyle} autoFocus />
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <TextInput
                        value={age}
                        onChangeText={(v) => setAge(v.replace(/[^0-9]/g, '').slice(0, 2))}
                        placeholder="Age"
                        keyboardType="number-pad"
                        placeholderTextColor={T.mutedDim}
                        style={[inputStyle, { width: 96 }]}
                      />
                      <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={T.mutedDim} style={[inputStyle, { flex: 1, width: undefined }]} />
                    </View>
                    <Txt size={12} color={T.mutedDim} style={{ marginTop: 22, lineHeight: 18 }}>
                      MATCH is 18+. We only ever show your age and an approximate distance — never your exact location.
                    </Txt>
                  </View>
                )}

                {step === 1 && (
                  <View>
                    <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                      What are you looking for?
                    </Txt>
                    <Txt size={14} color={T.muted} style={{ marginBottom: 22 }}>
                      Be honest — it helps your matches.
                    </Txt>
                    <View style={{ gap: 10 }}>
                      {INTENTIONS.map((opt) => (
                        <OptionRow key={opt.code} label={opt.label} active={intention === opt.code} onPress={() => setIntention(opt.code)} check />
                      ))}
                    </View>
                  </View>
                )}

                {step === 2 && (
                  <View>
                    <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                      Your taste, in a few taps
                    </Txt>
                    <Txt size={14} color={T.muted} style={{ marginBottom: 18 }}>
                      Pick what sounds like you. Choose as many as you like.
                    </Txt>
                    {ONBOARDING_POOLS.map(([label, pool]) => (
                      <View key={label} style={{ marginBottom: 18 }}>
                        <Txt v="mono" size={11} color={T.mutedDim} style={{ letterSpacing: 1, marginBottom: 8 }}>
                          {label.toUpperCase()}
                        </Txt>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {pool.map((t) => (
                            <Chip key={t} label={t} active={picked.includes(t)} onPress={() => toggle(t)} />
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {step === 3 && (
                  <View>
                    <Txt v="display" size={30} style={{ marginBottom: 6 }}>
                      One more thing
                    </Txt>
                    <Txt size={14} color={T.muted} style={{ marginBottom: 22 }}>
                      Perfect Friday night?
                    </Txt>
                    <View style={{ gap: 10 }}>
                      {FRIDAY_OPTIONS.map((opt) => (
                        <OptionRow key={opt} label={opt} active={friday === opt} onPress={() => setFriday(opt)} color={T.violet} />
                      ))}
                    </View>
                    <View style={{ marginTop: 24, padding: 16, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)', backgroundColor: T.surface, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                      <Sparkles size={18} color={T.amber} />
                      <Txt size={13} color={T.muted} style={{ flex: 1 }}>
                        We're building your compatibility profile from everything you share here.
                      </Txt>
                    </View>
                  </View>
                )}
              </FadeUp>
              {error ? (
                <Txt size={13} color={T.rose} style={{ marginTop: 14 }}>
                  {error}
                </Txt>
              ) : null}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              {step > 0 ? (
                <GhostButton onPress={() => setStep((s) => s - 1)}>
                  <ChevronLeft size={18} color={T.text} />
                </GhostButton>
              ) : null}
              <PrimaryButton label={step === STEPS.length - 1 ? 'Build my profile' : 'Continue'} onPress={next} style={{ flex: 1 }} />
            </View>
            <Pressable onPress={() => void finish()} style={{ alignSelf: 'center', marginTop: 14, padding: 4 }}>
              <Txt size={13} color={T.mutedDim}>
                Skip for now — finish later in your profile
              </Txt>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
