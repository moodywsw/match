/**
 * In-app purchases / subscriptions stub.
 *
 * Schema already has `subscriptions` + `payments` tables that are
 * service-role only (webhook writes). Do NOT insert into them from the client.
 *
 * Intended production wiring (when Apple/Google + RevenueCat accounts exist):
 *  1. Create RevenueCat project; add iOS/Android apps with shared secret / service account.
 *  2. `npx expo install react-native-purchases` (or Expo-compatible IAP module).
 *  3. Configure entitlement ids e.g. `match_plus`, `super_match` to match DB check constraints.
 *  4. Point RevenueCat webhook → Edge Function with service_role to upsert `subscriptions` /
 *     `payments` (never trust the client for entitlement grants).
 *
 * This module intentionally performs no purchases and ships no API keys.
 */

export type EntitlementId = 'match_plus' | 'super_match';

export type IapStatus = {
  configured: false;
  message: string;
};

export function getIapStatus(): IapStatus {
  return {
    configured: false,
    message:
      'IAP/RevenueCat is scaffolded only. Wire react-native-purchases after Apple Developer, Google Play, and RevenueCat projects exist — see README.',
  };
}

/**
 * Placeholder — returns an error until RevenueCat SDK is configured with real keys
 * (keys belong in EAS Secrets / env, never in git).
 */
export async function purchaseEntitlement(
  _entitlement: EntitlementId
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error: 'Purchases are not enabled. Configure RevenueCat + store products first.',
  };
}

export async function restorePurchases(): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error: 'Restore is not enabled until RevenueCat is configured.',
  };
}
