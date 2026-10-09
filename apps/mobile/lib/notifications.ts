import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * Foreground presentation — safe defaults. Remote delivery still needs an
 * EAS projectId + APNs/FCM credentials configured by the app owner.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushRegistrationResult = {
  status: 'registered' | 'denied' | 'unavailable' | 'skipped';
  token: string | null;
  detail?: string;
};

function resolvePlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * Request permission and capture an Expo push token when possible.
 * Persists to public.push_tokens for the signed-in user.
 * Does not send any push — that requires server-side Expo Push / FCM / APNs.
 */
export async function registerForPushNotifications(
  userId: string
): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') {
    return { status: 'skipped', token: null, detail: 'web push not configured' };
  }

  if (!Device.isDevice) {
    return {
      status: 'unavailable',
      token: null,
      detail: 'Push tokens require a physical device',
    };
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    finalStatus = asked.status;
  }
  if (finalStatus !== 'granted') {
    return { status: 'denied', token: null, detail: 'Permission not granted' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId;

  if (!projectId || projectId === 'replace-after-eas-init') {
    return {
      status: 'unavailable',
      token: null,
      detail:
        'Set extra.eas.projectId via `eas init` before Expo push tokens can be issued',
    };
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        token,
        platform: resolvePlatform(),
        device_name: Device.modelName ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' }
    );
    if (error) {
      console.warn('[match] push_tokens upsert failed', error.message);
      return { status: 'registered', token, detail: error.message };
    }

    return { status: 'registered', token };
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'token capture failed';
    // Android builds without google-services.json (FCM) can't issue tokens yet —
    // see docs/ANDROID_PUSH.md. Not an error for the user; the app works without push.
    const detail = /firebase|fcm|google-services/i.test(raw)
      ? 'fcm_not_configured: this build has no Firebase config (docs/ANDROID_PUSH.md)'
      : raw;
    console.warn('[match] push token capture', detail);
    return { status: 'unavailable', token: null, detail };
  }
}

/** Remove this device token on sign-out (best-effort). */
export async function clearPushToken(userId: string, token: string | null) {
  if (!token) return;
  await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
}

export type PushTap = { key: string; type: string | undefined; data: Record<string, unknown> };

function toTap(res: Notifications.NotificationResponse | null | undefined): PushTap | null {
  if (!res || res.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const content = res.notification.request.content;
  const data = (content.data ?? {}) as Record<string, unknown>;
  return {
    key: res.notification.request.identifier,
    type: typeof data.type === 'string' ? data.type : undefined,
    data,
  };
}

/**
 * Calls `onTap` for push notifications the user taps — both while the app is
 * running and the one that cold-started it. Each notification is handled once.
 */
export function subscribePushTaps(onTap: (tap: PushTap) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  const seen = new Set<string>();
  const handle = (res: Notifications.NotificationResponse | null | undefined) => {
    const tap = toTap(res);
    if (!tap || seen.has(tap.key)) return;
    seen.add(tap.key);
    onTap(tap);
    void Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => {});
  return () => sub.remove();
}

/**
 * Date safety: a local (on-device, never sent to us) reminder to check in with your
 * trusted contact. Works in Expo Go and the APK — no push server involved.
 */
export async function scheduleDateCheckIn(name: string, hours: number, conversationId: string | null): Promise<boolean> {
  if (Platform.OS === 'web' || hours <= 0) return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    const status = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.DEFAULT });
    }
    const types = (Notifications as unknown as { SchedulableTriggerInputTypes?: { TIME_INTERVAL: string } }).SchedulableTriggerInputTypes;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Date check-in 💛',
        body: `How's it going with ${name}? Let your trusted contact know you're OK.`,
        data: { type: 'date_checkin', conversation_id: conversationId },
      },
      trigger: { type: (types?.TIME_INTERVAL ?? 'timeInterval') as never, seconds: Math.round(hours * 3600), repeats: false },
    });
    return true;
  } catch (err) {
    console.warn('[match] check-in reminder failed', err);
    return false;
  }
}
