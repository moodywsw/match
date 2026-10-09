# Wallet (MATCH coins) and growth features

All balances are **server-authoritative**. Coins change only inside `private.wallet_apply()`,
which writes an append-only ledger (`wallet_transactions`). Clients can read their own rows
and nothing else. Tunables are in `public.app_settings`.

## Wallet
- **Where:** the `/wallet` screen (Profile → "Wallet · N coins", Profile → "Invite friends", the
  Live tab coin pill, Discover boost "Top up"). Inside lives it opens as a sheet (gift sheet
  "+ Top up", plus the low-balance button "Top up · need N more").
- **Balance:** coins (spendable) and diamonds (received from gifts; can't be cashed out).
- **Top up:** RevenueCat consumables `coins_100` (€0.99), `coins_550` (€4.99, +10%) and
  `coins_1200` (€9.99, +20%). The app shows the **store's localized price** when the product
  exists. Otherwise it shows the reference price with "Coming soon", or "In the MATCH app" in
  Expo Go. Credits arrive only via `revenuecat-webhook` → `credit_coin_purchase` (idempotent
  per store transaction). Refunds go through `reverse_coin_purchase`.
- **History:** `get_wallet_history` returns readable rows: "Sent Flame · to Ana · live",
  "Received Rose", "100 coin pack", "Store refund", "Daily streak · day 3", "Invite bonus",
  "Boost · 30 min". Filters: All / Purchases / Gifts / Rewards & boosts. Names of blocked
  people show as "a member".
- **Admin test coins:** admins (`profiles.is_admin`) see "Add 500 test coins (admin only)"
  (`admin_grant_coins`, server-checked).
- **Play billing compliance:** coins can only be bought via store IAP. No cash-out, no
  transfers, no web checkout. Free coins come only from the server rules below.

## Growth and retention features
| Feature | How it works | Settings |
|---|---|---|
| **Daily streak** | Home shows "Day N streak — your daily coins are ready". Claim once per Lisbon calendar day: 5 coins on days 1–6, 25 on day 7, then the week repeats. Missing a day resets the streak. Onboarded, non-hidden users only. | `streak_daily_coins`, `streak_day7_coins` |
| **Invite friends** | Everyone gets a 6-character code (Wallet). A friend enters it within their first 7 days. When the friend's profile is complete (same rules as Live: photo, bio, intention, 3 interests), **both** get 50 coins, paid automatically by triggers. The inviter gets an in-app and push notification. Inviters are paid for at most 20 invites. Self, circular, blocked and duplicate codes are rejected. Rate-limited. | `referral_coins`, `referral_max_rewards`, `referral_redeem_days` |
| **Profile strength meter** | A server-computed score (photo 25, bio 15, interests 15, Friday answer 15, intention 10, 3+ photos 10, city 10). The Profile card shows the next step with its % gain, and Home shows a one-line nudge until the score reaches 100. | weights in `get_profile_completeness` |
| **Boost with coins** | 150 coins buys a 30-minute boost. Discover's Boost button offers it when no MATCH+ monthly boost is left (and links to MATCH+). One boost at a time, not available while hidden or incognito, max 6 a day. Coin boosts don't use up the MATCH+ monthly boost. | `boost_coin_price`, `boost_minutes` |
| **Hosting age** | Hosting a live needs an account at least 1 day old (was 7). | `live_host_min_account_days` |

## Store setup still needed (owner)
1. Play Console → Monetise → **In-app products**: create `coins_100`, `coins_550` and
   `coins_1200` (managed products, consumable), priced €0.99, €4.99 and €9.99, then activate
   them. Do the same in App Store Connect (Consumable).
2. RevenueCat: import the three products. They don't need an entitlement, because coins are
   handled by the webhook on `NON_RENEWING_PURCHASE`.
3. Install an APK with `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` set. The packs switch from
   "Coming soon" to live prices automatically, with no app update needed.
