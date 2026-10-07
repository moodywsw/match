import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { upsertOwnProfile } from '@/lib/profile';

export default function ProfileScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? '');
    setCity(profile.city ?? '');
    setBio(profile.bio ?? '');
  }, [profile]);

  async function onSave() {
    if (!user) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await upsertOwnProfile(user.id, {
        name: name.trim() || 'New member',
        birth_date: profile?.birth_date,
        city: city.trim() || null,
        bio: bio.trim() || null,
      });
      await refreshProfile();
      setMessage('Profile saved to Supabase.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#E11D48" />
        <Text style={styles.muted}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.muted}>{user?.email}</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor="#6B7280" />

      <Text style={styles.label}>City</Text>
      <TextInput style={styles.input} value={city} onChangeText={setCity} placeholderTextColor="#6B7280" />

      <Text style={styles.label}>Bio</Text>
      <TextInput
        style={[styles.input, styles.bio]}
        value={bio}
        onChangeText={setBio}
        multiline
        placeholderTextColor="#6B7280"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.ok}>{message}</Text> : null}

      <Pressable style={styles.button} onPress={onSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </Pressable>

      <Pressable style={styles.signOut} onPress={() => signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#0B0B0F', flexGrow: 1 },
  center: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  title: { color: '#F4F4F5', fontSize: 28, fontWeight: '800', marginBottom: 4 },
  muted: { color: '#9CA3AF', marginBottom: 20 },
  label: { color: '#D4D4D8', marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    color: '#F4F4F5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 14,
  },
  bio: { minHeight: 100, textAlignVertical: 'top' },
  button: {
    backgroundColor: '#E11D48',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signOut: { marginTop: 24, alignItems: 'center', padding: 12 },
  signOutText: { color: '#FB7185', fontWeight: '600' },
  error: { color: '#FB7185', marginBottom: 8 },
  ok: { color: '#86EFAC', marginBottom: 8 },
});
