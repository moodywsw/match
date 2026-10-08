/**
 * RevenueCat IAP (react-native-purchases).
 *
 * - Expo Go: SDK auto-enters Preview API Mode (JS mocks, no native store).
 *   Purchases "succeed" locally; entitlements flip only when the
 *   revenuecat-webhook Edge Function writes public.subscriptions.
 * - Dev / production builds: real StoreKit / Play Billing when
 *   EXPO_PUBLIC_REVENUECAT_{IOS,ANDROID}_KEY is set.
 * - Missing key → stub (never crash). Clients never write subscriptions.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases';

import { supabase } from './supabase';

export type EntitlementId = 'match_plus' | 'super_match';
export type Tier = 'free' | EntitlementId;

export type IapStatus = {
  configured: boolean;
  preview: boolean;
  message: string;
};

const FALLBACK_PRICE: Record<EntitlementId, string> = {
  match_plus: '€14.99/mo',
  super_match: '€24.99/mo',
};

let configured = false;
let preview = false;

function isExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

function apiKey(): string | null {
  const key =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  const v = (key || '').trim();
  return v || null;
}

/** Call once the auth user id is known (and again on logout with null). */
export async function configureIap(appUserId: string | null): Promise<void> {
  const key = apiKey();
  if (!key) {
    configured = false;
    preview = false;
    return;
  }
  try {
    preview = isExpoGo();
    if (!(await Purchases.isConfigured())) {
      Purchases.configure({ apiKey: key, appUserID: appUserId ?? undefined });
      if (__DEV__) void Purchases.setLogLevel(LOG_LEVEL.WARN);
    } else if (appUserId) {
      await Purchases.logIn(appUserId);
    } else {
      await Purchases.logOut();
    }
    configured = true;
  } catch (e) {
    console.warn('[match] IAP configure failed', e);
    configured = false;
  }
}

export function getIapStatus(): IapStatus {
  if (!apiKey()) {
    return {
      configured: false,
      preview: false,
      message: 'Add EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY to enable purchases.',
    };
  }
  if (preview || isExpoGo()) {
    return {
      configured: true,
      preview: true,
      message: 'Expo Go Preview Mode — purchases are simulated. Real billing needs a store build.',
    };
  }
  return { configured: true, preview: false, message: 'Store billing ready.' };
}

export async function fetchOfferingPrices(): Promise<Partial<Record<EntitlementId, string>>> {
  if (!apiKey()) return {};
  try {
    if (!(await Purchases.isConfigured())) return {};
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings.current?.availablePackages ?? [];
    const out: Partial<Record<EntitlementId, string>> = {};
    for (const pkg of pkgs) {
      const id = (pkg.product.identifier + ' ' + pkg.identifier).toLowerCase();
      const price = pkg.product.priceString;
      if (id.includes('super')) out.super_match = price;
      else if (id.includes('plus') || id.includes('match')) out.match_plus = out.match_plus ?? price;
    }
    return out;
  } catch {
    return {};
  }
}

function pickPackage(pkgs: PurchasesPackage[], entitlement: EntitlementId): PurchasesPackage | null {
  const prefer = entitlement === 'super_match' ? ['super'] : ['plus', 'match'];
  for (const needle of prefer) {
    const hit = pkgs.find((p) => (p.product.identifier + p.identifier).toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return pkgs[0] ?? null;
}

/**
 * Purchase the matching package. Entitlement is authoritative only after the
 * RevenueCat webhook upserts public.subscriptions — poll with refreshTier().
 */
export async function purchaseEntitlement(
  entitlement: EntitlementId,
): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  if (!apiKey()) {
    return { ok: false, error: 'Purchases are not configured yet.' };
  }
  try {
    if (!(await Purchases.isConfigured())) {
      return { ok: false, error: 'Purchases SDK is not ready. Sign in and try again.' };
    }
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings.current?.availablePackages ?? [];
    const pkg = pickPackage(pkgs, entitlement);
    if (!pkg) {
      return {
        ok: false,
        error: preview || isExpoGo()
          ? 'No offering in Preview Mode — create products in RevenueCat to simulate.'
          : 'No store product for this plan yet.',
      };
    }
    await Purchases.purchasePackage(pkg);
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; code?: string; message?: string };
    if (err?.userCancelled || err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { ok: false, error: 'Purchase cancelled', cancelled: true };
    }
    return { ok: false, error: err?.message || 'Purchase failed' };
  }
}

export async function restorePurchases(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiKey()) return { ok: false, error: 'Purchases are not configured yet.' };
  try {
    if (!(await Purchases.isConfigured())) return { ok: false, error: 'Purchases SDK is not ready.' };
    await Purchases.restorePurchases();
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Restore failed' };
  }
}

/** Server-side source of truth — never trust the SDK alone for gating. */
export async function fetchServerTier(): Promise<Tier> {
  const { data, error } = await supabase.rpc('get_my_tier');
  if (error) {
    console.warn('[match] get_my_tier', error.message);
    return 'free';
  }
  const t = String(data || 'free');
  return t === 'super_match' || t === 'match_plus' ? t : 'free';
}

export function fallbackPrice(id: EntitlementId): string {
  return FALLBACK_PRICE[id];
}

