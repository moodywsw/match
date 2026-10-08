import { fetchPrimaryPhotos } from './profile';
import { supabase } from './supabase';

export type NotificationType = 'match' | 'message' | 'post_like' | 'comment' | 'story_reply';

export type InboxItem = {
  id: string;
  type: NotificationType;
  actorId: string | null;
  actorName: string;
  actorPhoto: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const COLS = 'id, user_id, actor_id, type, payload, read_at, created_at';

const actorCache = new Map<string, { name: string; photo: string | null }>();

async function hydrate(rows: Row[]): Promise<InboxItem[]> {
  const missing = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x && !actorCache.has(x)))];
  if (missing.length) {
    const [{ data: profiles }, photos] = await Promise.all([
      supabase.from('profiles').select('id, name').in('id', missing),
      fetchPrimaryPhotos(missing).catch(() => ({}) as Record<string, string | null>),
    ]);
    const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.name as string]));
    for (const id of missing) actorCache.set(id, { name: names[id] || 'Someone', photo: photos[id] ?? null });
  }
  return rows.map((r) => {
    const a = r.actor_id ? actorCache.get(r.actor_id) : undefined;
    return {
      id: r.id,
      type: r.type,
      actorId: r.actor_id,
      actorName: a?.name || 'Someone',
      actorPhoto: a?.photo ?? null,
      payload: r.payload ?? {},
      readAt: r.read_at,
      createdAt: r.created_at,
    };
  });
}

export async function fetchInbox(userId: string, limit = 50): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return hydrate((data || []) as Row[]);
}

/** Realtime INSERT/UPDATE on the user's own notifications (RLS-scoped). */
export function subscribeInbox(userId: string, onChange: (item: InboxItem) => void): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as Row | undefined;
        if (!row?.id) return;
        void hydrate([row]).then(([item]) => item && onChange(item));
      }
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

export async function markRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
  if (error) throw error;
}

export function inboxIcon(type: NotificationType): string {
  switch (type) {
    case 'match':
      return '🔥';
    case 'message':
      return '💬';
    case 'post_like':
      return '❤️';
    case 'comment':
      return '💭';
    case 'story_reply':
      return '✨';
  }
}

export function inboxText(n: InboxItem): string {
  const preview = typeof n.payload.preview === 'string' ? n.payload.preview : '';
  const count = typeof n.payload.count === 'number' ? n.payload.count : 1;
  switch (n.type) {
    case 'match':
      return `It's a match with ${n.actorName}!`;
    case 'message':
      return count > 1 ? `${n.actorName} sent you ${count} messages` : `${n.actorName} sent you a message${preview ? `: ${preview}` : ''}`;
    case 'post_like':
      return `${n.actorName} liked your post`;
    case 'comment':
      return `${n.actorName} commented${preview ? `: “${preview}”` : ' on your post'}`;
    case 'story_reply':
      return n.payload.kind === 'answer'
        ? `${n.actorName} answered your question${preview ? `: “${preview}”` : ''}`
        : `${n.actorName} replied to your story${preview ? `: “${preview}”` : ''}`;
  }
}

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
