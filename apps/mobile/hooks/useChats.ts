import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { fetchChatList, type ChatListItem } from '@/lib/chat';
import { CHAT_PREVIEWS, PROFILES, SHOW_DEMO_CONTENT } from '@/lib/mock';

export type ChatRow = {
  key: string;
  /** route param for /chat/[conversationId] (demo-* for prototype people) */
  conversationId: string;
  name: string;
  age: number | null;
  photo: string | null;
  match: number | null;
  online: boolean;
  preview: string;
  time: string;
  unread: boolean;
  demo: boolean;
};

function ago(iso: string | null) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Real matches/conversations from Supabase + prototype demo matches. */
export function useChats() {
  const { user } = useAuth();
  const { demoMatchedIds, people } = useApp();
  const [real, setReal] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      setReal(await fetchChatList(user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const realRows: ChatRow[] = real.map((c) => {
    const person = people.find((p) => p.id === c.otherUserId);
    return {
      key: c.conversationId,
      conversationId: c.conversationId,
      name: c.otherName,
      age: person?.age ?? null,
      photo: c.otherPhoto,
      match: person?.match ?? null,
      online: false,
      preview: c.lastMessage || 'Say hi 👋',
      time: ago(c.lastMessageAt || c.matchedAt),
      unread: false,
      demo: false,
    };
  });

  const demoRows: ChatRow[] = SHOW_DEMO_CONTENT
    ? demoMatchedIds
        .map((id) => PROFILES.find((p) => p.id === id))
        .filter((p): p is (typeof PROFILES)[number] => !!p)
        .map((p, i) => ({
          key: p.id,
          conversationId: p.id,
          name: p.name,
          age: p.age,
          photo: p.photo,
          match: p.match,
          online: p.online,
          preview: CHAT_PREVIEWS[(realRows.length + i) % CHAT_PREVIEWS.length],
          time: i === 0 ? 'now' : `${i}h`,
          unread: i < 2,
          demo: true,
        }))
    : [];

  return { rows: [...realRows, ...demoRows], realCount: realRows.length, loading, error, reload: load };
}
