import { BlurView } from 'expo-blur';
import { useFocusEffect, useRouter } from 'expo-router';
import { Crown, Eye, Heart, Star } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Screen } from '@/components/app/Screen';
import { DarkPill, DemoTag, EmptyState, FadeUp, Photo } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useChats } from '@/hooks/useChats';
import { fetchLikesReceived, fetchLikesReceivedCount, type ReceivedLike } from '@/lib/likes';
import { fetchProfileViewers, fetchProfileViewersCount, type ProfileViewer } from '@/lib/perks';
import { fetchPrimaryPhotos } from '@/lib/profile';
import { timeAgo } from '@/lib/inbox';

export default function MatchesTab() {
  const router = useRouter();
  const { rows, loading, reload, error } = useChats();
  const { tier, openPremium, toast, requirePremium } = useApp();
  const [viewCount, setViewCount] = useState(0);
  const [viewers, setViewers] = useState<ProfileViewer[]>([]);
  const [likeCount, setLikeCount] = useState(0);
  const [likes, setLikes] = useState<ReceivedLike[]>([]);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});

  const loadLikes = useCallback(async () => {
    try {
      const count = await fetchLikesReceivedCount();
      setLikeCount(count);
      if (tier === 'free') {
        setLikes([]);
        return;
      }
      const list = await fetchLikesReceived();
      setLikes(list);
      if (list.length) {
        const ph = await fetchPrimaryPhotos(list.map((l) => l.likerId));
        setPhotos(ph);
      }
    } catch (err) {
      console.warn('[match] likes you load', err);
    }
  }, [tier]);

  /** Count: every tier. Who viewed (list): SUPER MATCH only — enforced by get_profile_viewers. */
  const loadViews = useCallback(async () => {
    try {
      setViewCount(await fetchProfileViewersCount());
      if (tier !== 'super_match') {
        setViewers([]);
        return;
      }
      const list = await fetchProfileViewers();
      setViewers(list);
      if (list.length) {
        const ph = await fetchPrimaryPhotos(list.map((v) => v.viewerId));
        setPhotos((prev) => ({ ...prev, ...ph }));
      }
    } catch (err) {
      console.warn('[match] profile views load', err);
    }
  }, [tier]);

  useFocusEffect(
    useCallback(() => {
      void loadLikes();
      void loadViews();
    }, [loadLikes, loadViews]),
  );

  return (
    <Screen padTop={16} refreshing={loading} onRefresh={() => { void reload(); void loadLikes(); void loadViews(); }}>
      <FadeUp>
        <Txt v="display" size={22} style={{ marginBottom: 4 }}>
          Your Matches
        </Txt>
        <Txt size={13} color={T.muted} style={{ marginBottom: 18 }}>
          {rows.length} {rows.length === 1 ? 'person' : 'people'} matched with you
        </Txt>

        {likeCount > 0 || tier !== 'free' ? (
          <Pressable
            onPress={() => {
              if (tier === 'free') openPremium();
            }}
            style={{ marginBottom: 22, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: tier === 'free' ? `${T.violet}66` : T.border, backgroundColor: T.surface }}>
            <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${T.rose}22`, alignItems: 'center', justifyContent: 'center' }}>
                <Heart size={18} color={T.rose} fill={T.rose} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt w={700} size={14}>
                  {likeCount === 0 ? 'No new likes yet' : likeCount === 1 ? '1 person likes you' : `${likeCount} people like you`}
                </Txt>
                <Txt size={12} color={T.muted} style={{ marginTop: 2 }}>
                  {tier === 'free' ? 'Upgrade to MATCH+ to see who' : 'Tap a photo to say hi'}
                </Txt>
              </View>
              {tier === 'free' ? <Crown size={18} color={T.violet} /> : null}
            </View>
            {tier === 'free' && likeCount > 0 ? (
              <View style={{ height: 88, flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
                {[0, 1, 2].slice(0, Math.min(3, likeCount)).map((i) => (
                  <View key={i} style={{ flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: T.surface3 }}>
                    <View style={{ flex: 1, backgroundColor: `${T.violet}${20 + i * 12}` }} />
                    <BlurView intensity={55} tint="dark" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                  </View>
                ))}
              </View>
            ) : null}
            {tier !== 'free' && likes.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingBottom: 14 }}>
                {likes.slice(0, 6).map((l) => (
                  <Pressable
                    key={l.likerId}
                    onPress={() => toast(`Like ${l.name} back from Discover`)}
                    style={{ width: '30%', alignItems: 'center' }}>
                    <View style={{ width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden', borderWidth: l.isSuperLike ? 2 : 0, borderColor: T.amber }}>
                      <Photo uri={photos[l.likerId] ?? null} name={l.name} style={{ width: '100%', height: '100%' }} />
                      {l.isSuperLike ? (
                        <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 3 }}>
                          <Star size={10} color={T.amber} fill={T.amber} />
                        </View>
                      ) : null}
                    </View>
                    <Txt w={600} size={11} numberOfLines={1} style={{ marginTop: 4 }}>
                      {l.name}{l.age ? `, ${l.age}` : ''}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {viewCount > 0 || tier === 'super_match' ? (
          <Pressable
            onPress={() => {
              if (tier !== 'super_match') requirePremium('super_match', 'See who viewed you with SUPER MATCH');
            }}
            style={{ marginBottom: 22, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: tier !== 'super_match' ? `${T.amber}66` : T.border, backgroundColor: T.surface }}>
            <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${T.amber}22`, alignItems: 'center', justifyContent: 'center' }}>
                <Eye size={18} color={T.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt w={700} size={14}>
                  {viewCount === 0 ? 'No profile views yet' : viewCount === 1 ? '1 person viewed your profile' : `${viewCount} people viewed your profile`}
                </Txt>
                <Txt size={12} color={T.muted} style={{ marginTop: 2 }}>
                  {tier !== 'super_match' ? 'Last 30 days · SUPER MATCH shows who' : 'Last 30 days'}
                </Txt>
              </View>
              {tier !== 'super_match' ? <Crown size={18} color={T.amber} /> : null}
            </View>
            {tier === 'super_match' && viewers.length ? (
              <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 10 }}>
                {viewers.slice(0, 8).map((v) => (
                  <View key={v.viewerId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Photo uri={photos[v.viewerId] ?? null} name={v.name} style={{ width: 38, height: 38, borderRadius: 19 }} />
                    <View style={{ flex: 1 }}>
                      <Txt w={600} size={13}>
                        {v.name}
                        {v.age ? `, ${v.age}` : ''}
                      </Txt>
                      {v.city ? (
                        <Txt size={11} color={T.muted}>
                          {v.city}
                        </Txt>
                      ) : null}
                    </View>
                    <Txt v="mono" size={11} color={T.mutedDim}>
                      {timeAgo(v.viewedAt)}
                    </Txt>
                  </View>
                ))}
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {error ? (
          <Txt size={12} color={T.rose} style={{ marginBottom: 10 }}>
            {error}
          </Txt>
        ) : null}
        {rows.length === 0 && !loading ? <EmptyState text="No matches yet — keep discovering!" /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {rows.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => router.push({ pathname: '/chat/[conversationId]', params: { conversationId: p.conversationId } })}
              style={{ width: '47.8%', borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, borderRadius: 18, overflow: 'hidden' }}>
              <View style={{ height: 140 }}>
                <Photo uri={p.photo} name={p.name} style={{ width: '100%', height: '100%' }} />
                {p.online ? <View style={{ position: 'absolute', top: 8, left: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: T.mint, borderWidth: 2, borderColor: T.surface }} /> : null}
                {p.demo ? <DemoTag style={{ position: 'absolute', top: 6, right: 6 }} /> : null}
                {p.match != null ? (
                  <DarkPill style={{ position: 'absolute', bottom: 6, right: 6 }}>
                    <Txt v="mono" size={10.5}>
                      {p.match}%
                    </Txt>
                  </DarkPill>
                ) : null}
              </View>
              <View style={{ paddingVertical: 9, paddingHorizontal: 11 }}>
                <Txt w={700} size={13}>
                  {p.name}
                  {p.age ? `, ${p.age}` : ''}
                </Txt>
                <Txt size={11} color={T.muted} style={{ marginTop: 2 }}>
                  Say hi 👋
                </Txt>
              </View>
            </Pressable>
          ))}
        </View>
      </FadeUp>
    </Screen>
  );
}
