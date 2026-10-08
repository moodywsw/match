import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Screen } from '@/components/app/Screen';
import { DarkPill, DemoTag, EmptyState, FadeUp, Photo } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useChats } from '@/hooks/useChats';

export default function MatchesTab() {
  const router = useRouter();
  const { rows, loading, reload, error } = useChats();
  return (
    <Screen padTop={16} refreshing={loading} onRefresh={reload}>
      <FadeUp>
        <Txt v="display" size={22} style={{ marginBottom: 4 }}>
          Your Matches
        </Txt>
        <Txt size={13} color={T.muted} style={{ marginBottom: 18 }}>
          {rows.length} {rows.length === 1 ? 'person' : 'people'} matched with you
        </Txt>
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
