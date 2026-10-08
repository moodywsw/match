import { File } from 'expo-file-system';

import { supabase } from './supabase';

/**
 * Read a local file (file://, ph://-resolved picker URIs, recorder output) as
 * bytes. RN's Blob uploads can silently send 0 bytes to Storage, so we always
 * upload an ArrayBuffer.
 */
export async function readBytes(uri: string): Promise<ArrayBuffer> {
  try {
    return await new File(uri).arrayBuffer();
  } catch {
    const res = await fetch(uri);
    return await res.arrayBuffer();
  }
}

export function extFromMime(mime: string | undefined, fallback = 'jpg'): string {
  if (!mime) return fallback;
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('heif')) return 'heif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('quicktime') || mime === 'video/mov') return 'mov';
  if (mime.includes('video') || mime.includes('mp4')) return 'mp4';
  if (mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  return fallback;
}

export async function uploadToBucket(bucket: string, path: string, uri: string, contentType: string): Promise<void> {
  const bytes = await readBytes(uri);
  if (!bytes.byteLength) throw new Error('File is empty');
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

const signedCache = new Map<string, { url: string; exp: number }>();

/** Short-lived signed URL for a private object, cached in memory. */
export async function signedUrl(bucket: string, path: string, ttl = 3600): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = signedCache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return null;
  signedCache.set(key, { url: data.signedUrl, exp: Date.now() + ttl * 1000 });
  return data.signedUrl;
}

export async function signedUrls(bucket: string, paths: string[], ttl = 3600): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of paths) {
    const hit = signedCache.get(`${bucket}/${p}`);
    if (hit && hit.exp > Date.now() + 60_000) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, ttl);
    for (const row of data || []) {
      if (row.path && row.signedUrl) {
        out[row.path] = row.signedUrl;
        signedCache.set(`${bucket}/${row.path}`, { url: row.signedUrl, exp: Date.now() + ttl * 1000 });
      }
    }
  }
  return out;
}
