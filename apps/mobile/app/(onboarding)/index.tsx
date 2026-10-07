import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchAllInterests,
  setUserInterests,
  type Interest,
} from '@/lib/interests';
import { defaultBirthDate, upsertOwnProfile } from '@/lib/profile';

const INTENTIONS = [
  { value: 'serious', label: 'Serious relationship' },
  { value: 'casual', label: 'Casual dating' },
  { value: 'new_people', label: 'New people' },
  { value: 'friendship', label: 'Friendship' },
  { value: 'figuring_out', label: 'Still figuring it out' },
] as const;

const GENDERS = ['woman', 'man', 'non_binary', 'other', 'prefer_not'] as const;

export default function OnboardingScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.name || '');
  const [age, setAge] = useState('25');
  const [gender, setGender] = useState<string>('prefer_not');
  const [city, setCity] = useState(profile?.city || '');
  const [intention, setIntention] = useState<string>('figuring_out');
  const [bio, setBio] = useState(profile?.bio || '');
  const [catalog, setCatalog] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllInterests()
      .then(setCatalog)
      .catch((e) => console.warn(e));
  }, []);

  const title = useMemo(
    () => ['About you', 'Basics', 'Intention', 'Interests', 'Bio'][step],
    [step]
  );

  function toggleInterest(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function finish() {
    if (!user?.id) return;
    const ageNum = Number(age);
    if (!name.trim()) {
      setError('Name is required');
      setStep(0);
      return;
    }
    if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 99) {
      setError('Age must be 18–99');
      setStep(1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await upsertOwnProfile(user.id, {
        name: name.trim(),
        birth_date: defaultBirthDate(ageNum),
        gender,
        city: city.trim() || null,
        intention,
        bio: bio.trim() || null,
        onboarding_complete: true,
        is_discoverable: true,
      });
      await setUserInterests(user.id, selected);
      await refreshProfile();
      router.replace('/(tabs)/discover');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Match</Text>
        <View style={styles.progress}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotOn]} />
          ))}
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>Step {step + 1} of 5 — unlock Discover</Text>

        {step === 0 && (
          <>
            <Text style={styles.label}>Display name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={T.mutedDim} />
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.label}>Age</Text>
            <TextInput
              style={styles.input}
              value={age}
              onChangeText={setAge}
              keyboardType="number-pad"
              placeholderTextColor={T.mutedDim}
            />
            <Text style={styles.label}>Gender</Text>
            <View style={styles.chips}>
              {GENDERS.map((g) => (
                <Pressable
                  key={g}
                  style={[styles.chip, gender === g && styles.chipOn]}
                  onPress={() => setGender(g)}>
                  <Text style={[styles.chipText, gender === g && styles.chipTextOn]}>{g}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>City</Text>
            <TextInput style={styles.input} value={city} onChangeText={setCity} placeholderTextColor={T.mutedDim} />
          </>
        )}

        {step === 2 && (
          <View style={styles.chips}>
            {INTENTIONS.map((i) => (
              <Pressable
                key={i.value}
                style={[styles.chip, intention === i.value && styles.chipOn]}
                onPress={() => setIntention(i.value)}>
                <Text style={[styles.chipText, intention === i.value && styles.chipTextOn]}>
                  {i.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {step === 3 && (
          <>
            <Text style={styles.sub}>Pick a few tastes (optional)</Text>
            <View style={styles.chips}>
              {catalog.map((i) => {
                const on = selected.includes(i.id);
                return (
                  <Pressable
                    key={i.id}
                    style={[styles.chip, on && styles.chipViolet]}
                    onPress={() => toggleInterest(i.id)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{i.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!catalog.length ? (
              <Text style={styles.sub}>Loading interests…</Text>
            ) : null}
          </>
        )}

        {step === 4 && (
          <>
            <Text style={styles.label}>Short bio</Text>
            <TextInput
              style={[styles.input, styles.bio]}
              value={bio}
              onChangeText={setBio}
              multiline
              placeholder="What should people know?"
              placeholderTextColor={T.mutedDim}
            />
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.nav}>
          {step > 0 ? (
            <Pressable onPress={() => setStep((s) => s - 1)}>
              <Text style={styles.back}>Back</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {step < 4 ? (
            <Pressable style={styles.next} onPress={() => setStep((s) => s + 1)}>
              <Text style={styles.nextText}>Next</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.next} onPress={finish} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.nextText}>Finish</Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg },
  content: { padding: 24, paddingTop: 48 },
  brand: { color: T.rose, fontWeight: '900', fontSize: 22 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 16, marginBottom: 8 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: T.surface2 },
  dotOn: { backgroundColor: T.rose },
  title: { color: T.text, fontSize: 28, fontWeight: '800', marginTop: 12 },
  sub: { color: T.muted, marginBottom: 20, marginTop: 4 },
  label: { color: '#D4D4D8', fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    color: T.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  bio: { minHeight: 120, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: T.surface2,
  },
  chipOn: { borderColor: T.rose, backgroundColor: 'rgba(255,85,115,0.18)' },
  chipViolet: { borderColor: T.violet, backgroundColor: 'rgba(139,107,255,0.18)' },
  chipText: { color: T.muted, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  error: { color: '#FB7185', marginBottom: 8 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  back: { color: T.muted, fontWeight: '600' },
  next: {
    backgroundColor: T.rose,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 100,
    alignItems: 'center',
  },
  nextText: { color: '#fff', fontWeight: '700' },
});
