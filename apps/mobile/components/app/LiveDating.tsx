import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, Heart, MessageCircleOff, MicOff, Moon, Pin, Timer, UserMinus, Users, Zap } from 'lucide-react-native';
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { fetchInterestLabelsForUsers } from '@/lib/interests';
import {
  fetchLivePeople,
  liveErrorMessage,
  moderateLive,
  roomTypeBadge,
  roundClock,
  setCommentsMuted,
  type LivePerson,
  type LiveRoomType,
  type StageMember,
} from '@/lib/live';
import { fetchPrimaryPhotos } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

/* ------------------------------------------------------------------ badges */
export function RoomTypeBadge({ type, small }: { type?: LiveRoomType | string | null; small?: boolean }) {
  const label = roomTypeBadge(type);
  if (!label) return null;
  const color = type === 'speed_dating' ? T.amber : T.violet;
  return (
    <View style={{ backgroundColor: color, borderRadius: 8, paddingVertical: small ? 2 : 3, paddingHorizontal: small ? 6 : 8, alignSelf: 'flex-start' }}>
      <Txt w={700} size={small ? 9.5 : 10.5} color={type === 'speed_dating' ? '#1a1a1a' : '#fff'}>
        {label}
      </Txt>
    </View>
  );
}

/* ------------------------------------------------------------------ stage */
/** People on stage (host / LIVE MATCH guest / speed-dating daters) with a heart to like them. */
export const StageStrip = memo(function StageStrip({
  stage,
  photos,
  meId,
  spotlight,
  onOpen,
  onLike,
}: {
  stage: StageMember[];
  photos: Record<string, string>;
  meId?: string;
  spotlight?: string[] | null;
  onOpen: (m: StageMember) => void;
  onLike: (m: StageMember) => void;
}) {
  if (!stage.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }} style={{ marginTop: 10, flexGrow: 0 }}>
      {stage.map((m) => {
        const me = m.id === meId;
        const lit = !!spotlight?.includes(m.id);
        return (
          <Pressable key={m.id} onPress={() => onOpen(m)} accessibilityLabel={`${m.name}'s profile`} style={{ alignItems: 'center', width: 64 }}>
            <View>
              <Avatar uri={photos[m.id]} name={m.name} size={48} ring={lit ? T.amber : m.role === 'host' ? T.rose : T.violet} />
              {!me ? (
                <Pressable
                  onPress={() => onLike(m)}
                  disabled={m.liked}
                  hitSlop={8}
                  accessibilityLabel={m.liked ? `You liked ${m.name}` : `Like ${m.name}`}
                  style={{ position: 'absolute', right: -4, bottom: -4, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: m.liked ? T.rose : 'rgba(20,16,26,0.9)', borderWidth: 1.5, borderColor: T.rose }}
                >
                  <Heart size={12} color="#fff" fill={m.liked ? '#fff' : 'transparent'} />
                </Pressable>
              ) : null}
            </View>
            <Txt size={10.5} color="#fff" numberOfLines={1} style={{ marginTop: 5 }}>
              {me ? 'You' : m.name}
            </Txt>
            <Txt size={9} color={m.matched ? T.mint : T.muted}>
              {m.matched ? 'Matched' : m.role === 'host' ? 'Host' : m.role === 'guest' ? 'Guest' : `Seat ${m.seat}`}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

/* ------------------------------------------------------------------ speed dating */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function SpeedDatingPanel({
  round,
  endsAt,
  pairNames,
  stageCount,
  minPeople,
  maxPeople,
  isHost,
  seated,
  ended,
  busy,
  onNext,
  onSeat,
  onLeaveSeat,
}: {
  round: number;
  endsAt: string | null | undefined;
  pairNames: [string, string] | null;
  stageCount: number;
  minPeople: number;
  maxPeople: number;
  isHost: boolean;
  seated: boolean;
  ended: boolean;
  busy: boolean;
  onNext: () => void;
  onSeat: () => void;
  onLeaveSeat: () => void;
}) {
  const now = useNow(!!endsAt && !ended);
  const clock = roundClock(endsAt, now);
  const timeUp = clock === "Time's up";
  const ready = stageCount >= minPeople;
  const full = stageCount >= maxPeople;
  return (
    <View style={{ backgroundColor: 'rgba(30,25,40,0.8)', borderWidth: 1, borderColor: `${T.amber}66`, borderRadius: 18, padding: 14, marginVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Zap size={14} color={T.amber} />
        <Txt w={700} size={12.5} color={T.amber}>
          {round > 0 ? `Round ${round}` : 'Speed dating'}
        </Txt>
        <View style={{ flex: 1 }} />
        {round > 0 && endsAt ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Timer size={13} color={timeUp ? T.rose : '#fff'} />
            <Txt v="mono" w={600} size={13} color={timeUp ? T.rose : '#fff'}>
              {clock}
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt size={12.5} color="#fff" style={{ marginBottom: 10 }}>
        {round > 0 && pairNames
          ? `${pairNames[0]} 💬 ${pairNames[1]}${timeUp ? ' — round over' : ' are on a 3-minute date'}`
          : ready
            ? isHost
              ? `${stageCount} on stage — start the first 3-minute round when you're ready`
              : 'Rounds start soon — everyone on stage meets everyone'
            : `Waiting for daters (${stageCount}/${minPeople} on stage, up to ${maxPeople})`}
      </Txt>
      {ended ? null : isHost ? (
        <PrimaryButton
          label={busy ? 'Starting…' : round > 0 ? (timeUp ? 'Next round' : 'Skip to next round') : 'Start round 1'}
          disabled={!ready || busy}
          onPress={onNext}
          colors={[T.amber, T.coral]}
        />
      ) : seated ? (
        <TextButton label="Leave the stage" onPress={onLeaveSeat} color={T.muted} size={12.5} />
      ) : (
        <PrimaryButton label={busy ? 'Joining…' : full ? 'Stage is full' : 'Join the stage'} disabled={full || busy} onPress={onSeat} colors={[T.amber, T.coral]} />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ question of the night */
export function QuestionBanner({ question, pinned, onAnswerWithFriday }: { question: string; pinned?: { name: string; body: string } | null; onAnswerWithFriday?: () => void }) {
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', marginVertical: 8 }}>
      <LinearGradient colors={[`${T.violet}EE`, `${T.rose}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Moon size={13} color="#fff" />
          <Txt w={700} size={11} color="#fff">
            QUESTION OF THE NIGHT
          </Txt>
        </View>
        <Txt v="display" size={16} color="#fff">
          {question}
        </Txt>
        {pinned ? (
          <View style={{ marginTop: 10, flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 10 }}>
            <Pin size={12} color={T.amber} style={{ marginTop: 2 }} />
            <Txt size={12.5} color="#fff" style={{ flex: 1 }}>
              <Txt w={700} size={12.5} color={T.amber}>
                {pinned.name}
              </Txt>{' '}
              {pinned.body}
            </Txt>
          </View>
        ) : null}
        {onAnswerWithFriday ? (
          <Pressable onPress={onAnswerWithFriday} style={{ marginTop: 10, alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.2)' }}>
            <Txt w={600} size={11.5} color="#fff">
              🌙 Answer with my Friday answer
            </Txt>
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}

/* ------------------------------------------------------------------ profile peek (never any location) */
type Peek = { name: string; bio: string | null; friday: string | null; verified: boolean; photo: string | null; interests: string[] };

export function LiveProfileSheet({
  userId,
  fallbackName,
  liked,
  matched,
  canLike,
  onClose,
  onLike,
}: {
  userId: string | null;
  fallbackName?: string;
  liked: boolean;
  matched: boolean;
  canLike: boolean;
  onClose: () => void;
  onLike: () => void;
}) {
  const [peek, setPeek] = useState<Peek | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setPeek(null);
    Promise.all([
      supabase.from('profiles').select('name, bio, friday_answer, verified').eq('id', userId).maybeSingle(),
      fetchPrimaryPhotos([userId]).catch(() => ({}) as Record<string, string>),
      fetchInterestLabelsForUsers([userId]).catch(() => ({}) as Record<string, string[]>),
    ]).then(([p, photos, ints]) => {
      if (!alive) return;
      const row = p.data as { name?: string; bio?: string | null; friday_answer?: string | null; verified?: boolean } | null;
      setPeek({
        name: row?.name || fallbackName || 'Member',
        bio: row?.bio ?? null,
        friday: row?.friday_answer ?? null,
        verified: !!row?.verified,
        photo: (photos as Record<string, string>)[userId] ?? null,
        interests: ((ints as Record<string, string[]>)[userId] || []).slice(0, 5),
      });
    });
    return () => {
      alive = false;
    };
  }, [userId, fallbackName]);

  return (
    <Sheet visible={!!userId} onClose={onClose} scrim={T.scrimDeep}>
      {!peek ? (
        <ActivityIndicator color={T.rose} style={{ marginVertical: 30 }} />
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Avatar uri={peek.photo} name={peek.name} size={88} ring={T.rose} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Txt v="display" size={20}>
              {peek.name}
            </Txt>
            {peek.verified ? <BadgeCheck size={16} color={T.mint} /> : null}
          </View>
          {peek.bio ? (
            <Txt size={13} color={T.muted} center lh={1.45} style={{ marginTop: 8 }}>
              {peek.bio}
            </Txt>
          ) : null}
          {peek.friday ? (
            <Txt size={12.5} color={T.text} center style={{ marginTop: 10 }}>
              🌙 {peek.friday}
            </Txt>
          ) : null}
          {peek.interests.length ? (
            <Txt size={11.5} color={T.mutedDim} center style={{ marginTop: 8 }}>
              {peek.interests.join(' · ')}
            </Txt>
          ) : null}
          <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
            {matched ? (
              <Txt w={600} size={13} color={T.mint} center>
                You've matched — say hi in Messages
              </Txt>
            ) : canLike ? (
              <PrimaryButton label={liked ? 'Liked ✓' : `Like ${peek.name}`} disabled={liked} onPress={onLike} />
            ) : null}
            <TextButton label="Close" onPress={onClose} size={13} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ host tools */
export function HostPeopleSheet({
  visible,
  streamId,
  commentsMuted,
  onClose,
  onLike,
  onError,
  onChanged,
}: {
  visible: boolean;
  streamId: string;
  commentsMuted: boolean;
  onClose: () => void;
  onLike: (p: LivePerson) => Promise<void>;
  onError: (msg: string) => void;
  onChanged: () => void;
}) {
  const [people, setPeople] = useState<LivePerson[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    try {
      setPeople(await fetchLivePeople(streamId));
    } catch (e) {
      onError(liveErrorMessage(e));
      setPeople([]);
    }
  };
  useEffect(() => {
    if (!visible) return;
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, streamId]);

  const act = async (p: LivePerson, action: 'remove' | 'mute' | 'unmute' | 'unseat') => {
    setBusy(p.user_id);
    try {
      await moderateLive(streamId, p.user_id, action);
      await load();
      onChanged();
    } catch (e) {
      onError(liveErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const confirmRemove = (p: LivePerson) =>
    Alert.alert(`Remove ${p.name}?`, "They'll leave this live and can't come back to it. Their comments are hidden.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void act(p, 'remove') },
    ]);

  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="People in your live" icon={<Users size={17} color={T.rose} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: T.surface2, marginBottom: 14 }}>
        <MessageCircleOff size={16} color={T.muted} />
        <View style={{ flex: 1 }}>
          <Txt w={600} size={13}>
            Turn comments off
          </Txt>
          <Txt size={11.5} color={T.muted}>
            Only you and your guest can write while this is on
          </Txt>
        </View>
        <Switch
          value={commentsMuted}
          onValueChange={(v) => {
            setCommentsMuted(streamId, v)
              .then(onChanged)
              .catch((e) => onError(liveErrorMessage(e)));
          }}
          trackColor={{ true: T.rose, false: T.surface3 }}
        />
      </View>
      {people === null ? (
        <ActivityIndicator color={T.rose} style={{ marginVertical: 20 }} />
      ) : !people.length ? (
        <Txt size={12.5} color={T.muted} center style={{ marginVertical: 20 }}>
          No one here yet. People who comment show up first — you can like them back.
        </Txt>
      ) : (
        people.map((p) => (
          <View key={p.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border, opacity: busy === p.user_id ? 0.5 : 1 }}>
            <View style={{ flex: 1 }}>
              <Txt w={600} size={13.5} numberOfLines={1}>
                {p.name}
              </Txt>
              <Txt size={11} color={T.muted}>
                {[p.seated ? 'On stage' : null, p.commented ? 'Commented' : null, p.watching ? 'Watching' : 'Left', p.muted ? 'Muted' : null, p.matched ? 'Matched' : null].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            {p.commented && !p.matched ? (
              <Pressable
                disabled={p.liked || busy === p.user_id}
                onPress={async () => {
                  setBusy(p.user_id);
                  await onLike(p);
                  await load();
                  setBusy(null);
                }}
                accessibilityLabel={p.liked ? `You liked ${p.name}` : `Like ${p.name}`}
                style={{ padding: 8 }}
              >
                <Heart size={18} color={T.rose} fill={p.liked ? T.rose : 'transparent'} />
              </Pressable>
            ) : null}
            {p.seated ? (
              <Pressable onPress={() => void act(p, 'unseat')} accessibilityLabel={`Take ${p.name} off stage`} style={{ padding: 8 }}>
                <Zap size={17} color={T.amber} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => void act(p, p.muted ? 'unmute' : 'mute')} accessibilityLabel={p.muted ? `Unmute ${p.name}` : `Mute ${p.name}`} style={{ padding: 8 }}>
              <MicOff size={17} color={p.muted ? T.rose : T.muted} />
            </Pressable>
            <Pressable onPress={() => confirmRemove(p)} accessibilityLabel={`Remove ${p.name}`} style={{ padding: 8 }}>
              <UserMinus size={17} color={T.muted} />
            </Pressable>
          </View>
        ))
      )}
      <Txt size={11} color={T.mutedDim} center style={{ marginTop: 14 }}>
        Blocked people never see your lives. Locations are never shown here.
      </Txt>
    </Sheet>
  );
}
