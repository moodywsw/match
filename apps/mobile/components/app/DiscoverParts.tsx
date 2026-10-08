import Slider from '@react-native-community/slider';
import { BadgeCheck, Calendar, Check, Heart, Shield, SlidersHorizontal, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, MatchRing, Photo, PrimaryButton, SettingRow } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { INTENTIONS, pseudoPos, type EventItem, type Person } from '@/lib/mock';
import { REPORT_CATEGORIES, type ReportCategory } from '@/lib/safety';

import { inputStyle } from './AuthForm';
import { LinearGradient } from 'expo-linear-gradient';

/* ------------------------------ compatibility ------------------------------ */
export function CompatibilitySheet({ profile, onClose }: { profile: Person | null; onClose: () => void }) {
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
          {Object.entries(profile.breakdown).map(([k, v]) => (
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
          <Txt w={700} size={13.5} style={{ marginTop: 18, marginBottom: 8 }}>
            Why you match
          </Txt>
          {profile.why.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginVertical: 4 }}>
              <Check size={15} color={T.mint} style={{ marginTop: 1 }} />
              <Txt size={13} style={{ flex: 1 }}>
                {w}
              </Txt>
            </View>
          ))}
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
          <PrimaryButton label="Close" onPress={onClose} style={{ marginTop: 20 }} />
        </>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------ filters ------------------------------ */
export type Filters = { maxDistance: number; verifiedOnly: boolean; intention: string | null };

export function FiltersSheet({ visible, filters, onClose, onApply }: { visible: boolean; filters: Filters; onClose: () => void; onApply: (f: Filters) => void }) {
  const { requirePremium, tier } = useApp();
  const [local, setLocal] = useState(filters);
  useEffect(() => {
    if (visible) setLocal(filters);
  }, [visible, filters]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Filters" icon={<SlidersHorizontal size={17} color={T.text} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Txt size={12.5} color={T.muted}>
          Maximum distance
        </Txt>
        <Txt v="mono" size={12.5}>
          {local.maxDistance} km
        </Txt>
      </View>
      <Slider
        minimumValue={1}
        maximumValue={15}
        step={1}
        value={local.maxDistance}
        onValueChange={(v) => setLocal((l) => ({ ...l, maxDistance: Math.round(v) }))}
        minimumTrackTintColor={T.rose}
        maximumTrackTintColor={T.surface3}
        thumbTintColor="#fff"
        style={{ marginBottom: 18, height: 32 }}
      />
      <Txt w={700} size={13} color={T.muted} style={{ marginBottom: 8 }}>
        LOOKING FOR
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
        label={tier === 'free' ? 'Verified profiles only (MATCH+)' : 'Verified profiles only'}
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
export function MapView({ profiles, events, onLike, height }: { profiles: Person[]; events: EventItem[]; onLike: (p: Person) => void; height: number }) {
  const [layer, setLayer] = useState<'people' | 'events'>('people');
  const [selPerson, setSelPerson] = useState<Person | null>(null);
  const [selEvent, setSelEvent] = useState<EventItem | null>(null);
  const people = profiles.slice(0, 12);

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

      <View style={{ height, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: T.border }}>
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
          {[110, 75, 40].map((s, i) => (
            <View key={s} style={{ position: 'absolute', width: s, height: s, borderRadius: s / 2, borderWidth: 1, borderColor: `${T.rose}55`, backgroundColor: i === 2 ? `${T.rose}22` : 'transparent' }} />
          ))}
          <View style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: T.rose, borderWidth: 2, borderColor: T.ink }} />
          <View style={{ position: 'absolute', top: 14, width: 140, alignItems: 'center' }}>
            <Txt v="mono" size={10} color={T.muted}>
              YOU (approximate)
            </Txt>
          </View>
        </View>

        {layer === 'people'
          ? people.map((p) => {
              const pos = pseudoPos(p.id);
              return (
                <Pressable key={p.id} onPress={() => setSelPerson(p)} style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, marginLeft: -19, marginTop: -19 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, overflow: 'hidden', borderWidth: 2, borderColor: selPerson?.id === p.id ? T.amber : T.rose, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 5 }}>
                    <Avatar uri={p.photo} name={p.name} size={34} />
                  </View>
                </Pressable>
              );
            })
          : events.map((e) => {
              const pos = pseudoPos(e.id, 40);
              return (
                <Pressable key={e.id} onPress={() => setSelEvent(e)} style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, marginLeft: -15, marginTop: -34 }}>
                  <View style={{ width: 30, height: 30, borderTopLeftRadius: 15, borderTopRightRadius: 15, borderBottomRightRadius: 15, borderBottomLeftRadius: 0, transform: [{ rotate: '-45deg' }], backgroundColor: T.violet, borderWidth: 2, borderColor: T.ink, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ transform: [{ rotate: '45deg' }] }}>
                      <Calendar size={13} color="#fff" />
                    </View>
                  </View>
                </Pressable>
              );
            })}

        {selPerson || selEvent ? (
          <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {selPerson ? (
              <>
                <Photo uri={selPerson.photo} name={selPerson.name} style={{ width: 52, height: 52, borderRadius: 14 }} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} size={13.5}>
                    {selPerson.name}
                    {selPerson.age ? `, ${selPerson.age}` : ''}
                  </Txt>
                  <Txt size={11.5} color={T.muted} style={{ marginTop: 2 }}>
                    {selPerson.distance != null ? `~${selPerson.distance} km away · ` : ''}
                    {selPerson.match}% match
                  </Txt>
                </View>
                <Pressable
                  onPress={() => {
                    onLike(selPerson);
                    setSelPerson(null);
                  }}>
                  <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
                    <Heart size={17} color="#fff" />
                  </LinearGradient>
                </Pressable>
              </>
            ) : selEvent ? (
              <>
                <Photo uri={selEvent.cover} name={selEvent.title} style={{ width: 52, height: 52, borderRadius: 14 }} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} size={13.5}>
                    {selEvent.title}
                  </Txt>
                  <Txt size={11.5} color={T.muted} style={{ marginTop: 2 }}>
                    {selEvent.date}
                    {selEvent.going ? ` · ${selEvent.going} going` : ''}
                  </Txt>
                </View>
              </>
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
