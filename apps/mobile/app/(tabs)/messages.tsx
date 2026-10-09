import { useRouter } from 'expo-router';
import { Archive, Hourglass, Star } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Screen } from '@/components/app/Screen';
import { Avatar, DemoTag, EmptyState, FadeUp } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useChats, type ChatRow } from '@/hooks/useChats';
import { timeLeftLabel } from '@/lib/matchLife';

export default function MessagesTab() {
  const router = useRouter();
  const { rows, loading, reload, error } = useChats();
  return (
    <Screen padTop={16} refreshing={loading} onRefresh={reload}>
      <FadeUp>
        <Txt v="display" size={22} style={{ marginBottom: 16 }}>
          Messages
        </Txt>
        {error ? (
          <Txt size={12} color={T.rose} style={{ marginBottom: 10 }}>
            {error}
          </Txt>
        ) : null}
        {rows.length === 0 && !loading ? <EmptyState text="Match with someone to start chatting." /> : null}
        <View style={{ gap: 4 }}>
          {rows.map((p, i) => (
            <View key={p.key}>
            {p.lifeState === 'expired' && rows[i - 1]?.lifeState !== 'expired' ? <ArchivedHeader /> : null}
            <Pressable
              onPress={() => router.push({ pathname: '/chat/[conversationId]', params: { conversationId: p.conversationId } })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
                paddingHorizontal: p.priority ? 10 : 6,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: T.border,
                ...(p.priority ? { backgroundColor: `${T.amber}14`, borderRadius: 16, borderWidth: 1, borderColor: `${T.amber}55`, marginBottom: 4 } : null),
                opacity: pressed ? 0.7 : p.lifeState === 'expired' ? 0.55 : 1,
              })}>
              <View>
                <Avatar uri={p.photo} name={p.name} size={52} />
                {p.online ? <View style={{ position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: T.mint, borderWidth: 2, borderColor: T.ink }} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt w={700} size={14.5}>
                      {p.name}
                    </Txt>
                    {p.demo ? <DemoTag /> : null}
                    {p.priority ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: T.amber }}>
                        <Star size={9} color={T.ink} fill={T.ink} />
                        <Txt w={800} size={9.5} color={T.ink}>
                          PRIORITY
                        </Txt>
                      </View>
                    ) : null}
                  </View>
                  <LifeTag row={p} />
                </View>
                <Txt size={12.5} color={T.muted} numberOfLines={1} style={{ marginTop: 2 }}>
                  {p.preview}
                </Txt>
              </View>
              {p.unread ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.priority ? T.amber : T.rose }} /> : null}
            </Pressable>
            </View>
          ))}
        </View>
      </FadeUp>
    </Screen>
  );
}

function ArchivedHeader() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, marginBottom: 6 }}>
      <Archive size={13} color={T.mutedDim} />
      <Txt v="mono" size={10.5} color={T.mutedDim} style={{ letterSpacing: 1 }}>
        EXPIRED · ARCHIVED
      </Txt>
    </View>
  );
}

/** Time since last message, or the expiry timer / archived label. */
function LifeTag({ row }: { row: ChatRow }) {
  if (row.lifeState === 'expiring') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: `${T.amber}22` }}>
        <Hourglass size={10} color={T.amber} />
        <Txt v="mono" w={700} size={10.5} color={T.amber}>
          {timeLeftLabel(row.expiresAt)}
        </Txt>
      </View>
    );
  }
  return (
    <Txt size={11} color={T.mutedDim}>
      {row.lifeState === 'expired' ? 'Expired' : row.time}
    </Txt>
  );
}
