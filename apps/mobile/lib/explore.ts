import { supabase } from './supabase';

export type EventRow = {
  id: string;
  title: string;
  category: string | null;
  location: string | null;
  starts_at: string;
  cover_url: string | null;
};

export type StoryRow = {
  id: string;
  user_id: string;
  type: string;
  media_url: string | null;
  content: unknown;
  expires_at: string;
  authorName?: string;
};

export type LiveRow = {
  id: string;
  host_id: string;
  title: string;
  category: string;
  is_live_match: boolean;
  started_at: string;
  ended_at: string | null;
  hostName?: string;
};

export async function fetchUpcomingEvents(limit = 20): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, category, location, starts_at, cover_url')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function rsvpEvent(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_participants')
    .upsert({ event_id: eventId, user_id: userId }, { onConflict: 'event_id,user_id' });
  if (error) throw error;
}

export async function fetchActiveStories(limit = 30): Promise<StoryRow[]> {
  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, type, media_url, content, expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!data?.length) return [];
  const ids = [...new Set(data.map((s) => s.user_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', ids);
  const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.name]));
  return data.map((s) => ({ ...s, authorName: names[s.user_id] || 'Member' }));
}

export async function fetchLiveStreams(limit = 20): Promise<LiveRow[]> {
  const { data, error } = await supabase
    .from('live_streams')
    .select('id, host_id, title, category, is_live_match, started_at, ended_at')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!data?.length) return [];
  const ids = [...new Set(data.map((s) => s.host_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', ids);
  const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.name]));
  return data.map((s) => ({ ...s, hostName: names[s.host_id] || 'Host' }));
}
