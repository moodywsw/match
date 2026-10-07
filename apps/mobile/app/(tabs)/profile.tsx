import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  fetchUserInterestIds,
  setUserInterests,
  type Interest,
} from '@/lib/interests';
import { upsertOwnProfile } from '@/lib/profile';
import {
  fetchMyPhotos,
  pickAndUploadProfilePhoto,
  setPrimaryPhoto,
  type PhotoRow,
} from '@/lib/photos';

export default function ProfileScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [catalog, setCatalog] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? '');
    setCity(profile.city ?? '');
    setBio(profile.bio ?? '');
  }, [profile]);

  const loadExtras = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [ph, all, mine] = await Promise.all([
        fetchMyPhotos(user.id),
        fetchAllInterests(),
        fetchUserInterestIds(user.id),
      ]);
      setPhotos(ph);
      setCatalog(all);
      setSelected(mine);
    } catch (err) {
      console.warn(err);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadExtras();
    }, [loadExtras])
  );

  function toggleInterest(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

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
        onboarding_complete: true,
        is_discoverable: true,
      });
      await setUserInterests(user.id, selected);
      await refreshProfile();
      setMessage('Profile & interests saved.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onUpload() {
    if (!user?.id) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      await pickAndUploadProfilePhoto(user.id);
      await loadExtras();
      setMessage('Photo uploaded');
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'cancelled') return;
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onMakePrimary(id: string) {
    if (!user?.id) return;
    try {
      await setPrimaryPhoto(user.id, id);
      await loadExtras();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set primary');
    }
  }

  if (!profile) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={T.rose} />
        <Text style={styles.muted}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.muted}>{user?.email}</Text>
      <Text style={styles.badge}>
        {profile.onboarding_complete ? 'Onboarding complete · discoverable' : 'Onboarding incomplete'}
      </Text>

      <Text style={styles.label}>Photos</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {photos.map((p) => (
          <Pressable key={p.id} onPress={() => onMakePrimary(p.id)} style={styles.photoWrap}>
            <Image source={{ uri: p.url }} style={styles.photo} />
            {p.is_primary ? <Text style={styles.primaryTag}>PRIMARY</Text> : null}
          </Pressable>
        ))}
        <Pressable style={[styles.photo, styles.addPhoto]} onPress={onUpload} disabled={uploading}>
          {uploading ? <ActivityIndicator color={T.rose} /> : <Text style={styles.addPhotoText}>＋</Text>}
        </Pressable>
      </ScrollView>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={T.mutedDim} />

      <Text style={styles.label}>City</Text>
      <TextInput style={styles.input} value={city} onChangeText={setCity} placeholderTextColor={T.mutedDim} />

      <Text style={styles.label}>Bio</Text>
      <TextInput
        style={[styles.input, styles.bio]}
        value={bio}
        onChangeText={setBio}
        multiline
        placeholderTextColor={T.mutedDim}
      />

      <Text style={styles.label}>Interests</Text>
      <View style={styles.chips}>
        {catalog.map((i) => {
          const on = selected.includes(i.id);
          return (
            <Pressable
              key={i.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => toggleInterest(i.id)}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{i.label}</Text>
            </Pressable>
          );
        })}
      </View>

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
  container: { padding: 24, backgroundColor: T.bg, flexGrow: 1 },
  center: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  title: { color: T.text, fontSize: 28, fontWeight: '800', marginBottom: 4 },
  muted: { color: T.muted, marginBottom: 8 },
  badge: { color: T.rose, marginBottom: 16, fontWeight: '600', fontSize: 12 },
  label: { color: '#D4D4D8', marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    color: T.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 14,
  },
  bio: { minHeight: 100, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: T.surface2,
  },
  chipOn: { borderColor: T.violet, backgroundColor: 'rgba(139,107,255,0.2)' },
  chipText: { color: T.muted, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  button: {
    backgroundColor: T.rose,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signOut: { marginTop: 24, alignItems: 'center', padding: 12 },
  signOutText: { color: '#FB7185', fontWeight: '600' },
  error: { color: '#FB7185', marginBottom: 8 },
  ok: { color: T.mint, marginBottom: 8 },
  photoWrap: { marginRight: 10 },
  photo: { width: 88, height: 88, borderRadius: 14, backgroundColor: T.border },
  addPhoto: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: T.border },
  addPhotoText: { color: T.rose, fontSize: 28, fontWeight: '700' },
  primaryTag: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    textAlign: 'center',
    backgroundColor: 'rgba(255,85,115,0.92)',
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    borderRadius: 4,
    overflow: 'hidden',
  },
});
