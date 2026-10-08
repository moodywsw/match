import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { eventErrorMessage, fetchEvents, setRsvp, type EventDetail, type RsvpStatus } from '@/lib/events';
import { fetchPrimaryPhotos } from '@/lib/profile';

export type EventFilters = { scope: 'upcoming' | 'mine'; category: string | null; city: string };

/** Server-backed events (get_events RPC) + attendee avatars + optimistic RSVP. */
export function useEvents(filters: EventFilters = { scope: 'upcoming', category: null, city: '' }) {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventDetail[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const id = ++reqId.current;
    try {
      const rows = await fetchEvents({ scope: filters.scope, category: filters.category, city: filters.city });
      if (id !== reqId.current) return;
      setEvents(rows);
      setError(null);
      const ids = [...new Set(rows.flatMap((r) => r.attendee_ids))];
      if (ids.length) {
        const p = await fetchPrimaryPhotos(ids).catch(() => ({}) as Record<string, string>);
        if (id === reqId.current) setPhotos((old) => ({ ...old, ...p }));
      }
    } catch (err) {
      if (id === reqId.current) setError(eventErrorMessage(err));
      console.warn('[match] events load failed', err);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [user?.id, filters.scope, filters.category, filters.city]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => void load(), filters.city ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, filters.city]);

  /** Set (or clear, when tapping the active one) my RSVP. Returns the new status. */
  const rsvp = useCallback(
    async (ev: EventDetail, status: RsvpStatus): Promise<RsvpStatus | null> => {
      if (!user?.id) throw new Error('Sign in first');
      const next: RsvpStatus | null = ev.my_status === status ? null : status;
      const apply = (from: RsvpStatus | null, to: RsvpStatus | null) =>
        setEvents((list) =>
          list.map((e) => {
            if (e.id !== ev.id) return e;
            let going = e.going_count;
            let interested = e.interested_count;
            if (from === 'going') going--;
            if (from === 'interested') interested--;
            if (to === 'going') going++;
            if (to === 'interested') interested++;
            const ids = e.attendee_ids.filter((x) => x !== user.id);
            return {
              ...e,
              my_status: to,
              going_count: Math.max(0, going),
              interested_count: Math.max(0, interested),
              attendee_ids: to === 'going' ? [user.id, ...ids].slice(0, 5) : ids,
            };
          })
        );
      apply(ev.my_status, next);
      try {
        await setRsvp(ev.id, user.id, next);
      } catch (err) {
        apply(next, ev.my_status);
        throw new Error(eventErrorMessage(err));
      }
      return next;
    },
    [user?.id]
  );

  return { events, photos, rsvp, loading, error, reload: load };
}
