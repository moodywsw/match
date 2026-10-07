import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';

export type PhotoRow = {
  id: string;
  user_id: string;
  url: string;
  position: number;
  is_primary: boolean;
};

export async function fetchMyPhotos(userId: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, user_id, url, position, is_primary')
    .eq('user_id', userId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data || [];
}

function extFromMime(mime: string | undefined): string {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  return 'jpg';
}

export async function pickAndUploadProfilePhoto(userId: string): Promise<PhotoRow> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Photo library permission is required');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (result.canceled || !result.assets?.[0]) {
    throw new Error('cancelled');
  }

  const asset = result.assets[0];
  const mime = asset.mimeType || 'image/jpeg';
  const ext = extFromMime(mime);
  const path = `${userId}/${Date.now()}.${ext}`;

  const response = await fetch(asset.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from(PROFILE_PHOTOS_BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const existing = await fetchMyPhotos(userId);
  const isPrimary = existing.length === 0;

  const { data, error } = await supabase
    .from('photos')
    .insert({
      user_id: userId,
      url,
      position: existing.length,
      is_primary: isPrimary,
    })
    .select('id, user_id, url, position, is_primary')
    .single();
  if (error) throw error;
  return data;
}

export async function setPrimaryPhoto(userId: string, photoId: string): Promise<void> {
  await supabase.from('photos').update({ is_primary: false }).eq('user_id', userId);
  const { error } = await supabase
    .from('photos')
    .update({ is_primary: true })
    .eq('id', photoId)
    .eq('user_id', userId);
  if (error) throw error;
}
