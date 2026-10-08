import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { fetchUpcomingEvents, rsvpEvent, unrsvpEvent, fetchMyRsvps } from '@/lib/explore';
import { EVENTS, SHOW_DEMO_CONTENT, type EventItem } from '@/lib/mock';

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Real events from public.events; prototype events while the table is empty. */
export function useEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>(SHOW_DEMO_CONTENT ? EVENTS : []);
  const [going, setGoing] = useState<Record<string, boolean>>({ 'ev-1': true });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await fetchUpcomingEvents();
      if (rows.length) {
        setEvents(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            date: fmtDate(r.starts_at),
            location: r.location || '',
            cover: r.cover_url,
            going: 0,
            category: r.category || 'Event',
            real: true,
          }))
        );
        if (user?.id) {
          const mine = await fetchMyRsvps(user.id).catch(() => [] as string[]);
          setGoing(Object.fromEntries(mine.map((id) => [id, true])));
        }
      }
    } catch (err) {
      console.warn('[match] events load failed', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (ev: EventItem): Promise<boolean> => {
      const next = !going[ev.id];
      setGoing((g) => ({ ...g, [ev.id]: next }));
      if (ev.real && user?.id) {
        try {
          if (next) await rsvpEvent(ev.id, user.id);
          else await unrsvpEvent(ev.id, user.id);
        } catch (err) {
          setGoing((g) => ({ ...g, [ev.id]: !next }));
          throw err;
        }
      }
      return next;
    },
    [going, user?.id]
  );

  return { events, going, toggle, loading, reload: load };
}
