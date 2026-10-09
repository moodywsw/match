import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { fetchLiveRooms } from '@/lib/live';
import { LIVE_ROOMS, SHOW_DEMO_CONTENT, type LiveRoom } from '@/lib/mock';

const REFRESH_MS = 20_000;

/** Active live rooms from Supabase (block-filtered, live viewer counts) + demo rooms while SHOW_DEMO_CONTENT. */
export function useLiveRooms(category: string = 'Trending') {
  const [real, setReal] = useState<LiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await fetchLiveRooms(category);
      setReal(
        rows.map((r) => ({
          id: r.id,
          real: true,
          title: r.title,
          category: r.category,
          viewers: r.viewers,
          reactions: r.reactions,
          cover: r.host_photo,
          hostId: r.host_id,
          guestId: r.guest_id,
          host: { name: r.is_mine ? 'You' : r.host_name || 'Host', photo: r.host_photo },
          guest: r.guest_id ? { name: r.guest_name || 'Guest', photo: r.guest_photo } : undefined,
          liveMatch: r.is_live_match,
          isSelf: r.is_mine,
          roomType: r.room_type ?? 'standard',
          question: r.question ?? null,
          daters: r.daters ?? 0,
        }))
      );
    } catch {
      setReal([]);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load])
  );

  useEffect(() => {
    if (!focused) return;
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [focused, load]);

  const demo = SHOW_DEMO_CONTENT ? (category === 'Trending' ? LIVE_ROOMS : LIVE_ROOMS.filter((r) => r.category === category)) : [];
  return { rooms: [...real, ...demo], realRooms: real, loading, reload: load };
}
