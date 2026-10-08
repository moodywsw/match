import { T } from '@/constants/theme';

import type { StoryFrame, StoryUser } from './mock';
import { fetchPrimaryPhotos } from './profile';
import { supabase } from './supabase';
import { extFromMime, signedUrls, uploadToBucket } from './upload';

export const STORY_MEDIA_BUCKET = 'story-media';

const DEFAULT_BG: Record<string, [string, string]> = {
  text: [T.rose, T.violet],
  question: [T.violet, T.rose],
  poll: [T.amber, T.rose],
};

type StoryRow = {
  id: string;
  user_id: string;
  type: 'photo' | 'text' | 'question' | 'poll';
  media_path: string | null;
  content: Record<string, unknown> | null;
  created_at: string;
};

function bgOf(row: StoryRow): [string, string] {
  const bg = row.content?.bg;
  if (Array.isArray(bg) && bg.length === 2 && bg.every((c) => typeof c === 'string')) return bg as [string, string];
  return DEFAULT_BG[row.type] ?? [T.violet, T.rose];
}

function toFrame(row: StoryRow, urls: Record<string, string>): StoryFrame | null {
  const c = row.content ?? {};
  const meta = { id: row.id, createdAt: row.created_at };
  switch (row.type) {
    case 'photo':
      return { ...meta, type: 'photo', image: row.media_path ? urls[row.media_path] ?? null : null, caption: typeof c.caption === 'string' ? c.caption : undefined };
    case 'text':
      return { ...meta, type: 'text', text: String(c.text ?? ''), bg: bgOf(row) };
    case 'question':
      return { ...meta, type: 'question', question: String(c.question ?? c.text ?? ''), bg: bgOf(row) };
    case 'poll':
      return { ...meta, type: 'poll', question: String(c.question ?? ''), options: Array.isArray(c.options) ? c.options.map(String) : [], bg: bgOf(row) };
    default:
      return null;
  }
}

/**
 * Live (≤24h) stories the viewer may see — RLS: own, matches, discoverable
 * users, minus blocks — grouped per author. The viewer's own stories first,
 * then unseen authors, then seen ones.
 */
export async function fetchStoryUsers(meId: string): Promise<StoryUser[]> {
  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, type, media_path, content, created_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw error;
  const rows = (data || []) as StoryRow[];
  if (!rows.length) return [];

  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const storyIds = rows.map((r) => r.id);
  const paths = rows.map((r) => r.media_path).filter((p): p is string => !!p);
  const [{ data: profiles }, photos, urls, { data: views }] = await Promise.all([
    supabase.from('profiles').select('id, name').in('id', authorIds),
    fetchPrimaryPhotos(authorIds).catch(() => ({}) as Record<string, string | null>),
    paths.length ? signedUrls(STORY_MEDIA_BUCKET, paths) : Promise.resolve({} as Record<string, string>),
    supabase.from('story_views').select('story_id').eq('viewer_id', meId).in('story_id', storyIds),
  ]);
  const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.name as string]));
  const seenIds = new Set((views || []).map((v) => v.story_id as string));

  const byUser = new Map<string, { frames: StoryFrame[]; latest: string; allSeen: boolean }>();
  for (const r of rows) {
    const f = toFrame(r, urls);
    if (!f) continue;
    const g = byUser.get(r.user_id) ?? { frames: [], latest: r.created_at, allSeen: true };
    g.frames.push(f);
    g.latest = r.created_at > g.latest ? r.created_at : g.latest;
    if (!seenIds.has(r.id)) g.allSeen = false;
    byUser.set(r.user_id, g);
  }

  const users: StoryUser[] = [...byUser.entries()].map(([id, g]) => ({
    id,
    name: id === meId ? 'You' : names[id] || 'Match',
    photo: photos[id] ?? null,
    frames: g.frames,
    real: true,
    isMe: id === meId,
    seen: id === meId ? true : g.allSeen,
  }));
  const latest = (u: StoryUser) => byUser.get(u.id)?.latest ?? '';
  return users.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (a.seen !== b.seen) return a.seen ? 1 : -1;
    return latest(b).localeCompare(latest(a));
  });
}

export type NewStory =
  | { type: 'photo'; uri: string; mime: string; caption?: string }
  | { type: 'text'; text: string }
  | { type: 'question'; question: string }
  | { type: 'poll'; question: string; options: string[] };

export async function createStory(meId: string, input: NewStory): Promise<void> {
  let media_path: string | null = null;
  let content: Record<string, unknown>;
  if (input.type === 'photo') {
    const mime = /heic|heif/i.test(input.mime) ? 'image/jpeg' : input.mime;
    media_path = `${meId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromMime(mime)}`;
    await uploadToBucket(STORY_MEDIA_BUCKET, media_path, input.uri, mime);
    content = input.caption ? { caption: input.caption.slice(0, 200) } : {};
  } else if (input.type === 'text') {
    content = { text: input.text.slice(0, 280), bg: DEFAULT_BG.text };
  } else if (input.type === 'question') {
    content = { question: input.question.slice(0, 280), bg: DEFAULT_BG.question };
  } else {
    content = { question: input.question.slice(0, 280), options: input.options.slice(0, 4).map((o) => o.slice(0, 40)), bg: DEFAULT_BG.poll };
  }
  const { error } = await supabase.from('stories').insert({ user_id: meId, type: input.type, media_path, content });
  if (error) {
    if (media_path) void supabase.storage.from(STORY_MEDIA_BUCKET).remove([media_path]);
    throw error;
  }
}

export async function deleteStory(meId: string, storyId: string): Promise<void> {
  const { data } = await supabase.from('stories').select('media_path').eq('id', storyId).eq('user_id', meId).maybeSingle();
  const { error } = await supabase.from('stories').delete().eq('id', storyId).eq('user_id', meId);
  if (error) throw error;
  if (data?.media_path) void supabase.storage.from(STORY_MEDIA_BUCKET).remove([data.media_path as string]);
}

export async function markStoryViewed(storyId: string, meId: string): Promise<void> {
  const { error } = await supabase
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: meId }, { onConflict: 'story_id,viewer_id', ignoreDuplicates: true });
  if (error) console.warn('[match] story view failed', error.message);
}

export async function respondToStory(
  storyId: string,
  meId: string,
  r: { kind: 'vote'; optionIndex: number } | { kind: 'answer' | 'reply'; body: string } | { kind: 'like' }
): Promise<'ok' | 'duplicate'> {
  const row: Record<string, unknown> = { story_id: storyId, responder_id: meId, kind: r.kind };
  if (r.kind === 'vote') row.option_index = r.optionIndex;
  if (r.kind === 'answer' || r.kind === 'reply') row.body = r.body.trim().slice(0, 500);
  const { error } = await supabase.from('story_responses').insert(row);
  if (error) {
    if (error.code === '23505') return 'duplicate';
    throw error;
  }
  return 'ok';
}

export async function fetchMyVote(storyId: string, meId: string): Promise<number | null> {
  const { data } = await supabase
    .from('story_responses')
    .select('option_index')
    .eq('story_id', storyId)
    .eq('responder_id', meId)
    .eq('kind', 'vote')
    .maybeSingle();
  return (data?.option_index as number | undefined) ?? null;
}

export async function fetchPollCounts(storyId: string, optionCount: number): Promise<number[]> {
  const counts = Array.from({ length: optionCount }, () => 0);
  const { data, error } = await supabase.rpc('get_story_poll_counts', { p_story_id: storyId });
  if (error) return counts;
  for (const row of (data || []) as { option_index: number; votes: number }[]) {
    if (row.option_index >= 0 && row.option_index < optionCount) counts[row.option_index] = Number(row.votes);
  }
  return counts;
}

/** Owner-only (RLS): how many people viewed / responded to a story. */
export async function fetchStoryStats(storyId: string): Promise<{ views: number; replies: number }> {
  const [{ count: views }, { count: replies }] = await Promise.all([
    supabase.from('story_views').select('story_id', { count: 'exact', head: true }).eq('story_id', storyId),
    supabase.from('story_responses').select('id', { count: 'exact', head: true }).eq('story_id', storyId).in('kind', ['reply', 'answer']),
  ]);
  return { views: views ?? 0, replies: replies ?? 0 };
}
