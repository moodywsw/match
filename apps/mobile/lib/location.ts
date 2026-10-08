import * as Location from 'expo-location';

import { supabase } from './supabase';

/**
 * Opt-in approximate location.
 *
 * The device position is sent once to `set_my_location`, which snaps it to a
 * ~1.5 km grid cell server-side and stores ONLY that cell in a private table
 * (never readable by clients). Other users only ever get whole-km distances or
 * jittered offsets from the map RPC — never coordinates.
 */
export type LocationStatus = { hasLocation: boolean; updatedAt: string | null };

export async function getLocationStatus(): Promise<LocationStatus> {
  const { data, error } = await supabase.rpc('get_my_location_status');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { has_location: boolean; updated_at: string | null } | undefined;
  return { hasLocation: !!row?.has_location, updatedAt: row?.updated_at ?? null };
}

/** Ask for foreground permission and read a low-accuracy fix. Returns null if denied/unavailable. */
export async function readDevicePosition(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000, requiredAccuracy: 3000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

export type ShareResult = 'shared' | 'denied' | 'unavailable';

/** Prompt (if needed) and share the coarse location. */
export async function shareApproximateLocation(): Promise<ShareResult> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status === 'denied' && !perm.canAskAgain) return 'denied';
  const pos = await readDevicePosition();
  if (!pos) {
    const again = await Location.getForegroundPermissionsAsync();
    return again.status === 'granted' ? 'unavailable' : 'denied';
  }
  const { error } = await supabase.rpc('set_my_location', { p_lat: pos.lat, p_lng: pos.lng });
  if (error) throw error;
  return 'shared';
}

/**
 * Refresh silently (no prompt) when the user already opted in and granted
 * permission, so distance stays roughly current. Throttled by the caller.
 */
export async function refreshLocationIfOptedIn(): Promise<void> {
  const status = await getLocationStatus().catch(() => null);
  if (!status?.hasLocation) return;
  if (status.updatedAt && Date.now() - new Date(status.updatedAt).getTime() < 6 * 3600 * 1000) return;
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    await supabase.rpc('set_my_location', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
  } catch {
    /* best effort */
  }
}

export async function stopSharingLocation(): Promise<void> {
  const { error } = await supabase.rpc('clear_my_location');
  if (error) throw error;
}

export type MapPerson = {
  id: string;
  name: string;
  birth_date: string | null;
  dx_km: number;
  dy_km: number;
  distance_km: number;
};

/** People near me as jittered offsets (km) from my own cell. */
export async function fetchMapPeople(maxKm = 25, limit = 40): Promise<MapPerson[]> {
  const { data, error } = await supabase.rpc('get_map_people', { p_max_km: maxKm, p_limit: limit });
  if (error) throw error;
  return ((data || []) as MapPerson[]).map((r) => ({
    ...r,
    dx_km: Number(r.dx_km),
    dy_km: Number(r.dy_km),
    distance_km: Number(r.distance_km),
  }));
}
