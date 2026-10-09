/**
 * Chat-side UI for "chats that don't die" + post-date feedback + date safety.
 * Prototype styling: surface cards, pill chips, rose/amber accents.
 */
import { Archive, CalendarHeart, Hourglass, MessageCircle, Shield, ShieldCheck, Sparkles, Video, X } from 'lucide-react-native';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Share, TextInput, View } from 'react-native';

import { inputStyle } from '@/components/app/AuthForm';
import { Chip, PrimaryButton } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { timeLeftLabel, type DateFeedback, type Lifecycle } from '@/lib/matchLife';

function Card({ children, accent = T.border, bg = T.surface }: { children: ReactNode; accent?: string; bg?: string }) {
  return <View style={{ marginTop: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: accent, backgroundColor: bg }}>{children}</View>;
}

function SmallBtn({ label, onPress, primary, disabled, icon }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: primary ? T.rose : T.surface2,
        borderWidth: primary ? 0 : 1,
        borderColor: T.border,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}>
      {icon}
      <Txt w={700} size={12.5} color={primary ? '#fff' : T.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Live "47h 12m" — ticks every 30 s on its own. */
const TimeLeft = memo(function TimeLeft({ to }: { to: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [to]);
  return (
    <Txt v="mono" w={700} size={12} color={T.amber}>
      {timeLeftLabel(to, now)}
    </Txt>
  );
});

/* ------------------------------ lifecycle ------------------------------ */

export function ExpiringBanner({ life, name, busy, onExtend }: { life: Lifecycle; name: string; busy: boolean; onExtend: () => void }) {
  if (life.state === 'expired') {
    return (
      <Card accent={T.border} bg={T.surface2}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Archive size={15} color={T.muted} />
          <Txt w={700} size={13.5}>
            This match expired
          </Txt>
        </View>
        <Txt size={12} color={T.muted} lh={1.4}>
          The chat went quiet, so it's archived. Your messages are still here to read.
        </Txt>
      </Card>
    );
  }
  if (life.state !== 'expiring') return null;
  return (
    <Card accent={`${T.amber}77`} bg={`${T.amber}12`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
          <Hourglass size={15} color={T.amber} />
          <Txt w={700} size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
            Match expiring
          </Txt>
        </View>
        <TimeLeft to={life.expiresAt} />
      </View>
      <Txt size={12} color={T.muted} lh={1.4} style={{ marginBottom: 10 }}>
        No messages for a while. Send {name} a message to keep it alive{life.extendedByMe ? '.' : ', or extend it once.'}
      </Txt>
      {life.extendedByMe ? (
        <Txt size={11.5} color={T.mutedDim}>
          You've used your extension.
        </Txt>
      ) : (
        <View style={{ flexDirection: 'row' }}>
          <SmallBtn label={busy ? 'Extending…' : 'Extend 48h'} onPress={onExtend} disabled={busy} primary icon={<Hourglass size={13} color="#fff" />} />
        </View>
      )}
    </Card>
  );
}

export function StartersCard({ name, starters, onPick }: { name: string; starters: string[]; onPick: (s: string) => void }) {
  if (!starters.length) return null;
  return (
    <Card accent={`${T.rose}55`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 }}>
        <Sparkles size={14} color={T.rose} />
        <Txt w={700} size={13.5}>
          Break the ice with {name}
        </Txt>
      </View>
      <Txt size={11.5} color={T.mutedDim} style={{ marginBottom: 8 }}>
        Picked from what you have in common — tap one to start.
      </Txt>
      {starters.map((s) => (
        <Pressable
          key={s}
          onPress={() => onPick(s)}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: T.surface2, marginTop: 6, opacity: pressed ? 0.75 : 1 })}>
          <MessageCircle size={14} color={T.muted} style={{ marginTop: 1 }} />
          <Txt size={12.5} lh={1.35} style={{ flex: 1 }}>
            {s}
          </Txt>
        </Pressable>
      ))}
    </Card>
  );
}

export function VideoSuggestCard({ name, onCall, onDismiss }: { name: string; onCall: () => void; onDismiss: () => void }) {
  return (
    <Card accent={`${T.violet}66`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
          <Video size={15} color={T.violet} />
          <Txt w={700} size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
            Ready for a video call?
          </Txt>
        </View>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Dismiss">
          <X size={15} color={T.mutedDim} />
        </Pressable>
      </View>
      <Txt size={12} color={T.muted} lh={1.4} style={{ marginTop: 4, marginBottom: 10 }}>
        You and {name} have been chatting a lot. A quick call is the easiest way to see if the vibe is real.
      </Txt>
      <View style={{ flexDirection: 'row' }}>
        <SmallBtn label="Video call" onPress={onCall} primary icon={<Video size={13} color="#fff" />} />
      </View>
    </Card>
  );
}

/** "They say you met" confirm, or "How did it go?" once I marked it. */
export function DateCard({ name, iMarked, theyMarked, feedbackDone, onConfirm, onFeedback }: { name: string; iMarked: boolean; theyMarked: boolean; feedbackDone: boolean; onConfirm: () => void; onFeedback: () => void }) {
  if (iMarked && feedbackDone) return null;
  if (!iMarked && !theyMarked) return null;
  return (
    <Card accent={`${T.amber}66`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <CalendarHeart size={15} color={T.amber} />
        <Txt w={700} size={13.5}>
          {iMarked ? `How did it go with ${name}?` : `${name} says you met 💛`}
        </Txt>
      </View>
      <Txt size={12} color={T.muted} lh={1.4} style={{ marginBottom: 10 }}>
        {iMarked ? 'Three quick questions. Private — never shown to them.' : 'Did you? Confirm to share private feedback with MATCH.'}
      </Txt>
      <View style={{ flexDirection: 'row' }}>
        {iMarked ? <SmallBtn label="Share private feedback" onPress={onFeedback} primary /> : <SmallBtn label="Yes, we met" onPress={onConfirm} primary />}
      </View>
    </Card>
  );
}

/* ------------------------------ sheets ------------------------------ */

function MenuRow({ icon, label, sub, onPress, color = T.text }: { icon: ReactNode; label: string; sub?: string; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 16, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, marginBottom: 8, opacity: pressed ? 0.8 : 1 })}>
      {icon}
      <View style={{ flex: 1 }}>
        <Txt w={700} size={14} color={color}>
          {label}
        </Txt>
        {sub ? (
          <Txt size={11.5} color={T.mutedDim} style={{ marginTop: 1 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ChatMenuSheet({ visible, name, iMarked, feedbackDone, onClose, onWeMet, onFeedback, onDateSafety, onSafety }: { visible: boolean; name: string; iMarked: boolean; feedbackDone: boolean; onClose: () => void; onWeMet: () => void; onFeedback: () => void; onDateSafety: () => void; onSafety: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title={name}>
      {!iMarked ? (
        <MenuRow icon={<CalendarHeart size={18} color={T.amber} />} label="We met 💛" sub="Tell us you went on a date — unlocks private feedback" onPress={onWeMet} />
      ) : !feedbackDone ? (
        <MenuRow icon={<CalendarHeart size={18} color={T.amber} />} label="Share date feedback" sub="Private — never shown to them" onPress={onFeedback} />
      ) : null}
      <MenuRow icon={<ShieldCheck size={18} color={T.mint} />} label="Date safety" sub="Share date details with someone you trust + check-in reminder" onPress={onDateSafety} />
      <MenuRow icon={<Shield size={18} color={T.rose} />} label="Block or report" onPress={onSafety} color={T.rose} />
    </Sheet>
  );
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Txt w={700} size={13.5} style={{ marginBottom: 8 }}>
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

export function DateFeedbackSheet({ visible, name, onClose, onSubmit }: { visible: boolean; name: string; onClose: () => void; onSubmit: (f: DateFeedback) => Promise<void> }) {
  const [photos, setPhotos] = useState<DateFeedback['lookedLikePhotos'] | null>(null);
  const [safe, setSafe] = useState<boolean | null>(null);
  const [again, setAgain] = useState<DateFeedback['meetAgain'] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) {
      setPhotos(null);
      setSafe(null);
      setAgain(null);
      setNote('');
    }
  }, [visible]);
  const ready = photos != null && safe != null && again != null;
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Private date feedback" icon={<CalendarHeart size={17} color={T.amber} />}>
      <Txt size={12.5} color={T.muted} style={{ marginTop: -8, marginBottom: 16 }} lh={1.4}>
        Only MATCH sees this — never {name}. It powers the “Real photos” badge, and concerns go straight to our safety team.
      </Txt>
      <Question label={`Did ${name} look like their photos?`}>
        {(['yes', 'mostly', 'no'] as const).map((v) => (
          <Chip key={v} label={v === 'yes' ? 'Yes' : v === 'mostly' ? 'Mostly' : 'No'} active={photos === v} onPress={() => setPhotos(v)} />
        ))}
      </Question>
      <Question label="Did you feel safe?">
        <Chip label="Yes" active={safe === true} onPress={() => setSafe(true)} />
        <Chip label="No" active={safe === false} onPress={() => setSafe(false)} />
      </Question>
      <Question label="Would you meet again?">
        {(['yes', 'maybe', 'no'] as const).map((v) => (
          <Chip key={v} label={v === 'yes' ? 'Yes' : v === 'maybe' ? 'Maybe' : 'No'} active={again === v} onPress={() => setAgain(v)} />
        ))}
      </Question>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Private note to MATCH safety (optional)"
        placeholderTextColor={T.mutedDim}
        multiline
        maxLength={1000}
        style={[inputStyle, { fontSize: 13.5, minHeight: 80, textAlignVertical: 'top', borderRadius: 14, marginBottom: 16 }]}
      />
      {safe === false ? (
        <Txt size={12} color={T.rose} style={{ marginBottom: 12 }} lh={1.4}>
          We're sorry. Our safety team will review this. If you're in danger right now, call 112.
        </Txt>
      ) : null}
      <PrimaryButton
        label="Send privately"
        disabled={!ready}
        loading={busy}
        onPress={async () => {
          if (!ready) return;
          setBusy(true);
          try {
            await onSubmit({ lookedLikePhotos: photos!, feltSafe: safe!, meetAgain: again!, note });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

const CHECKIN_HOURS = [1, 2, 3] as const;

export function DateSafetySheet({ visible, name, age, photo, onClose, onReminder }: { visible: boolean; name: string; age: number | null; photo: string | null; onClose: () => void; onReminder: (hours: number) => Promise<boolean> }) {
  const [where, setWhere] = useState('');
  const [when, setWhen] = useState('');
  const [hours, setHours] = useState<number | null>(2);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) setDone(null);
  }, [visible]);
  const share = async () => {
    setBusy(true);
    try {
      const checkBy = hours ? new Date(Date.now() + hours * 3600_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
      const lines = [
        `I'm going on a date with ${name}${age ? ` (${age})` : ''} — we met on MATCH 💛`,
        where.trim() ? `Where: ${where.trim()}` : null,
        when.trim() ? `When: ${when.trim()}` : null,
        photo ? `Their photo: ${photo}` : null,
        checkBy ? `I'll check in by ${checkBy}. If you don't hear from me, please call me.` : null,
      ].filter(Boolean);
      const res = await Share.share({ message: lines.join('\n') });
      const shared = res.action !== Share.dismissedAction;
      const reminded = hours ? await onReminder(hours) : false;
      setDone(
        [shared ? 'Details shared.' : null, reminded ? `We'll remind you to check in in ${hours}h.` : hours ? 'Allow notifications to get a check-in reminder.' : null]
          .filter(Boolean)
          .join(' ') || 'Nothing shared.'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Date safety" icon={<ShieldCheck size={17} color={T.mint} />}>
      <Txt size={12.5} color={T.muted} style={{ marginTop: -8, marginBottom: 14 }} lh={1.4}>
        Send your date details to someone you trust. Nothing is shared with {name} or stored by MATCH.
      </Txt>
      <TextInput value={where} onChangeText={setWhere} placeholder="Where (e.g. Park bar, Bairro Alto)" placeholderTextColor={T.mutedDim} maxLength={120} style={[inputStyle, { marginBottom: 10 }]} />
      <TextInput value={when} onChangeText={setWhen} placeholder="When (e.g. Tonight 8pm)" placeholderTextColor={T.mutedDim} maxLength={60} style={[inputStyle, { marginBottom: 14 }]} />
      <Txt w={700} size={13} style={{ marginBottom: 8 }}>
        Check-in reminder
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {CHECKIN_HOURS.map((h) => (
          <Chip key={h} label={`In ${h}h`} active={hours === h} onPress={() => setHours(h)} />
        ))}
        <Chip label="No reminder" active={hours == null} onPress={() => setHours(null)} />
      </View>
      {done ? (
        <Txt size={12.5} color={T.mint} style={{ marginBottom: 12 }}>
          {done}
        </Txt>
      ) : null}
      <PrimaryButton label="Share with a trusted contact" loading={busy} onPress={share} />
    </Sheet>
  );
}
