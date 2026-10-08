import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Screen } from '@/components/app/Screen';
import { Avatar, DemoTag, EmptyState, FadeUp } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useChats } from '@/hooks/useChats';

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
            <Pressable
              key={p.key}
              onPress={() => router.push({ pathname: '/chat/[conversationId]', params: { conversationId: p.conversationId } })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
                paddingHorizontal: 6,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: T.border,
                opacity: pressed ? 0.7 : 1,
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
                  </View>
                  <Txt size={11} color={T.mutedDim}>
                    {p.time}
                  </Txt>
                </View>
                <Txt size={12.5} color={T.muted} numberOfLines={1} style={{ marginTop: 2 }}>
                  {p.preview}
                </Txt>
              </View>
              {p.unread ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: T.rose }} /> : null}
            </Pressable>
          ))}
        </View>
      </FadeUp>
    </Screen>
  );
}
