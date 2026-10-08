import { supabase } from './supabase';
import { fetchPrimaryPhotos } from './profile';

export type ChatListItem = {
  matchId: string;
  conversationId: string;
  otherUserId: string;
  otherName: string;
  otherPhoto: string | null;
  matchedAt: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: string;
  content: string | null;
  media_url: string | null;
  read_at: string | null;
  created_at: string;
};

export async function ensureConversation(matchId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_conversation', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchChatList(userId: string): Promise<ChatListItem[]> {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, user_a, user_b, created_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!matches?.length) return [];

  const otherIds = matches.map((m) =>
    m.user_a === userId ? m.user_b : m.user_a
  );

  const [{ data: profiles }, photos, { data: conversations }] = await Promise.all([
    supabase.from('profiles').select('id, name').in('id', otherIds),
    fetchPrimaryPhotos(otherIds),
    supabase
      .from('conversations')
      .select('id, match_id')
      .in(
        'match_id',
        matches.map((m) => m.id)
      ),
  ]);

  const nameById = Object.fromEntries((profiles || []).map((p) => [p.id, p.name]));
  const convByMatch = Object.fromEntries(
    (conversations || []).map((c) => [c.match_id, c.id])
  );

  // Ensure missing conversations (e.g. matches from before trigger)
  for (const m of matches) {
    if (!convByMatch[m.id]) {
      try {
        convByMatch[m.id] = await ensureConversation(m.id);
      } catch (err) {
        console.warn('[match] ensure_conversation failed', err);
      }
    }
  }

  const convIds = Object.values(convByMatch).filter(Boolean) as string[];
  let lastByConv: Record<string, { content: string | null; created_at: string }> = {};
  if (convIds.length) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, content, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });
    for (const msg of msgs || []) {
      if (!lastByConv[msg.conversation_id]) {
        lastByConv[msg.conversation_id] = {
          content: msg.content,
          created_at: msg.created_at,
        };
      }
    }
  }

  return matches
    .map((m) => {
      const otherUserId = m.user_a === userId ? m.user_b : m.user_a;
      const conversationId = convByMatch[m.id];
      if (!conversationId) return null;
      const last = lastByConv[conversationId];
      return {
        matchId: m.id,
        conversationId,
        otherUserId,
        otherName: nameById[otherUserId] || 'Match',
        otherPhoto: photos[otherUserId] ?? null,
        matchedAt: m.created_at,
        lastMessage: last?.content ?? null,
        lastMessageAt: last?.created_at ?? null,
      } satisfies ChatListItem;
    })
    .filter(Boolean) as ChatListItem[];
}

export async function fetchMessages(
  conversationId: string,
  limit = 80
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, type, content, media_url, read_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      type: 'text',
      content: content.trim(),
    })
    .select('id, conversation_id, sender_id, type, content, media_url, read_at, created_at')
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToMessages(
  conversationId: string,
  onInsert: (msg: ChatMessage) => void
) {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onInsert(payload.new as ChatMessage);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function fetchConversationMeta(
  conversationId: string,
  userId: string
): Promise<{ otherName: string; otherPhoto: string | null; otherUserId: string; otherIntention: string | null } | null> {
  const { data: conv, error } = await supabase
    .from('conversations')
    .select('id, match_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!conv) return null;

  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('user_a, user_b')
    .eq('id', conv.match_id)
    .maybeSingle();
  if (matchError) throw matchError;
  if (!match) return null;

  const otherUserId = match.user_a === userId ? match.user_b : match.user_a;
  const [{ data: profile }, photos] = await Promise.all([
    supabase.from('profiles').select('id, name, intention').eq('id', otherUserId).maybeSingle(),
    fetchPrimaryPhotos([otherUserId]),
  ]);
  return {
    otherUserId,
    otherName: profile?.name || 'Match',
    otherPhoto: photos[otherUserId] ?? null,
    otherIntention: (profile?.intention as string | null) ?? null,
  };
}

/**
 * Ephemeral "typing…" signal over Realtime broadcast (nothing is stored).
 * Fails soft if Realtime is unavailable.
 */
export function joinTypingChannel(
  conversationId: string,
  userId: string,
  onTyping: () => void
): { ping: () => void; leave: () => void } {
  const channel = supabase.channel(`typing:${conversationId}`, {
    config: { broadcast: { self: false } },
  });
  channel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.userId && payload.userId !== userId) onTyping();
    })
    .subscribe();
  let last = 0;
  return {
    ping: () => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      void channel.send({ type: 'broadcast', event: 'typing', payload: { userId } });
    },
    leave: () => {
      supabase.removeChannel(channel);
    },
  };
}
