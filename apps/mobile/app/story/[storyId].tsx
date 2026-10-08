import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, BarChart3, Eye, Heart, MessageCircle } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, EmptyState, IconBtn } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { timeAgo } from '@/lib/inbox';
import type { StoryFrame } from '@/lib/mock';
import { fetchPrimaryPhotos } from '@/lib/profile';
import { fetchOwnStoryFrame, fetchStoryActivity, type StoryActivity } from '@/lib/stories';

/** Owner-only: who viewed, liked, replied to / answered / voted on a story. */
export default function StoryActivityScreen() {
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { toast } = useApp();
  const [frame, setFrame] = useState<StoryFrame | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [rows, setRows] = useState<StoryActivity[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!storyId || !user?.id) return;
    try {
      const [f, act] = await Promise.all([fetchOwnStoryFrame(user.id, storyId).catch(() => null), fetchStoryActivity(storyId)]);
      setFrame(f?.frame ?? null);
      setExpiresAt(f?.expiresAt ?? null);
      setRows(act);
      const ids = [...new Set(act.map((a) => a.user_id))];
      if (ids.length) setPhotos(await fetchPrimaryPhotos(ids).catch(() => ({})));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not_owner')) setDenied(true);
      else toast(msg);
    } finally {
      setLoading(false);
    }
  }, [storyId, user?.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const by = (k: StoryActivity['kind'][]) => rows.filter((r) => k.includes(r.kind)).sort((a, b) => b.at.localeCompare(a.at));
    return { responses: by(['reply', 'answer']), votes: by(['vote']), likes: by(['like']), views: by(['view']) };
  }, [rows]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/social'));
  const options = frame?.type === 'poll' ? frame.options : [];
  const expired = !frame || (expiresAt ? new Date(expiresAt).getTime() < Date.now() : false);

  return (
    <View style={{ flex: 1, backgroundColor: T.ink }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
        <IconBtn onPress={back}>
          <ArrowLeft size={18} color={T.text} />
        </IconBtn>
        <Txt v="display" size={18}>
          Story activity
        </Txt>
      </View>
      {loading ? (
        <ActivityIndicator color={T.rose} style={{ marginTop: 40 }} />
      ) : denied ? (
        <View style={{ padding: 18 }}>
          <EmptyState text="Only the story's owner can see its activity." />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 30 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={T.rose} />}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 18 }}>
            <Preview frame={frame} />
            <View style={{ flex: 1, gap: 6 }}>
              <Txt w={700} size={14}>
                {expired ? 'Story expired' : `Expires ${expiresAt ? `in ${timeLeft(expiresAt)}` : 'soon'}`}
              </Txt>
              <Stat icon={<Eye size={14} color={T.muted} />} text={`${groups.views.length} ${groups.views.length === 1 ? 'viewer' : 'viewers'}`} />
              <Stat icon={<Heart size={14} color={T.rose} />} text={`${groups.likes.length} ${groups.likes.length === 1 ? 'like' : 'likes'}`} />
              <Stat icon={<MessageCircle size={14} color={T.violet} />} text={`${groups.responses.length} ${groups.responses.length === 1 ? 'reply' : 'replies'}`} />
              {options.length ? <Stat icon={<BarChart3 size={14} color={T.amber} />} text={`${groups.votes.length} ${groups.votes.length === 1 ? 'vote' : 'votes'}`} /> : null}
            </View>
          </View>

          {groups.responses.length ? (
            <Section title={frame?.type === 'question' ? 'Answers & replies' : 'Replies'}>
              {groups.responses.map((r, i) => (
                <Row key={`r${i}`} a={r} photo={photos[r.user_id]} detail={r.body ? `“${r.body}”` : r.kind === 'answer' ? 'Answered' : 'Replied'} />
              ))}
            </Section>
          ) : null}
          {groups.votes.length ? (
            <Section title="Votes">
              {groups.votes.map((r, i) => (
                <Row key={`v${i}`} a={r} photo={photos[r.user_id]} detail={r.option_index != null && options[r.option_index] ? `Voted “${options[r.option_index]}”` : 'Voted'} />
              ))}
            </Section>
          ) : null}
          {groups.likes.length ? (
            <Section title="Likes">
              {groups.likes.map((r, i) => (
                <Row key={`l${i}`} a={r} photo={photos[r.user_id]} detail="Liked your story ❤️" />
              ))}
            </Section>
          ) : null}
          <Section title="Viewers">
            {groups.views.length ? (
              groups.views.map((r, i) => <Row key={`w${i}`} a={r} photo={photos[r.user_id]} detail="Viewed" />)
            ) : (
              <Txt size={12.5} color={T.mutedDim}>
                No views yet.
              </Txt>
            )}
          </Section>
        </ScrollView>
      )}
    </View>
  );
}

function timeLeft(iso: string) {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
}

function Preview({ frame }: { frame: StoryFrame | null }) {
  const box = { width: 72, height: 120, borderRadius: 14, overflow: 'hidden' as const, backgroundColor: T.surface3, borderWidth: 1, borderColor: T.border };
  if (!frame) return <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}><Txt size={22}>⌛</Txt></View>;
  if (frame.type === 'photo' || frame.type === 'video') {
    const uri = frame.type === 'photo' ? frame.image : frame.thumb;
    return <View style={box}>{uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} /> : null}</View>;
  }
  const text = frame.type === 'text' ? frame.text : frame.question;
  return (
    <LinearGradient colors={frame.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[box, { padding: 8, alignItems: 'center', justifyContent: 'center' }]}>
      <Txt w={700} size={10.5} color="#fff" center numberOfLines={6}>
        {text}
      </Txt>
    </LinearGradient>
  );
}

function Stat({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon}
      <Txt size={12.5} color={T.muted}>
        {text}
      </Txt>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Txt w={700} size={14} style={{ marginBottom: 10 }}>
        {title}
      </Txt>
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

function Row({ a, photo, detail }: { a: StoryActivity; photo?: string; detail: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Avatar uri={photo} name={a.name} size={36} />
      <View style={{ flex: 1 }}>
        <Txt w={700} size={13}>
          {a.name}
        </Txt>
        <Txt size={12.5} color={T.muted} numberOfLines={3} style={{ marginTop: 1 }}>
          {detail}
        </Txt>
      </View>
      <Txt size={11} color={T.mutedDim}>
        {timeAgo(a.at)}
      </Txt>
    </View>
  );
}
