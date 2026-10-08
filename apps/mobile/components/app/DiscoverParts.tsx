import Slider from '@react-native-community/slider';
import { BadgeCheck, Calendar, Check, Heart, Lock, MapPin, Shield, SlidersHorizontal, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, MatchRing, Photo, PrimaryButton, SettingRow } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { fetchEvents, fmtEventDate, type EventDetail } from '@/lib/events';
import { fetchMapPeople, getLocationStatus, refreshLocationIfOptedIn, shareApproximateLocation, type MapPerson } from '@/lib/location';
import { INTENTIONS, type Person } from '@/lib/mock';
import { ageFromBirthDate, fetchPrimaryPhotos } from '@/lib/profile';
import { REPORT_CATEGORIES, type ReportCategory } from '@/lib/safety';

import { inputStyle } from './AuthForm';
import { FridayCard } from './FridayCard';
import { LinearGradient } from 'expo-linear-gradient';

/* ------------------------------ compatibility ------------------------------ */
/** Free: overall score + 2 of 7 dimensions + 1 reason (teaser). MATCH+: full breakdown. */
export function CompatibilitySheet({ profile, onClose }: { profile: Person | null; onClose: () => void }) {
  const { tier, requirePremium } = useApp();
  const full = tier !== 'free';
  const entries = profile ? Object.entries(profile.breakdown) : [];
  const shown = full ? entries : entries.slice(0, 2);
  const locked = full ? [] : entries.slice(2);
  const unlock = () => void requirePremium('match_plus', 'The full breakdown is part of MATCH+');
  return (
    <Sheet visible={!!profile} onClose={onClose} maxHeight="82%">
      {profile ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <MatchRing percent={profile.match} size={72} />
            <View>
              <Txt v="display" size={22}>
                {profile.match}% MATCH 🔥
              </Txt>
              <Txt size={12.5} color={T.muted} style={{ marginTop: 2 }}>
                with {profile.name}
              </Txt>
            </View>
          </View>
          <FridayCard answer={profile.fridayAnswer} name={profile.name} style={{ marginBottom: 16 }} />
          {shown.map(([k, v]) => (
            <View key={k} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Txt size={12.5} color={T.muted}>
                  {k}
                </Txt>
                <Txt v="mono" w={600} size={12.5}>
                  {v}%
                </Txt>
              </View>
              <View style={{ height: 6, borderRadius: 6, backgroundColor: T.surface2, overflow: 'hidden' }}>
                <LinearGradient colors={[T.rose, T.amber]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: `${v}%`, height: '100%', borderRadius: 6 }} />
              </View>
            </View>
          ))}
          {locked.length ? (
            <Pressable onPress={unlock} style={{ marginTop: 2 }}>
              {locked.map(([k]) => (
                <View key={k} style={{ marginBottom: 10, opacity: 0.45 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Txt size={12.5} color={T.muted}>
                      {k}
                    </Txt>
                    <Lock size={12} color={T.muted} />
                  </View>
                  <View style={{ height: 6, borderRadius: 6, backgroundColor: T.surface2 }} />
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: `${T.rose}66`, backgroundColor: `${T.rose}1A` }}>
                <Lock size={13} color={T.rose} />
                <Txt w={700} size={12.5} color={T.rose}>
                  See all 7 dimensions with MATCH+
                </Txt>
              </View>
            </Pressable>
          ) : null}
          <Txt w={700} size={13.5} style={{ marginTop: 18, marginBottom: 8 }}>
            Why you match
          </Txt>
          {(full ? profile.why : profile.why.slice(0, 1)).map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginVertical: 4 }}>
              <Check size={15} color={T.mint} style={{ marginTop: 1 }} />
              <Txt size={13} style={{ flex: 1 }}>
                {w}
              </Txt>
            </View>
          ))}
          {full ? (
            <>
              <Txt w={700} size={13.5} style={{ marginTop: 16, marginBottom: 8 }}>
                Potential differences
              </Txt>
              {profile.diffs.map((d, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginVertical: 4 }}>
                  <Txt size={13} color={T.muted}>
                    •
                  </Txt>
                  <Txt size={13} color={T.muted} style={{ flex: 1 }}>
                    {d}
                  </Txt>
                </View>
              ))}
            </>
          ) : (
            <Pressable onPress={unlock} style={{ flexDirection: 'row', gap: 8, marginVertical: 4, opacity: 0.6 }}>
              <Lock size={14} color={T.muted} style={{ marginTop: 2 }} />
              <Txt size={13} color={T.muted} style={{ flex: 1 }}>
                {Math.max(0, profile.why.length - 1) + profile.diffs.length} more insights & potential differences — MATCH+
              </Txt>
            </Pressable>
          )}
          <PrimaryButton label="Close" onPress={onClose} style={{ marginTop: 20 }} />
        </>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------ filters ------------------------------ */
/**
 * Basic (all tiers): distance + age range, coarse steps (5 km / age brackets).
 * MATCH+: 1 km / 1-year precision, verified-only, intention. The server
 * (get_discover_deck) ignores verified/intention for free accounts.
 */
export type Filters = { maxDistance: number; verifiedOnly: boolean; intention: string | null; minAge: number | null; maxAge: number | null };
export const DEFAULT_FILTERS: Filters = { maxDistance: 50, verifiedOnly: false, intention: null, minAge: null, maxAge: null };

const AGE_BRACKETS: [string, number | null, number | null][] = [
  ['Any', null, null],
  ['18–25', 18, 25],
  ['25–35', 25, 35],
  ['35–45', 35, 45],
  ['45+', 45, null],
];

export function FiltersSheet({ visible, filters, onClose, onApply }: { visible: boolean; filters: Filters; onClose: () => void; onApply: (f: Filters) => void }) {
  const { requirePremium, tier } = useApp();
  const plus = tier !== 'free';
  const [local, setLocal] = useState(filters);
  useEffect(() => {
    if (visible) setLocal(filters);
  }, [visible, filters]);
  const minAge = local.minAge ?? 18;
  const maxAge = local.maxAge ?? 80;
  return (
    <Sheet visible={visible} onClose={onClose} title="Filters" icon={<SlidersHorizontal size={17} color={T.text} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Txt size={12.5} color={T.muted}>
          Maximum distance{plus ? '' : ' · 5 km steps'}
        </Txt>
        <Txt v="mono" size={12.5}>
          {local.maxDistance} km
        </Txt>
      </View>
      <Slider
        minimumValue={plus ? 1 : 5}
        maximumValue={100}
        step={plus ? 1 : 5}
        value={plus ? local.maxDistance : Math.max(5, Math.round(local.maxDistance / 5) * 5)}
        onValueChange={(v) => setLocal((l) => ({ ...l, maxDistance: Math.round(v) }))}
        minimumTrackTintColor={T.rose}
        maximumTrackTintColor={T.surface3}
        thumbTintColor="#fff"
        style={{ marginBottom: 14, height: 32 }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Txt w={700} size={13} color={T.muted}>
          AGE
        </Txt>
        <Txt v="mono" size={12.5}>
          {local.minAge == null && local.maxAge == null ? 'Any' : `${minAge}–${local.maxAge == null ? '80+' : maxAge}`}
        </Txt>
      </View>
      {plus ? (
        <>
          <Slider
            minimumValue={18}
            maximumValue={80}
            step={1}
            value={minAge}
            onValueChange={(v) => setLocal((l) => ({ ...l, minAge: Math.round(v), maxAge: Math.max(Math.round(v), l.maxAge ?? 80) }))}
            minimumTrackTintColor={T.surface3}
            maximumTrackTintColor={T.rose}
            thumbTintColor="#fff"
            style={{ height: 28 }}
          />
          <Slider
            minimumValue={18}
            maximumValue={80}
            step={1}
            value={maxAge}
            onValueChange={(v) => setLocal((l) => ({ ...l, maxAge: Math.round(v) >= 80 ? null : Math.round(v), minAge: Math.min(Math.round(v), l.minAge ?? 18) }))}
            minimumTrackTintColor={T.rose}
            maximumTrackTintColor={T.surface3}
            thumbTintColor="#fff"
            style={{ marginBottom: 14, height: 28 }}
          />
        </>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          {AGE_BRACKETS.map(([label, lo, hi]) => (
            <Chip key={label} label={label} active={local.minAge === lo && local.maxAge === hi} onPress={() => setLocal((l) => ({ ...l, minAge: lo, maxAge: hi }))} />
          ))}
        </View>
      )}
      {!plus ? (
        <Pressable onPress={() => requirePremium('match_plus', 'Exact age & distance are part of MATCH+')} style={{ marginBottom: 14 }}>
          <Txt size={11.5} color={T.amber}>
            🔒 Exact age & 1 km precision with MATCH+
          </Txt>
        </Pressable>
      ) : null}
      <Txt w={700} size={13} color={T.muted} style={{ marginBottom: 8 }}>
        LOOKING FOR{plus ? '' : ' (MATCH+)'}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <Chip label="Any" active={!local.intention} onPress={() => setLocal((l) => ({ ...l, intention: null }))} />
        {INTENTIONS.map((i) => (
          <Chip
            key={i.code}
            label={i.label}
            active={local.intention === i.code}
            onPress={() => {
              if (!requirePremium('match_plus', 'Intention filters are part of MATCH+')) return;
              setLocal((l) => ({ ...l, intention: i.code }));
            }}
          />
        ))}
      </View>
      <SettingRow
        icon={<BadgeCheck size={16} color={T.text} />}
        label={plus ? 'Verified profiles only' : 'Verified profiles only (MATCH+)'}
        active={local.verifiedOnly}
        onPress={() => {
          if (!local.verifiedOnly && !requirePremium('match_plus', 'Verified-only filter is part of MATCH+')) return;
          setLocal((l) => ({ ...l, verifiedOnly: !l.verifiedOnly }));
        }}
      />
      <PrimaryButton label="Apply filters" onPress={() => onApply(local)} style={{ marginTop: 20 }} />
    </Sheet>
  );
}

/* ------------------------------ safety (block / report) ------------------------------ */
const REPORT_LABEL: Record<ReportCategory, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  inappropriate: 'Inappropriate content',
  fake_profile: 'Fake profile',
  other: 'Other',
};

export function SafetySheet({
  person,
  onClose,
  onBlock,
  onReport,
}: {
  person: { name: string } | null;
  onClose: () => void;
  onBlock: () => Promise<void>;
  onReport: (category: ReportCategory, details: string) => Promise<void>;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!person) {
      setCategory(null);
      setDetails('');
    }
  }, [person]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!person} onClose={onClose} scrim={T.scrimDeep} title={person ? `Safety · ${person.name}` : ''} icon={<Shield size={17} color={T.mint} />}>
      <Txt size={12.5} color={T.muted} style={{ marginTop: -8, marginBottom: 14 }}>
        Blocking hides you from each other everywhere. Reports go to our safety team.
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {REPORT_CATEGORIES.map((c) => (
          <Chip key={c} label={REPORT_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      <TextInput
        value={details}
        onChangeText={setDetails}
        placeholder="Tell us what happened… (optional)"
        placeholderTextColor={T.mutedDim}
        multiline
        style={[inputStyle, { fontSize: 13.5, minHeight: 90, textAlignVertical: 'top', borderRadius: 14, marginBottom: 16 }]}
      />
      <PrimaryButton label="Submit report" disabled={!category} loading={busy} onPress={() => category && run(() => onReport(category, details))} />
      <Pressable onPress={() => run(onBlock)} disabled={busy} style={{ marginTop: 12, paddingVertical: 14, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2, alignItems: 'center' }}>
        <Txt w={700} size={14} color={T.rose}>
          Block {person?.name}
        </Txt>
      </Pressable>
    </Sheet>
  );
}

/* ------------------------------ map ------------------------------ */
const NICE_RADII = [2, 3, 5, 8, 10, 15, 25, 40, 50];
const MAP_SPAN = 44; // % of the half-width used for the radius

/**
 * Approximate map. Positions come only from server RPCs (get_map_people /
 * get_events) as jittered km offsets from MY ~1.5 km cell — never coordinates.
 * People are drawn as fuzzy rings, events as pins.
 */
export function MapView({ profiles, onLike, height }: { profiles: Person[]; onLike: (p: Person) => void; height: number }) {
  const router = useRouter();
  const { toast } = useApp();
  const [layer, setLayer] = useState<'people' | 'events'>('people');
  const [status, setStatus] = useState<'loading' | 'off' | 'on'>('loading');
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<EventDetail[]>([]);
  const [selPerson, setSelPerson] = useState<MapPerson | null>(null);
  const [selEvent, setSelEvent] = useState<EventDetail | null>(null);
  const [sharing, setSharing] = useState(false);
  const [w, setW] = useState(340);

  const load = useCallback(async () => {
    const st = await getLocationStatus().catch(() => ({ hasLocation: false, updatedAt: null }));
    if (!st.hasLocation) {
      setStatus('off');
      return;
    }
    setStatus('on');
    const [ppl, evs] = await Promise.all([
      fetchMapPeople(25, 40).catch(() => [] as MapPerson[]),
      fetchEvents({ scope: 'upcoming', limit: 60 }).catch(() => [] as EventDetail[]),
    ]);
    setPeople(ppl);
    setEvents(evs.filter((e) => e.status === 'scheduled' && e.dx_km != null && e.dy_km != null && (e.distance_km ?? 0) <= 50));
    if (ppl.length) setPhotos(await fetchPrimaryPhotos(ppl.map((p) => p.id)).catch(() => ({})));
  }, []);

  useEffect(() => {
    void refreshLocationIfOptedIn().finally(() => void load());
  }, [load]);

  const share = async () => {
    setSharing(true);
    try {
      const res = await shareApproximateLocation();
      if (res === 'shared') {
        toast('Approximate location on (≈1.5 km) 📍');
        await load();
      } else toast(res === 'denied' ? 'Location permission is off — enable it in Settings' : 'Could not get your location');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not share location');
    } finally {
      setSharing(false);
    }
  };

  const items = layer === 'people' ? people.map((p) => [p.dx_km, p.dy_km]) : events.map((e) => [e.dx_km ?? 0, e.dy_km ?? 0]);
  const far = items.reduce((m, [dx, dy]) => Math.max(m, Math.abs(dx), Math.abs(dy)), 0) * 1.15;
  const radius = NICE_RADII.find((r) => r >= far) ?? 50;
  const pos = (dx: number, dy: number) => ({
    left: `${50 + Math.max(-1, Math.min(1, dx / radius)) * MAP_SPAN}%` as const,
    top: `${50 - Math.max(-1, Math.min(1, dy / radius)) * MAP_SPAN}%` as const,
  });
  // ~1.5 km cell + jitter → draw each person as a fuzzy area, never a dot
  const ringPx = Math.max(46, Math.min(120, ((2 * 1.3) / radius) * ((w / 2) * (MAP_SPAN / 50))));
  const deckPerson = selPerson ? profiles.find((p) => p.id === selPerson.id) : undefined;
  const selAge = selPerson ? ageFromBirthDate(selPerson.birth_date) : null;

  return (
    <View style={{ marginTop: 4, flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {(
          [
            ['people', '👤 People'],
            ['events', '🎉 Events'],
          ] as const
        ).map(([k, l]) => (
          <Pressable
            key={k}
            onPress={() => {
              setLayer(k);
              setSelPerson(null);
              setSelEvent(null);
            }}
            style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: layer === k ? T.rose : T.border, backgroundColor: layer === k ? `${T.rose}22` : T.surface2 }}>
            <Txt w={600} size={12.5} color={layer === k ? '#fff' : T.muted}>
              {l}
            </Txt>
          </Pressable>
        ))}
      </View>

      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: T.border }}>
        <LinearGradient colors={['#221C2E', '#17131F']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ position: 'absolute', inset: 0 }} />
        <View style={{ position: 'absolute', left: '15%', top: '5%', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,85,115,0.07)' }} />
        <View style={{ position: 'absolute', left: '55%', top: '50%', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(139,107,255,0.09)' }} />
        {/* decorative street grid */}
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(i + 1) * 12.5}%`, height: 1, backgroundColor: 'rgba(255,255,255,0.035)' }} />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i + 1) * 14}%`, width: 1, backgroundColor: 'rgba(255,255,255,0.035)' }} />
        ))}

        {/* approximate-location rings around "you" — never an exact pin */}
        <View style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' }}>
          {[110, 75, 40].map((sz, i) => (
            <View key={sz} style={{ position: 'absolute', width: sz, height: sz, borderRadius: sz / 2, borderWidth: 1, borderColor: `${T.rose}55`, backgroundColor: i === 2 ? `${T.rose}22` : 'transparent' }} />
          ))}
          <View style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: T.rose, borderWidth: 2, borderColor: T.ink }} />
          <View style={{ position: 'absolute', top: 14, width: 140, alignItems: 'center' }}>
            <Txt v="mono" size={10} color={T.muted}>
              YOU (approximate)
            </Txt>
          </View>
        </View>

        {status === 'on' && layer === 'people'
          ? people.map((p) => {
              const at = pos(p.dx_km, p.dy_km);
              const sel = selPerson?.id === p.id;
              return (
                <Pressable key={p.id} onPress={() => setSelPerson(p)} style={{ position: 'absolute', left: at.left, top: at.top, width: ringPx, height: ringPx, marginLeft: -ringPx / 2, marginTop: -ringPx / 2, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', width: ringPx, height: ringPx, borderRadius: ringPx / 2, borderWidth: 1, borderColor: sel ? `${T.amber}AA` : `${T.rose}66`, backgroundColor: sel ? `${T.amber}1F` : `${T.rose}14` }} />
                  <View style={{ width: 34, height: 34, borderRadius: 17, overflow: 'hidden', borderWidth: 2, borderColor: sel ? T.amber : T.rose, opacity: 0.95 }}>
                    <Avatar uri={photos[p.id]} name={p.name} size={30} />
                  </View>
                </Pressable>
              );
            })
          : null}
        {status === 'on' && layer === 'events'
          ? events.map((e) => {
              const at = pos(e.dx_km ?? 0, e.dy_km ?? 0);
              return (
                <Pressable key={e.id} onPress={() => setSelEvent(e)} style={{ position: 'absolute', left: at.left, top: at.top, marginLeft: -15, marginTop: -34 }}>
                  <View style={{ width: 30, height: 30, borderTopLeftRadius: 15, borderTopRightRadius: 15, borderBottomRightRadius: 15, borderBottomLeftRadius: 0, transform: [{ rotate: '-45deg' }], backgroundColor: selEvent?.id === e.id ? T.amber : T.violet, borderWidth: 2, borderColor: T.ink, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ transform: [{ rotate: '45deg' }] }}>
                      <Calendar size={13} color="#fff" />
                    </View>
                  </View>
                </Pressable>
              );
            })
          : null}

        {status === 'on' ? (
          <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.chipDark, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <View style={{ width: 18, height: 1.5, backgroundColor: T.muted }} />
            <Txt v="mono" size={10} color={T.muted}>
              {radius} km radius
            </Txt>
          </View>
        ) : null}
        {status === 'on' && !(layer === 'people' ? people.length : events.length) ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' }}>
            <View style={{ backgroundColor: T.chipDark, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
              <Txt size={11.5} color={T.muted}>
                {layer === 'people' ? 'No one sharing their area nearby yet' : 'No pinned events nearby yet'}
              </Txt>
            </View>
          </View>
        ) : null}
        {status === 'off' ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(21,18,28,0.55)' }}>
            <View style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 20, padding: 18, alignItems: 'center', gap: 8, maxWidth: 300 }}>
              <MapPin size={22} color={T.rose} />
              <Txt w={700} size={15} center>
                See who's around
              </Txt>
              <Txt size={12.5} color={T.muted} center lh={1.4}>
                Share your approximate location to see people & events near you. Only a ~1.5 km area is stored — never your exact spot.
              </Txt>
              <PrimaryButton small label="Share approximate location" onPress={share} loading={sharing} style={{ marginTop: 6 }} />
            </View>
          </View>
        ) : null}

        {selPerson || selEvent ? (
          <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {selPerson ? (
              <>
                <Photo uri={photos[selPerson.id]} name={selPerson.name} style={{ width: 52, height: 52, borderRadius: 14 }} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} size={13.5}>
                    {selPerson.name}
                    {selAge ? `, ${selAge}` : ''}
                  </Txt>
                  <Txt size={11.5} color={T.muted} style={{ marginTop: 2 }}>
                    ~{selPerson.distance_km} km away
                    {deckPerson ? ` · ${deckPerson.match}% match` : ''}
                  </Txt>
                </View>
                {deckPerson ? (
                  <Pressable
                    onPress={() => {
                      onLike(deckPerson);
                      setSelPerson(null);
                    }}>
                    <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
                      <Heart size={17} color="#fff" />
                    </LinearGradient>
                  </Pressable>
                ) : null}
              </>
            ) : selEvent ? (
              <Pressable style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' }} onPress={() => router.push({ pathname: '/event/[eventId]', params: { eventId: selEvent.id } })}>
                <Photo uri={selEvent.cover_url} name={selEvent.title} style={{ width: 52, height: 52, borderRadius: 14 }} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} size={13.5} numberOfLines={1}>
                    {selEvent.title}
                  </Txt>
                  <Txt size={11.5} color={T.muted} style={{ marginTop: 2 }} numberOfLines={1}>
                    {fmtEventDate(selEvent.starts_at)}
                    {selEvent.distance_km != null ? ` · ~${selEvent.distance_km} km` : ''}
                    {selEvent.going_count ? ` · ${selEvent.going_count} going` : ''}
                  </Txt>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={8}
              onPress={() => {
                setSelPerson(null);
                setSelEvent(null);
              }}>
              <X size={16} color={T.mutedDim} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Shield size={12} color={T.mutedDim} />
        <Txt size={11} color={T.mutedDim}>
          Exact locations are never shown — only approximate distance.
        </Txt>
      </View>
    </View>
  );
}
