import { readDevicePosition } from './location';
import { supabase } from './supabase';
import { extFromMime, uploadToBucket } from './upload';

export const EVENT_COVERS_BUCKET = 'event-covers';

export const EVENT_CATEGORIES = [
  'Nightlife',
  'Music',
  'Dating',
  'Food & drinks',
  'Outdoors',
  'Sports',
  'Culture',
  'Travel',
  'Festival',
  'Other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export type RsvpStatus = 'going' | 'interested';

export type EventDetail = {
  id: string;
  creator_id: string | null;
  creator_name: string | null;
  is_mine: boolean;
  title: string;
  description: string | null;
  category: string | null;
  city: string | null;
  area: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  cover_url: string | null;
  capacity: number | null;
  status: 'scheduled' | 'cancelled';
  going_count: number;
  interested_count: number;
  my_status: RsvpStatus | null;
  attendee_ids: string[];
  has_location: boolean;
  distance_km: number | null;
  dx_km: number | null;
  dy_km: number | null;
};

export type EventAttendee = {
  user_id: string;
  name: string;
  birth_date: string | null;
  status: RsvpStatus;
  is_me: boolean;
};

const num = (v: unknown) => (v == null ? null : Number(v));

function normalize(r: EventDetail): EventDetail {
  return {
    ...r,
    going_count: Number(r.going_count) || 0,
    interested_count: Number(r.interested_count) || 0,
    attendee_ids: r.attendee_ids || [],
    distance_km: num(r.distance_km),
    dx_km: num(r.dx_km),
    dy_km: num(r.dy_km),
  };
}

export async function fetchEvents(opts: { scope?: 'upcoming' | 'mine'; category?: string | null; city?: string | null; limit?: number } = {}): Promise<EventDetail[]> {
  const { data, error } = await supabase.rpc('get_events', {
    p_scope: opts.scope ?? 'upcoming',
    p_category: opts.category ?? null,
    p_city: opts.city?.trim() || null,
    p_event_id: null,
    p_limit: opts.limit ?? 50,
  });
  if (error) throw error;
  return ((data || []) as EventDetail[]).map(normalize);
}

export async function fetchEvent(eventId: string): Promise<EventDetail | null> {
  const { data, error } = await supabase.rpc('get_events', {
    p_scope: 'upcoming',
    p_category: null,
    p_city: null,
    p_event_id: eventId,
    p_limit: 1,
  });
  if (error) throw error;
  const row = ((data || []) as EventDetail[])[0];
  return row ? normalize(row) : null;
}

export async function fetchEventAttendees(eventId: string): Promise<EventAttendee[]> {
  const { data, error } = await supabase.rpc('get_event_attendees', { p_event_id: eventId });
  if (error) throw error;
  return (data || []) as EventAttendee[];
}

/** going / interested / null (= remove RSVP). Capacity & blocks are enforced server-side. */
export async function setRsvp(eventId: string, userId: string, status: RsvpStatus | null): Promise<void> {
  if (!status) {
    const { error } = await supabase.from('event_participants').delete().eq('event_id', eventId).eq('user_id', userId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('event_participants')
    .upsert({ event_id: eventId, user_id: userId, status }, { onConflict: 'event_id,user_id' });
  if (error) throw error;
}

export type EventInput = {
  title: string;
  description: string;
  category: EventCategory;
  city: string;
  area: string;
  location: string;
  startsAt: Date;
  endsAt: Date | null;
  capacity: number | null;
  /** Local picked image (uploaded to event-covers) */
  coverLocal?: { uri: string; mimeType?: string | null } | null;
  /** Keep / clear the existing cover on edit */
  coverUrl?: string | null;
  coverPath?: string | null;
  /** Pin the event near my current position (snapped to ~1.5 km server-side). */
  pinNearMe: boolean;
  /** On edit: the event already had a map pin and the user keeps it. */
  keepPin?: boolean;
};

async function uploadCover(userId: string, cover: { uri: string; mimeType?: string | null }) {
  const mime = cover.mimeType || 'image/jpeg';
  const ext = extFromMime(mime);
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext === 'png' || ext === 'webp' ? ext : 'jpg'}`;
  await uploadToBucket(EVENT_COVERS_BUCKET, path, cover.uri, contentType);
  const { data } = supabase.storage.from(EVENT_COVERS_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

async function buildRow(userId: string, input: EventInput, isEdit: boolean) {
  const row: Record<string, unknown> = {
    title: input.title.trim(),
    description: input.description.trim() || null,
    category: input.category,
    city: input.city.trim() || null,
    area: input.area.trim() || null,
    location: input.location.trim() || null,
    starts_at: input.startsAt.toISOString(),
    ends_at: input.endsAt ? input.endsAt.toISOString() : null,
    capacity: input.capacity,
  };
  if (input.coverLocal) {
    const up = await uploadCover(userId, input.coverLocal);
    row.cover_path = up.path;
    row.cover_url = up.url;
  } else if (input.coverUrl !== undefined) {
    row.cover_url = input.coverUrl;
    row.cover_path = input.coverPath ?? null;
  }
  if (input.pinNearMe && !input.keepPin) {
    const pos = await readDevicePosition();
    if (!pos) throw new Error('location_denied');
    // Snapped to a ~1.5 km cell by the events_before_write trigger; never selectable.
    row.cell_lat = pos.lat;
    row.cell_lng = pos.lng;
  } else if (!input.pinNearMe && isEdit) {
    row.cell_lat = null;
    row.cell_lng = null;
  }
  return row;
}

export async function createEvent(userId: string, input: EventInput): Promise<string> {
  const row = await buildRow(userId, input, false);
  const { data, error } = await supabase.from('events').insert(row).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function updateEvent(userId: string, eventId: string, input: EventInput): Promise<void> {
  const row = await buildRow(userId, input, true);
  const { error } = await supabase.from('events').update(row).eq('id', eventId);
  if (error) throw error;
  void notifyEventAttendees(eventId);
}

export async function setEventCancelled(eventId: string, cancelled: boolean): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ status: cancelled ? 'cancelled' : 'scheduled' })
    .eq('id', eventId);
  if (error) throw error;
  void notifyEventAttendees(eventId);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) throw error;
  void notifyEventAttendees(eventId);
}

/** Push the event_update / event_cancelled rows the DB trigger just wrote to attendees. */
export async function notifyEventAttendees(eventId: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-push', { body: { event_notifications: eventId } });
  } catch (err) {
    console.warn('[match] event push failed', err);
  }
}

export function eventErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('rate_limited')) return "You've created a lot of events today — try again tomorrow";
  if (msg.includes('event_full')) return 'This event is full';
  if (msg.includes('event_cancelled')) return 'This event was cancelled';
  if (msg.includes('event_past')) return 'This event has already happened';
  if (msg.includes('event_in_past')) return 'Pick a start time in the future';
  if (msg.includes('event_not_found')) return 'Event not found';
  if (msg.includes('not_allowed')) return "You can't join this event";
  if (msg.includes('location_denied')) return 'Allow location access to pin the event on the map';
  if (msg.includes('events_shape_check')) return 'Check the title (3–80 chars), times and capacity (2–5000)';
  return msg;
}

export function fmtEventDate(iso: string, endIso?: string | null): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (!endIso) return `${day} · ${time}`;
  const e = new Date(endIso);
  const sameDay = e.toDateString() === d.toDateString();
  const endTime = e.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? `${day} · ${time}–${endTime}`
    : `${day} ${time} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${endTime}`;
}

export function eventPlace(e: Pick<EventDetail, 'area' | 'city' | 'location'>): string {
  return [e.location, e.area, e.city].filter((s) => !!s && s.trim()).join(' · ');
}
