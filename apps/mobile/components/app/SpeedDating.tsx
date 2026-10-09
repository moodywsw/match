import { useFocusEffect, useRouter } from 'expo-router';
import { Check, Coins, Flag, Heart, LogOut, Sparkles, Users, X, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { MatchOverlay, type MatchOverlayData } from '@/components/app/MatchOverlay';
import { RoomVideo } from '@/components/app/SpeedVideo';
import { Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, PrimaryButton, TextButton, VerifiedIcon } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { fetchChatList } from '@/lib/chat';
import { missingText } from '@/lib/live';
import { blockUser, REPORT_CATEGORIES, reportUser } from '@/lib/safety';
import {
  clock,
  createFriendsRoom,
  DEFAULT_SPEED_PREFS,
  endedText,
  fetchGroupLobby,
  fetchGroupStatus,
  fetchSpeedNight,
  fetchSpeedStatus,
  joinGroup,
  joinSpeed,
  leaveGroup,
  leaveSpeedQueue,
  nightLabel,
  pickInGroup,
  pushGroupInvites,
  respondGroupInvite,
  secondsLeft,
  SPEED_POLL_MS,
  speedChoose,
  speedErrorMessage,
  speedLeave,
  speedReady,
  startGroup,
  type GroupLobby,
  type GroupRoom,
  type SpeedNight,
  type SpeedPrefs,
  type SpeedSession,
  type SpeedStatus,
} from '@/lib/speed';

const card = { backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 14 } as const;

function Label({ children }: { children: string }) {
  return (
    <Txt v="mono" size={10.5} color={T.mutedDim} style={{ letterSpacing: 1.2, marginBottom: 8, marginTop: 4 }}>
      {children}
    </Txt>
  );
}

/** 1-second clock for countdowns. */
function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Calls `fn` now and every `ms` while the screen is focused. */
function usePoll(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      ref.current();
      const t = setInterval(() => ref.current(), ms);
      return () => clearInterval(t);
    }, [ms, active])
  );
}

// ---------------------------------------------------------------------------
// Speed Dating Night banner (Home + hub)
export function SpeedNightBanner({ night, onPress, compact }: { night: SpeedNight | null; onPress: () => void; compact?: boolean }) {
  const now = useNow(!!night);
  const label = nightLabel(night, now);
  if (!night || !label) return null;
  const soon = night.active || new Date(night.starts_at).getTime() - now < 6 * 3_600_000;
  if (compact && !soon) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ ...card, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, borderColor: night.active ? T.amber : `${T.violet}66`, backgroundColor: night.active ? `${T.amber}18` : `${T.violet}14`, opacity: pressed ? 0.85 : 1 })}>
      <Txt size={26}>⚡</Txt>
      <View style={{ flex: 1 }}>
        <Txt w={700} size={13.5}>
          {label}
        </Txt>
        <Txt size={12} color={T.muted} style={{ marginTop: 2 }}>
          {night.active ? 'More people in the queue right now — jump in' : 'Every Friday · 2-minute video dates · first one each day is free'}
        </Txt>
      </View>
      <Txt w={700} size={12.5} color={night.active ? T.amber : T.violet}>
        {night.active ? 'Join' : 'Open'}
      </Txt>
    </Pressable>
  );
}

/** Home: shows the Speed Dating Night banner on Fridays (from 6 h before) and while it's on. */
export function SpeedNightHome() {
  const router = useRouter();
  const [night, setNight] = useState<SpeedNight | null>(null);
  useFocusEffect(
    useCallback(() => {
      fetchSpeedNight()
        .then(setNight)
        .catch(() => setNight(null));
    }, [])
  );
  return <SpeedNightBanner compact night={night} onPress={() => router.push('/speed')} />;
}

// ---------------------------------------------------------------------------
// preferences
const AGE_PRESETS: { label: string; min: number; max: number }[] = [
  { label: 'Any age', min: 18, max: 99 },
  { label: '18–25', min: 18, max: 25 },
  { label: '25–35', min: 25, max: 35 },
  { label: '35–45', min: 35, max: 45 },
  { label: '45+', min: 45, max: 99 },
];
const KM_PRESETS: { label: string; km: number | null }[] = [
  { label: 'Anywhere', km: null },
  { label: '10 km', km: 10 },
  { label: '50 km', km: 50 },
  { label: '200 km', km: 200 },
];

function PrefsCard({ prefs, onChange, showIntention = true }: { prefs: SpeedPrefs; onChange: (p: SpeedPrefs) => void; showIntention?: boolean }) {
  return (
    <View style={{ ...card, marginBottom: 14, gap: 10 }}>
      <Txt size={12} color={T.muted}>
        We only pair you with people whose preferences match yours both ways.
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {AGE_PRESETS.map((a) => (
          <Chip key={a.label} small label={a.label} active={prefs.minAge === a.min && prefs.maxAge === a.max} onPress={() => onChange({ ...prefs, minAge: a.min, maxAge: a.max })} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {KM_PRESETS.map((k) => (
          <Chip key={k.label} small label={k.label} active={prefs.maxKm === k.km} onPress={() => onChange({ ...prefs, maxKm: k.km })} />
        ))}
      </View>
      {showIntention ? (
        <Chip small label="Same intention only" active={prefs.sameIntention} onPress={() => onChange({ ...prefs, sameIntention: !prefs.sameIntention })} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// report (always available during a date / room)
export function ReportSheet({
  visible,
  onClose,
  people,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  people: { id: string; name: string }[];
  onDone: (personId: string) => Promise<void> | void;
}) {
  const { user } = useAuth();
  const [who, setWho] = useState<string | null>(people.length === 1 ? people[0].id : null);
  const [category, setCategory] = useState<string>('inappropriate');
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setWho(people.length === 1 ? people[0].id : null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const label = (c: string) => c.replace('_', ' ').replace(/^./, (x) => x.toUpperCase());
  return (
    <Sheet visible={visible} onClose={onClose} title="Report" icon={<Flag size={16} color={T.rose} />}>
      {people.length > 1 ? (
        <>
          <Label>WHO</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {people.map((p) => (
              <Chip key={p.id} small label={p.name} active={who === p.id} onPress={() => setWho(p.id)} />
            ))}
          </View>
        </>
      ) : null}
      <Label>WHAT HAPPENED</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {REPORT_CATEGORIES.map((c) => (
          <Chip key={c} small label={label(c)} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      <Chip small label="Also block them" active={block} onPress={() => setBlock((b) => !b)} />
      <Txt size={12} color={T.muted} style={{ marginVertical: 12 }}>
        Our team reviews every report. Reporting ends the date for you and never costs you coins.
      </Txt>
      {error ? (
        <Txt size={12.5} color={T.rose} style={{ marginBottom: 10 }}>
          {error}
        </Txt>
      ) : null}
      <PrimaryButton
        label="Report and leave"
        disabled={!who}
        loading={busy}
        onPress={async () => {
          if (!who || !user?.id) return;
          setBusy(true);
          setError(null);
          try {
            await reportUser({ reporterId: user.id, reportedId: who, category, details: 'Reported from a live video date' });
            if (block) await blockUser(user.id, who).catch(() => undefined);
            await onDone(who);
            onClose();
          } catch (e) {
            setError(speedErrorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 1:1 speed dating
export function SpeedOneOnOne({ prefs, setPrefs, onFixProfile }: { prefs: SpeedPrefs; setPrefs: (p: SpeedPrefs) => void; onFixProfile: () => void }) {
  const router = useRouter();
  const { me } = useApp();
  const [status, setStatus] = useState<SpeedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [overlay, setOverlay] = useState<{ data: MatchOverlayData; conv: string | null } | null>(null);
  const shownMatch = useRef<string | null>(null);
  const now = useNow();

  const load = useCallback(() => {
    fetchSpeedStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  usePoll(load, SPEED_POLL_MS);

  const s = status?.session && status.session.id !== dismissed ? status.session : null;

  // the MATCH moment, once per session
  useEffect(() => {
    if (s?.outcome === 'match' && shownMatch.current !== s.id) {
      shownMatch.current = s.id;
      setOverlay({ data: { name: s.partner.name, photo: s.partner.photo, myPhoto: me?.photo ?? null, myName: me?.name ?? 'You' }, conv: s.conversation_id });
    }
  }, [s?.id, s?.outcome, s?.partner.name, s?.partner.photo, s?.conversation_id, me?.photo, me?.name]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(speedErrorMessage(e));
    } finally {
      setBusy(false);
      load();
    }
  };
  const patchSession = (next: SpeedSession) => setStatus((st) => (st ? { ...st, session: next, state: ['pending', 'live', 'deciding'].includes(next.status) ? 'session' : 'idle' } : st));

  if (!status) return <ActivityIndicator color={T.muted} style={{ marginTop: 40 }} />;

  const errorBar = error ? (
    <Txt size={12.5} color={T.rose} style={{ marginBottom: 10 }} accessibilityRole="alert">
      {error}
    </Txt>
  ) : null;

  const overlayEl = (
    <MatchOverlay
      data={overlay?.data ?? null}
      onClose={() => setOverlay(null)}
      onMessage={() => {
        const conv = overlay?.conv;
        setOverlay(null);
        if (conv) router.push({ pathname: '/chat/[conversationId]', params: { conversationId: conv } });
      }}
    />
  );

  // ---- in a date
  if (s && ['pending', 'live', 'deciding'].includes(s.status)) {
    const p = s.partner;
    const reportEl = (
      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        people={[{ id: p.id, name: p.name }]}
        onDone={async () => {
          const next = await speedLeave(s.id, 'report');
          patchSession(next);
        }}
      />
    );
    const reportBtn = (
      <Pressable onPress={() => setReporting(true)} accessibilityRole="button" accessibilityLabel="Report" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: `${T.rose}22` }}>
        <Flag size={13} color={T.rose} />
        <Txt w={600} size={12} color={T.rose}>
          Report
        </Txt>
      </Pressable>
    );

    if (s.status === 'pending') {
      const readyLeft = secondsLeft(s.ready_deadline, now);
      return (
        <View>
          {errorBar}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Txt v="mono" size={10.5} color={T.mutedDim} style={{ flex: 1, letterSpacing: 1.2 }}>
              BEFORE THE CALL
            </Txt>
            {reportBtn}
          </View>
          <View style={{ ...card, alignItems: 'center', paddingVertical: 20, marginBottom: 12 }}>
            <Avatar uri={p.photo} name={p.name} size={96} ring={T.rose} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <Txt v="display" size={22}>
                {p.name}
                {p.age ? `, ${p.age}` : ''}
              </Txt>
              {p.verified ? <VerifiedIcon size={16} /> : null}
            </View>
            {s.shared_interest ? (
              <View style={{ marginTop: 10, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: `${T.violet}22` }}>
                <Txt w={600} size={12.5} color={T.violet}>
                  ✨ You both like {s.shared_interest}
                </Txt>
              </View>
            ) : null}
          </View>
          {s.icebreaker ? (
            <View style={{ ...card, marginBottom: 14, borderColor: `${T.amber}55` }}>
              <Txt v="mono" size={10} color={T.amber} style={{ letterSpacing: 1.2, marginBottom: 6 }}>
                ICEBREAKER
              </Txt>
              <Txt size={14} lh={1.45}>
                “{s.icebreaker}”
              </Txt>
            </View>
          ) : null}
          {s.me_ready ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={T.rose} />
              <Txt size={13} color={T.muted} style={{ marginTop: 8 }}>
                Waiting for {p.name}… {readyLeft}s
              </Txt>
            </View>
          ) : (
            <PrimaryButton label={`I'm ready · ${readyLeft}s`} loading={busy} onPress={() => run(async () => patchSession(await speedReady(s.id)))} />
          )}
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <TextButton label="Skip this date" onPress={() => run(async () => patchSession(await speedLeave(s.id)))} />
          </View>
          <Txt size={11.5} color={T.mutedDim} style={{ textAlign: 'center', marginTop: 8 }}>
            If {p.name} doesn't show up, your coins come back.
          </Txt>
          {reportEl}
        </View>
      );
    }

    if (s.status === 'live') {
      const left = secondsLeft(s.ends_at, now);
      const refundLeft = secondsLeft(s.refund_until, now);
      return (
        <View>
          {errorBar}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: left <= 15 ? `${T.rose}33` : T.surface2 }}>
              <Txt v="mono" w={600} size={16} color={left <= 15 ? T.rose : T.text} accessibilityLabel={`${left} seconds left`}>
                {clock(left)}
              </Txt>
            </View>
            <Txt w={700} size={14} style={{ flex: 1 }} numberOfLines={1}>
              {p.name}
            </Txt>
            {reportBtn}
          </View>
          <View style={{ height: 420, marginBottom: 12 }}>
            <RoomVideo kind="speed" id={s.id} people={[{ id: p.id, name: p.name, photo: p.photo }, ...(me ? [{ id: me.id, name: 'You', photo: me.photo }] : [])]} />
          </View>
          {s.icebreaker ? (
            <Txt size={12.5} color={T.muted} style={{ marginBottom: 12 }}>
              💬 {s.icebreaker}
            </Txt>
          ) : null}
          <Pressable
            onPress={() => run(async () => patchSession(await speedLeave(s.id)))}
            accessibilityRole="button"
            accessibilityLabel="Leave date"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: T.border }}>
            <LogOut size={15} color={T.muted} />
            <Txt w={600} size={13.5} color={T.muted}>
              Leave date
            </Txt>
          </Pressable>
          {refundLeft > 0 ? (
            <Txt size={11.5} color={T.mutedDim} style={{ textAlign: 'center', marginTop: 8 }}>
              Leaving in the next {refundLeft}s refunds {p.name} and counts against your reliability.
            </Txt>
          ) : null}
          {reportEl}
        </View>
      );
    }

    // deciding
    const decideLeft = secondsLeft(s.decide_deadline, now);
    return (
      <View>
        {errorBar}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>{reportBtn}</View>
        <View style={{ ...card, alignItems: 'center', paddingVertical: 22 }}>
          <Avatar uri={p.photo} name={p.name} size={88} ring={T.violet} />
          <Txt v="display" size={21} style={{ marginTop: 12, textAlign: 'center' }}>
            {s.my_choice ? `Waiting for ${p.name}…` : `Match with ${p.name}?`}
          </Txt>
          <Txt size={12.5} color={T.muted} style={{ marginTop: 6, textAlign: 'center' }}>
            {s.my_choice
              ? `You chose ${s.my_choice === 'match' ? 'Match 💘' : 'Pass'}. Picks are private — you'll only see a match if you both said yes.`
              : `Your pick is private. ${p.name} never sees a Pass. ${decideLeft ? `${clock(decideLeft)} left` : ''}`}
          </Txt>
          {s.my_choice ? (
            <ActivityIndicator color={T.violet} style={{ marginTop: 14 }} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 18, alignSelf: 'stretch' }}>
              <Pressable
                onPress={() => run(async () => patchSession(await speedChoose(s.id, 'pass')))}
                accessibilityRole="button"
                accessibilityLabel="Pass"
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 999, borderWidth: 1, borderColor: T.border }}>
                <X size={16} color={T.muted} />
                <Txt w={700} size={14} color={T.muted}>
                  Pass
                </Txt>
              </Pressable>
              <PrimaryButton style={{ flex: 1 }} label="Match" icon={<Heart size={15} color="#fff" />} loading={busy} onPress={() => run(async () => patchSession(await speedChoose(s.id, 'match')))} />
            </View>
          )}
        </View>
        {reportEl}
      </View>
    );
  }

  // ---- queued
  if (status.state === 'queued') {
    return (
      <View style={{ ...card, alignItems: 'center', paddingVertical: 28 }}>
        {errorBar}
        <ActivityIndicator color={T.rose} size="large" />
        <Txt v="display" size={19} style={{ marginTop: 14 }}>
          Finding your date…
        </Txt>
        <Txt size={12.5} color={T.muted} style={{ marginTop: 6, textAlign: 'center' }}>
          {status.waiting > 1 ? `${status.waiting} people are in the queue right now.` : 'Looking for someone who matches your preferences.'} Keep this screen open.
        </Txt>
        <View style={{ marginTop: 16 }}>
          <TextButton label="Cancel · coins back" onPress={() => run(leaveSpeedQueue)} />
        </View>
      </View>
    );
  }

  // ---- idle (with the result of the last date, if any)
  const last = s && ['done', 'cancelled'].includes(s.status) ? s : null;
  const blocked = status.block;
  const canAfford = status.free_today || status.coins >= status.price;
  return (
    <View>
      {last ? (
        <View style={{ ...card, marginBottom: 14, borderColor: last.outcome === 'match' ? T.rose : T.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar uri={last.partner.photo} name={last.partner.name} size={42} />
            <View style={{ flex: 1 }}>
              <Txt w={700} size={13.5}>
                {last.outcome === 'match' ? `It's a match with ${last.partner.name}! 🔥` : last.outcome === 'no_match' ? 'No match this time' : 'Date ended'}
              </Txt>
              <Txt size={12} color={T.muted} style={{ marginTop: 2 }}>
                {last.outcome === 'match' ? 'Say hi while the spark is fresh.' : last.outcome === 'no_match' ? 'Plenty more people in the queue.' : endedText(last)}
              </Txt>
            </View>
            <Pressable onPress={() => setDismissed(last.id)} accessibilityLabel="Dismiss" hitSlop={8}>
              <X size={16} color={T.mutedDim} />
            </Pressable>
          </View>
          {last.outcome === 'match' && last.conversation_id ? (
            <PrimaryButton small style={{ marginTop: 12 }} label="Say hi" onPress={() => router.push({ pathname: '/chat/[conversationId]', params: { conversationId: last.conversation_id! } })} />
          ) : null}
        </View>
      ) : null}

      <View style={{ ...card, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Zap size={18} color={T.amber} />
          <Txt w={700} size={15} style={{ flex: 1 }}>
            2-minute video dates
          </Txt>
        </View>
        <Txt size={12.5} color={T.muted} style={{ marginTop: 6 }} lh={1.45}>
          We pair you with someone who fits your preferences. Talk for 2 minutes, then both privately pick Match or Pass.
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Txt w={700} size={13} color={status.free_today ? T.mint : T.text} style={{ flex: 1 }}>
            {status.free_today ? '🎟️ Your first date today is free' : `${status.price} coins per date`}
          </Txt>
          <Pressable
            onPress={() => router.push(status.free_today || canAfford ? '/wallet' : { pathname: '/wallet', params: { need: String(status.price - status.coins) } })}
            accessibilityRole="button"
            accessibilityLabel={`Top up, you have ${status.coins} coins`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: `${T.amber}1F` }}>
            <Coins size={13} color={T.amber} />
            <Txt v="mono" w={600} size={12} color={T.amber}>
              {status.coins} · Top up
            </Txt>
          </Pressable>
        </View>
      </View>

      {blocked ? (
        <View style={{ ...card, marginBottom: 14, borderColor: `${T.rose}55` }}>
          <Txt size={13} lh={1.45}>
            {blocked === 'profile_incomplete'
              ? `${missingText(status.missing)} to start speed dating — your date sees your profile before the call.`
              : blocked === 'incognito_speed'
                ? 'Turn off incognito to speed date — your date needs to see who they are talking to.'
                : "Speed dating isn't available for your account right now."}
          </Txt>
          {blocked !== 'not_allowed' ? <PrimaryButton small style={{ marginTop: 12 }} label={blocked === 'incognito_speed' ? 'Open settings' : 'Complete my profile'} onPress={onFixProfile} /> : null}
        </View>
      ) : (
        <>
          <Label>WHO YOU WANT TO MEET</Label>
          <PrefsCard prefs={prefs} onChange={setPrefs} />
          {errorBar}
          <PrimaryButton
            label={status.free_today ? 'Find my date · free' : canAfford ? `Find my date · ${status.price} coins` : `Top up · need ${status.price - status.coins} more`}
            loading={busy}
            icon={<Sparkles size={15} color="#fff" />}
            onPress={() => {
              if (!canAfford) return router.push({ pathname: '/wallet', params: { need: String(status.price - status.coins) } });
              setDismissed(last?.id ?? null);
              void run(() => joinSpeed(prefs));
            }}
          />
        </>
      )}

      <Label>HOW IT WORKS</Label>
      <View style={{ ...card, gap: 8, marginBottom: 10 }}>
        <Txt size={12.5}>🎟️ First date every day is free, then {status.price} coins</Txt>
        <Txt size={12.5}>↩️ Coins back if your date doesn't show up or leaves in the first {status.refund_seconds}s</Txt>
        <Txt size={12.5}>🔒 Match/Pass is private — you only learn about a mutual match</Txt>
        <Txt size={12.5}>🚩 Report is always one tap away and never costs you</Txt>
        <Txt size={12.5}>⏱️ People who leave dates early are paired last</Txt>
      </View>
      {overlayEl}
    </View>
  );
}

// ---------------------------------------------------------------------------
// group rooms
const MODE_INFO = {
  roulette: { emoji: '🎲', title: 'Roulette', blurb: 'A room of up to 10 people who match your preferences' },
  interests: { emoji: '🎯', title: 'Interests', blurb: 'One room per interest — meet people who love the same thing' },
  friends: { emoji: '💌', title: 'Friends', blurb: 'Invite your matches to a private group date' },
} as const;

export function GroupRooms({ prefs, setPrefs, onFixProfile }: { prefs: SpeedPrefs; setPrefs: (p: SpeedPrefs) => void; onFixProfile: () => void }) {
  const router = useRouter();
  const { me } = useApp();
  const { user } = useAuth();
  const [lobby, setLobby] = useState<GroupLobby | null>(null);
  const [room, setRoom] = useState<GroupRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [overlay, setOverlay] = useState<{ data: MatchOverlayData; conv: string | null } | null>(null);
  const shown = useRef<string | null>(null);
  const now = useNow();

  const active = !!room && ['open', 'live', 'picking'].includes(room.status);
  const load = useCallback(() => {
    if (room && ['open', 'live', 'picking'].includes(room.status)) {
      fetchGroupStatus(room.id)
        .then(setRoom)
        .catch(() => undefined);
    } else if (!room) {
      fetchGroupLobby()
        .then((l) => {
          setLobby(l);
          if (l.current) setRoom(l.current);
        })
        .catch(() => undefined);
    }
  }, [room]);
  usePoll(load, active ? SPEED_POLL_MS : 8_000);

  useEffect(() => {
    if (room?.status === 'done' && room.matches?.length && shown.current !== room.id) {
      shown.current = room.id;
      const m = room.matches[0];
      setOverlay({ data: { name: m.name, photo: m.photo, myPhoto: me?.photo ?? null, myName: me?.name ?? 'You' }, conv: m.conversation_id });
    }
    if (room?.status === 'picking' && !room.picks_done) {
      setPicks((cur) => (cur.length ? cur : room.members.filter((m) => m.picked).map((m) => m.id)));
    }
  }, [room, me?.photo, me?.name]);

  const run = async (fn: () => Promise<GroupRoom | unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'members' in (r as object)) setRoom(r as GroupRoom);
    } catch (e) {
      setError(speedErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const errorBar = error ? (
    <Txt size={12.5} color={T.rose} style={{ marginBottom: 10 }} accessibilityRole="alert">
      {error}
    </Txt>
  ) : null;
  const overlayEl = (
    <MatchOverlay
      data={overlay?.data ?? null}
      onClose={() => setOverlay(null)}
      onMessage={() => {
        const conv = overlay?.conv;
        setOverlay(null);
        if (conv) router.push({ pathname: '/chat/[conversationId]', params: { conversationId: conv } });
      }}
    />
  );

  // ---- inside a room
  if (room) {
    const others = room.members.filter((m) => !m.is_me);
    const here = room.members.filter((m) => m.here);
    const info = MODE_INFO[room.mode];
    const header = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Txt size={22}>{info.emoji}</Txt>
        <View style={{ flex: 1 }}>
          <Txt w={700} size={15} numberOfLines={1}>
            {room.title}
          </Txt>
          <Txt size={11.5} color={T.muted}>
            {info.title} · {room.here}/{room.max} here
          </Txt>
        </View>
        {['open', 'live', 'picking'].includes(room.status) && others.length ? (
          <Pressable onPress={() => setReporting(true)} accessibilityRole="button" accessibilityLabel="Report" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: `${T.rose}22` }}>
            <Flag size={13} color={T.rose} />
            <Txt w={600} size={12} color={T.rose}>
              Report
            </Txt>
          </Pressable>
        ) : null}
      </View>
    );
    const reportEl = (
      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        people={others.map((m) => ({ id: m.id, name: m.name }))}
        onDone={async () => {
          const r = await leaveGroup(room.id);
          setRoom(r);
        }}
      />
    );
    const leaveBtn = (
      <Pressable
        onPress={() => run(() => leaveGroup(room.id))}
        accessibilityRole="button"
        accessibilityLabel="Leave room"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: T.border, marginTop: 10 }}>
        <LogOut size={15} color={T.muted} />
        <Txt w={600} size={13.5} color={T.muted}>
          Leave room
        </Txt>
      </Pressable>
    );

    if (room.status === 'open' || room.status === 'live') {
      const left = secondsLeft(room.ends_at, now);
      return (
        <View>
          {header}
          {errorBar}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: T.surface2 }}>
              <Txt v="mono" w={600} size={13} color={room.status === 'live' && left <= 30 ? T.rose : T.text}>
                {room.status === 'live' ? clock(left) : 'Waiting'}
              </Txt>
            </View>
            <Txt size={12} color={T.muted} style={{ flex: 1 }}>
              {room.status === 'live'
                ? 'Say hi to everyone — picks open when the timer ends'
                : room.mode === 'friends'
                  ? room.is_host
                    ? 'Start when your friends are in'
                    : 'Waiting for the host to start'
                  : `Starts when ${room.min} people are here`}
            </Txt>
          </View>
          <View style={{ height: 380 }}>
            <RoomVideo kind="group" id={room.id} people={here.map((m) => ({ id: m.id, name: m.is_me ? 'You' : m.name, photo: m.photo }))} />
          </View>
          {room.status === 'open' && room.is_host ? (
            <>
              {room.invites?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {room.invites.map((i) => (
                    <View key={i.id} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: T.surface2 }}>
                      <Txt size={11.5} color={i.status === 'accepted' ? T.mint : i.status === 'declined' ? T.mutedDim : T.muted}>
                        {i.status === 'accepted' ? '✓ ' : i.status === 'declined' ? '✕ ' : '… '}
                        {i.name}
                      </Txt>
                    </View>
                  ))}
                </View>
              ) : null}
              <PrimaryButton style={{ marginTop: 12 }} label="Start the group date" disabled={room.here < 2} loading={busy} onPress={() => run(() => startGroup(room.id))} />
            </>
          ) : null}
          {leaveBtn}
          {reportEl}
        </View>
      );
    }

    if (room.status === 'picking') {
      const left = secondsLeft(room.picks_until, now);
      return (
        <View>
          {header}
          {errorBar}
          <View style={{ ...card, marginBottom: 12 }}>
            <Txt w={700} size={15}>
              {room.picks_done ? 'Picks saved 🔒' : 'Who did you like?'}
            </Txt>
            <Txt size={12.5} color={T.muted} style={{ marginTop: 4 }}>
              {room.picks_done
                ? `Results in ${clock(left)} or as soon as everyone has picked. Nobody ever sees a one-sided pick.`
                : `Your picks are private. If someone picks you too, it's a match. ${clock(left)} left.`}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {others.map((m) => {
              const on = picks.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  disabled={room.picks_done}
                  onPress={() => setPicks((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Pick ${m.name}`}
                  style={{ width: '30.5%', alignItems: 'center', paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: on ? T.rose : T.border, backgroundColor: on ? `${T.rose}18` : T.surface2, opacity: room.picks_done && !on ? 0.5 : 1 }}>
                  <Avatar uri={m.photo} name={m.name} size={54} />
                  <Txt w={600} size={12} style={{ marginTop: 6 }} numberOfLines={1}>
                    {m.name}
                    {m.age ? `, ${m.age}` : ''}
                  </Txt>
                  {m.matched ? (
                    <Txt size={10} color={T.mint}>
                      Already matched
                    </Txt>
                  ) : null}
                  <View style={{ position: 'absolute', top: 6, right: 6 }}>{on ? <Heart size={14} color={T.rose} fill={T.rose} /> : null}</View>
                </Pressable>
              );
            })}
          </View>
          {!room.picks_done ? (
            <PrimaryButton style={{ marginTop: 14 }} label={picks.length ? `Save ${picks.length} private pick${picks.length > 1 ? 's' : ''}` : 'Nobody this time'} loading={busy} onPress={() => run(() => pickInGroup(room.id, picks))} />
          ) : null}
          {reportEl}
        </View>
      );
    }

    // done / cancelled
    return (
      <View>
        {header}
        <View style={{ ...card, marginBottom: 12 }}>
          {room.status === 'cancelled' ? (
            <Txt size={13.5}>{room.ended_reason === 'host_left' ? 'The host closed this room.' : 'Not enough people joined this time — try again in a moment.'}</Txt>
          ) : room.matches?.length ? (
            <>
              <Txt w={700} size={15} style={{ marginBottom: 10 }}>
                You matched with {room.matches.length} {room.matches.length === 1 ? 'person' : 'people'} 🔥
              </Txt>
              {room.matches.map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                  <Avatar uri={m.photo} name={m.name} size={40} />
                  <Txt w={600} size={13.5} style={{ flex: 1 }}>
                    {m.name}
                  </Txt>
                  {m.conversation_id ? <PrimaryButton small label="Say hi" onPress={() => router.push({ pathname: '/chat/[conversationId]', params: { conversationId: m.conversation_id! } })} /> : null}
                </View>
              ))}
            </>
          ) : (
            <Txt size={13.5}>No mutual picks this time. Every room is a new chance!</Txt>
          )}
        </View>
        <PrimaryButton
          label="Back to rooms"
          onPress={() => {
            setRoom(null);
            setPicks([]);
            fetchGroupLobby().then(setLobby).catch(() => undefined);
          }}
        />
        {overlayEl}
      </View>
    );
  }

  // ---- lobby
  if (!lobby) return <ActivityIndicator color={T.muted} style={{ marginTop: 40 }} />;
  const blocked = lobby.block && lobby.block !== 'incognito_speed' ? lobby.block : null;
  return (
    <View>
      {errorBar}
      {lobby.invites.length ? (
        <>
          <Label>INVITES</Label>
          {lobby.invites.map((i) => (
            <View key={i.room_id} style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Avatar uri={i.host.photo} name={i.host.name} size={40} />
              <View style={{ flex: 1 }}>
                <Txt w={700} size={13}>
                  {i.host.name} invited you
                </Txt>
                <Txt size={11.5} color={T.muted} numberOfLines={1}>
                  {i.title}
                </Txt>
              </View>
              <Pressable onPress={() => run(async () => respondGroupInvite(i.room_id, false).then(() => fetchGroupLobby().then(setLobby)))} accessibilityLabel={`Decline invite from ${i.host.name}`} hitSlop={6}>
                <X size={18} color={T.mutedDim} />
              </Pressable>
              <PrimaryButton small label="Join" loading={busy} onPress={() => run(() => respondGroupInvite(i.room_id, true))} />
            </View>
          ))}
        </>
      ) : null}

      {blocked ? (
        <View style={{ ...card, marginBottom: 14, borderColor: `${T.rose}55` }}>
          <Txt size={13} lh={1.45}>
            {blocked === 'profile_incomplete' ? `${missingText(lobby.missing)} to join group dates.` : "Group dates aren't available for your account right now."}
          </Txt>
          {blocked === 'profile_incomplete' ? <PrimaryButton small style={{ marginTop: 12 }} label="Complete my profile" onPress={onFixProfile} /> : null}
        </View>
      ) : null}

      <Label>ROULETTE</Label>
      <View style={{ ...card, marginBottom: 14 }}>
        <Txt w={700} size={14}>
          {MODE_INFO.roulette.emoji} {MODE_INFO.roulette.blurb}
        </Txt>
        <Txt size={12} color={T.muted} style={{ marginTop: 4 }}>
          Free · up to {lobby.max} people · {lobby.live_minutes} minutes on camera, then private picks
        </Txt>
        {lobby.block === 'incognito_speed' ? (
          <Txt size={12} color={T.amber} style={{ marginTop: 8 }}>
            Turn off incognito to join Roulette and Interest rooms.
          </Txt>
        ) : null}
        <View style={{ marginTop: 10 }}>
          <PrefsCard prefs={prefs} onChange={setPrefs} showIntention={false} />
        </View>
        <PrimaryButton label="Join a roulette room" icon={<Users size={15} color="#fff" />} disabled={!!lobby.block} loading={busy} onPress={() => run(() => joinGroup('roulette', prefs))} />
      </View>

      <Label>INTERESTS</Label>
      <View style={{ ...card, marginBottom: 14 }}>
        <Txt size={12.5} color={T.muted} style={{ marginBottom: 10 }}>
          {MODE_INFO.interests.blurb}
        </Txt>
        {lobby.interest_rooms.length ? (
          <View style={{ gap: 8, marginBottom: 10 }}>
            {lobby.interest_rooms.map((r) => (
              <Pressable
                key={r.room_id}
                disabled={!!lobby.block}
                onPress={() => run(() => joinGroup('interests', prefs, r.interest_id))}
                accessibilityRole="button"
                accessibilityLabel={`Join ${r.label} room`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: T.surface3 }}>
                <Txt w={600} size={13} style={{ flex: 1 }}>
                  🎯 {r.label}
                </Txt>
                <Txt v="mono" size={11.5} color={r.status === 'live' ? T.rose : T.muted}>
                  {r.status === 'live' ? 'LIVE · ' : ''}
                  {r.here}/{lobby.max}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {lobby.my_interests.map((i) => (
            <Chip key={i.id} small label={`+ ${i.label}`} onPress={() => !lobby.block && run(() => joinGroup('interests', prefs, i.id))} />
          ))}
          {!lobby.my_interests.length ? (
            <Txt size={12} color={T.mutedDim}>
              Add interests to your profile to open interest rooms.
            </Txt>
          ) : null}
        </View>
      </View>

      <Label>FRIENDS</Label>
      <View style={{ ...card, marginBottom: 14 }}>
        <Txt w={700} size={14}>
          {MODE_INFO.friends.emoji} {MODE_INFO.friends.blurb}
        </Txt>
        <Txt size={12} color={T.muted} style={{ marginTop: 4, marginBottom: 10 }}>
          Only people you invite can join. Mutual picks at the end still become matches.
        </Txt>
        <PrimaryButton label="Invite matches" disabled={!!blocked} onPress={() => setInviteOpen(true)} />
      </View>

      <InviteSheet
        visible={inviteOpen}
        userId={user?.id ?? null}
        onClose={() => setInviteOpen(false)}
        onCreate={async (title, ids) => {
          const r = await createFriendsRoom(title, ids);
          setRoom(r);
          void pushGroupInvites(r.invited ?? []);
        }}
      />
      {overlayEl}
    </View>
  );
}

function InviteSheet({ visible, onClose, userId, onCreate }: { visible: boolean; onClose: () => void; userId: string | null; onCreate: (title: string, ids: string[]) => Promise<void> }) {
  const [people, setPeople] = useState<{ id: string; name: string; photo: string | null }[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !userId) return;
    setSel([]);
    setError(null);
    fetchChatList(userId)
      .then((rows) => setPeople(rows.map((r) => ({ id: r.otherUserId, name: r.otherName, photo: r.otherPhoto }))))
      .catch(() => setPeople([]));
  }, [visible, userId]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Invite matches" icon={<Users size={16} color={T.rose} />}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Room name (optional)"
        placeholderTextColor={T.mutedDim}
        maxLength={60}
        style={{ color: T.text, borderWidth: 1, borderColor: T.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontFamily: 'Inter_400Regular' }}
      />
      {people == null ? (
        <ActivityIndicator color={T.muted} />
      ) : people.length === 0 ? (
        <Txt size={13} color={T.muted}>
          No matches yet — try Roulette or an Interest room instead.
        </Txt>
      ) : (
        <View style={{ gap: 6, marginBottom: 12 }}>
          {people.map((p) => {
            const on = sel.includes(p.id);
            return (
              <Pressable
                key={p.id}
                onPress={() => setSel((cur) => (on ? cur.filter((x) => x !== p.id) : cur.length >= 9 ? cur : [...cur, p.id]))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Invite ${p.name}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14, backgroundColor: on ? `${T.rose}18` : 'transparent' }}>
                <Avatar uri={p.photo} name={p.name} size={36} />
                <Txt w={600} size={13.5} style={{ flex: 1 }}>
                  {p.name}
                </Txt>
                {on ? <Check size={16} color={T.rose} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
      {error ? (
        <Txt size={12.5} color={T.rose} style={{ marginBottom: 10 }}>
          {error}
        </Txt>
      ) : null}
      <PrimaryButton
        label={sel.length ? `Invite ${sel.length} · up to 9` : 'Pick up to 9 matches'}
        disabled={!sel.length}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await onCreate(title, sel);
            onClose();
          } catch (e) {
            setError(speedErrorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

export { DEFAULT_SPEED_PREFS };
