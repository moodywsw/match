import { Coins, Gem } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { coinPurchaseStatus, fetchCoinPrices, purchaseCoinPack } from '@/lib/iap';
import { fetchCoinPacks, fetchWallet, fetchWalletHistory, fmtCoins, txLabel, type CoinPack, type Wallet, type WalletTx } from '@/lib/wallet';

/** Wallet: coin balance, earned diamonds (no cash-out yet), coin packs, history. */
export function WalletSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [packs, setPacks] = useState<CoinPack[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<WalletTx[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const store = coinPurchaseStatus();

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [w, h] = await Promise.all([fetchWallet(user.id), fetchWalletHistory().catch(() => [] as WalletTx[])]);
    setWallet(w);
    setHistory(h);
    return w;
  }, [user?.id]);

  useEffect(() => {
    if (!visible) return;
    void load();
    fetchCoinPacks()
      .then((p) => {
        setPacks(p);
        return fetchCoinPrices(p.map((x) => x.product_id));
      })
      .then(setPrices)
      .catch(() => {});
  }, [visible, load]);

  useEffect(
    () => () => {
      if (poll.current) clearInterval(poll.current);
    },
    []
  );

  const buy = async (pack: CoinPack) => {
    if (!store.enabled || buying) return;
    setBuying(pack.product_id);
    const before = wallet?.coins ?? 0;
    const r = await purchaseCoinPack(pack.product_id);
    setBuying(null);
    if (!r.ok) {
      if (!r.cancelled) toast(r.error);
      return;
    }
    toast(`+${fmtCoins(pack.coins)} coins on the way 🪙`);
    // The webhook credits the balance server-side; watch for it for ~30 s.
    let tries = 0;
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      tries += 1;
      const w = await load();
      if ((w && w.coins > before) || tries >= 15) {
        if (poll.current) clearInterval(poll.current);
        poll.current = null;
      }
    }, 2000);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Wallet" icon={<Coins size={20} color={T.amber} />}>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
        <View style={{ flex: 1, padding: 14, borderRadius: 18, backgroundColor: T.surface2, borderWidth: 1, borderColor: `${T.amber}44` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Coins size={14} color={T.amber} />
            <Txt v="mono" size={10.5} color={T.amber} style={{ letterSpacing: 1 }}>
              COINS
            </Txt>
          </View>
          <Txt v="display" size={28} style={{ marginTop: 6 }}>
            {wallet ? fmtCoins(wallet.coins) : '—'}
          </Txt>
          <Txt size={11.5} color={T.mutedDim} style={{ marginTop: 2 }}>
            Send gifts in lives
          </Txt>
        </View>
        <View style={{ flex: 1, padding: 14, borderRadius: 18, backgroundColor: T.surface2, borderWidth: 1, borderColor: `${T.violet}44` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Gem size={14} color={T.violet} />
            <Txt v="mono" size={10.5} color={T.violet} style={{ letterSpacing: 1 }}>
              DIAMONDS
            </Txt>
          </View>
          <Txt v="display" size={28} style={{ marginTop: 6 }}>
            {wallet ? fmtCoins(wallet.diamonds) : '—'}
          </Txt>
          <Txt size={11.5} color={T.mutedDim} style={{ marginTop: 2 }}>
            Earned from gifts · payouts coming soon
          </Txt>
        </View>
      </View>

      <Txt v="mono" size={10.5} color={T.muted} style={{ letterSpacing: 1, marginBottom: 8 }}>
        GET COINS
      </Txt>
      {packs.map((p) => {
        const busy = buying === p.product_id;
        return (
          <Pressable
            key={p.product_id}
            disabled={!store.enabled || !!buying}
            onPress={() => void buy(p)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 16,
              marginBottom: 8,
              backgroundColor: T.surface2,
              borderWidth: 1,
              borderColor: T.border,
              opacity: !store.enabled ? 0.45 : pressed ? 0.8 : 1,
            })}>
            <Txt size={22}>🪙</Txt>
            <View style={{ flex: 1 }}>
              <Txt w={700} size={14.5}>
                {fmtCoins(p.coins)} coins
              </Txt>
              {p.coins >= 1200 ? (
                <Txt size={11} color={T.mint}>
                  Best value
                </Txt>
              ) : p.coins >= 550 ? (
                <Txt size={11} color={T.amber}>
                  Popular
                </Txt>
              ) : null}
            </View>
            {busy ? (
              <ActivityIndicator color={T.text} />
            ) : (
              <View style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: store.enabled ? T.rose : T.surface3 }}>
                <Txt w={700} size={12.5} color="#fff">
                  {prices[p.product_id] ?? (store.enabled ? 'Buy' : '—')}
                </Txt>
              </View>
            )}
          </Pressable>
        );
      })}
      {!store.enabled ? (
        <Txt size={12} color={T.mutedDim} style={{ marginBottom: 6 }}>
          {store.message}
        </Txt>
      ) : null}

      <Txt v="mono" size={10.5} color={T.muted} style={{ letterSpacing: 1, marginTop: 16, marginBottom: 8 }}>
        HISTORY
      </Txt>
      {history.length === 0 ? (
        <Txt size={12.5} color={T.mutedDim} style={{ marginBottom: 10 }}>
          No coin activity yet.
        </Txt>
      ) : (
        history.map((t) => (
          <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: T.border, gap: 10 }}>
            {t.currency === 'coins' ? <Coins size={15} color={T.amber} /> : <Gem size={15} color={T.violet} />}
            <View style={{ flex: 1 }}>
              <Txt size={13}>{txLabel[t.kind]}</Txt>
              <Txt v="mono" size={10} color={T.mutedDim}>
                {new Date(t.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Txt>
            </View>
            <Txt v="mono" size={13} w={600} color={t.amount > 0 ? T.mint : T.text}>
              {t.amount > 0 ? '+' : ''}
              {fmtCoins(t.amount)}
            </Txt>
          </View>
        ))
      )}
      <Txt size={11} color={T.mutedDim} style={{ marginTop: 14 }} lh={1.4}>
        Coins are a digital item for use in MATCH only. They can’t be exchanged for cash or transferred. Diamonds can’t be cashed out yet.
      </Txt>
    </Sheet>
  );
}
