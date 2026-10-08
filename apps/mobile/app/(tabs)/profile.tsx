import { useFocusEffect, useRouter } from 'expo-router';
import { Camera, ChevronRight, Crown, LogOut, Pencil, Plus, Settings, Sparkles, Star } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';

import { FridayCard } from '@/components/app/FridayCard';
import { EditProfileSheet, ProfileGradientButton, SettingsSheet } from '@/components/app/ProfileSheets';
import { Screen } from '@/components/app/Screen';
import { Avatar, Chip, FadeUp, MatchRing, SafetyLink, SectionTitle, StatCard, Tag, VerifiedIcon } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useChats } from '@/hooks/useChats';
import { intentionLabel } from '@/lib/mock';
import { fetchMyPhotos, pickAndUploadProfilePhoto, setPrimaryPhoto, type PhotoRow } from '@/lib/photos';

const BADGE_RULES: [RegExp, string][] = [
  [/travel|hik|beach/i, 'Travel Addict'],
  [/music|indie|house|techno|jazz|pop|rock|hip/i, 'Music Lover'],
  [/food|sushi|wine|coffee|vegan|brunch|pizza|cook/i, 'Foodie'],
  [/night|party|festival|cocktail/i, 'Night Owl'],
  [/gym|yoga|run|fitness/i, 'Early Bird'],
];

export default function ProfileTab() {
  const router = useRouter();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const { me, people, likedIds, toast, openPremium, refreshMe } = useApp();
  const { rows } = useChats();
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [localVerified, setLocalVerified] = useState(false);

  const loadPhotos = useCallback(async () => {
    if (!user?.id) return;
    try {
      setPhotos(await fetchMyPhotos(user.id));
    } catch {
      setPhotos([]);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadPhotos();
    }, [loadPhotos])
  );

  const upload = async () => {
    if (!user?.id) return;
    setUploading(true);
    try {
      await pickAndUploadProfilePhoto(user.id);
      await Promise.all([loadPhotos(), refreshMe()]);
      toast('Photo added 📸');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      if (!/cancel/i.test(msg)) toast(msg);
    } finally {
      setUploading(false);
    }
  };

  const makePrimary = async (p: PhotoRow) => {
    if (!user?.id || p.is_primary) return;
    try {
      await setPrimaryPhoto(user.id, p.id);
      await Promise.all([loadPhotos(), refreshMe()]);
      toast('Main photo updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update photo');
    }
  };

  const verified = !!profile?.verified || localVerified;
  const interests = me?.interests ?? [];

  const avgCompat = useMemo(() => {
    const top = [...people].sort((a, b) => b.match - a.match).slice(0, 10);
    if (!top.length) return 0;
    return Math.round(top.reduce((s, p) => s + p.match, 0) / top.length);
  }, [people]);

  const completeness = useMemo(() => {
    const checks = [!!profile?.name, !!profile?.birth_date, !!profile?.city, !!profile?.bio, !!profile?.intention, photos.length > 0, interests.length >= 3, verified];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [profile, photos.length, interests.length, verified]);

  const badges = useMemo(() => {
    const out = new Set<string>();
    for (const [re, b] of BADGE_RULES) if (interests.some((i) => re.test(i))) out.add(b);
    if (out.size < 2) out.add('Social Butterfly');
    return [...out].slice(0, 3);
  }, [interests]);

  const realMatches = rows.filter((r) => !r.demo).length;

  return (
    <Screen>
      <FadeUp>
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <Pressable onPress={upload} style={{ marginBottom: 12 }}>
            <Avatar uri={me?.photo} name={me?.name} size={96} ring={T.rose} />
            {uploading ? (
              <View style={{ position: 'absolute', inset: 0, borderRadius: 48, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
            <View style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: verified ? T.mint : T.surface3, borderWidth: 3, borderColor: T.ink, alignItems: 'center', justifyContent: 'center' }}>
              {verified ? <VerifiedIcon size={13} /> : <Camera size={12} color={T.text} />}
            </View>
          </Pressable>
          <Txt v="display" size={24}>
            {me?.name || profile?.name || 'You'}
            {me?.age ? `, ${me.age}` : ''}
          </Txt>
          <Txt size={13} color={T.muted} style={{ marginTop: 4 }}>
            {[profile?.city, intentionLabel(profile?.intention)].filter(Boolean).join(' · ')}
          </Txt>
          {profile?.bio ? (
            <Txt size={13} color={T.mutedDim} center style={{ marginTop: 10, maxWidth: 300, fontStyle: 'italic' }}>
              “{profile.bio}”
            </Txt>
          ) : null}
          {!verified ? (
            <Pressable onPress={() => setShowSettings(true)} style={{ marginTop: 6 }}>
              <Txt size={11.5} color={T.mutedDim}>
                Not verified yet ·{' '}
                <Txt size={11.5} w={600} color={T.mint}>
                  Get verified
                </Txt>
              </Txt>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setShowEdit(true)} style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2 }}>
            <Pencil size={12} color={T.text} />
            <Txt w={600} size={12}>
              Edit profile
            </Txt>
          </Pressable>
        </View>

        <FridayCard answer={profile?.friday_answer} onEdit={() => setShowEdit(true)} style={{ marginBottom: 18 }} />

        <SectionTitle title="Your photos" sub="Tap a photo to make it your main one" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 18 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 18 }}>
          {photos.map((p) => (
            <Pressable key={p.id} onPress={() => makePrimary(p)} style={{ width: 92, height: 120, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: p.is_primary ? T.rose : T.border }}>
              <Image source={{ uri: p.url }} style={{ width: '100%', height: '100%' }} />
              {p.is_primary ? (
                <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: T.rose, borderRadius: 999, padding: 3 }}>
                  <Star size={10} color="#fff" fill="#fff" />
                </View>
              ) : null}
            </Pressable>
          ))}
          <Pressable onPress={upload} disabled={uploading} style={{ width: 92, height: 120, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: `${T.rose}88`, backgroundColor: `${T.rose}11`, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {uploading ? <ActivityIndicator color={T.rose} /> : <Plus size={20} color={T.rose} />}
            <Txt w={600} size={11} color={T.rose}>
              Add photo
            </Txt>
          </Pressable>
        </ScrollView>

        <View style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <MatchRing percent={avgCompat} size={64} stroke={6} />
          <View style={{ flex: 1 }}>
            <Txt w={700} size={14}>
              Average compatibility
            </Txt>
            <Txt size={12} color={T.muted} style={{ marginTop: 3 }}>
              with your top recommendations this week
            </Txt>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
          <StatCard value={`${completeness}%`} sub="Profile complete" />
          <StatCard value={String(realMatches)} sub="Matches" />
          <StatCard value={String(likedIds.size)} sub="Likes sent" />
        </View>

        <SectionTitle title="Your taste" action="Edit" onAction={() => setShowEdit(true)} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {interests.length ? interests.map((t) => <Chip key={t} label={t} active small />) : (
            <Txt size={12.5} color={T.mutedDim}>
              Add a few interests so we can find your people.
            </Txt>
          )}
        </View>

        <SectionTitle title="Badges" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {badges.map((b) => (
            <Tag key={b} label={`🏅 ${b}`} />
          ))}
        </View>

        <ProfileGradientButton onPress={openPremium}>
          <Crown size={22} color="#fff" />
          <View style={{ flex: 1 }}>
            <Txt w={700} size={14.5} color="#fff">
              Upgrade to MATCH+
            </Txt>
            <Txt size={12} color="rgba(255,255,255,0.8)" style={{ marginTop: 2 }}>
              See who liked you, unlimited likes & more
            </Txt>
          </View>
          <Sparkles size={18} color="#fff" />
        </ProfileGradientButton>

        <SafetyLink icon={<Sparkles size={16} color={T.text} />} label="View your social posts" onPress={() => router.navigate('/(tabs)/social')} trailing={<ChevronRight size={15} color={T.mutedDim} />} />
        <SafetyLink icon={<Settings size={16} color={T.text} />} label="Settings & privacy" onPress={() => setShowSettings(true)} trailing={<ChevronRight size={15} color={T.mutedDim} />} />
        <SafetyLink icon={<LogOut size={16} color={T.rose} />} label="Sign out" color={T.rose} onPress={() => void signOut()} />
      </FadeUp>

      <SettingsSheet
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        verified={verified}
        onVerified={() => {
          setLocalVerified(true);
          toast("You're verified ✓");
          void refreshProfile();
        }}
      />
      <EditProfileSheet visible={showEdit} onClose={() => setShowEdit(false)} />
    </Screen>
  );
}
