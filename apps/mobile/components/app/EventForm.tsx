import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Calendar, Camera, MapPin, Users, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Chip, Photo, PrimaryButton, Toggle } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  createEvent,
  EVENT_CATEGORIES,
  eventErrorMessage,
  fmtEventDate,
  updateEvent,
  type EventCategory,
  type EventDetail,
} from '@/lib/events';

import { inputStyle } from './AuthForm';

/** Remember the last city typed in this session as the default for the next event. */
let lastCity = '';

const DURATIONS: [string, number | null][] = [
  ['No end time', null],
  ['2 h', 2],
  ['3 h', 3],
  ['5 h', 5],
  ['All day', 10],
];

function defaultStart() {
  const d = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  d.setHours(20, 0, 0, 0);
  return d;
}

const field = { ...inputStyle, paddingVertical: 13, fontSize: 15 };
const Label = ({ children }: { children: string }) => (
  <Txt w={600} size={12.5} color={T.muted} style={{ marginTop: 14, marginBottom: 6 }}>
    {children}
  </Txt>
);

/** Create / edit an event (prototype styling: Sheet + Chips + dark inputs). */
export function EventFormSheet({
  visible,
  event,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** null = create */
  event: EventDetail | null;
  onClose: () => void;
  onSaved: (eventId: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<EventCategory>('Nightlife');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState<Date>(defaultStart);
  const [durationH, setDurationH] = useState<number | null>(3);
  const [capacity, setCapacity] = useState('');
  const [cover, setCover] = useState<{ uri: string; mimeType: string } | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [pinNearMe, setPinNearMe] = useState(false);
  const [iosPicker, setIosPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCover(null);
    setIosPicker(false);
    if (event) {
      setTitle(event.title);
      setDescription(event.description || '');
      setCategory((EVENT_CATEGORIES as readonly string[]).includes(event.category || '') ? (event.category as EventCategory) : 'Other');
      setCity(event.city || '');
      setArea(event.area || '');
      setLocation(event.location || '');
      setStartsAt(new Date(event.starts_at));
      setDurationH(event.ends_at ? Math.round((new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()) / 3600000) : null);
      setCapacity(event.capacity ? String(event.capacity) : '');
      setCoverUrl(event.cover_url);
      setPinNearMe(event.has_location);
    } else {
      setTitle('');
      setDescription('');
      setCategory('Nightlife');
      setCity(lastCity);
      setArea('');
      setLocation('');
      setStartsAt(defaultStart());
      setDurationH(3);
      setCapacity('');
      setCoverUrl(null);
      setPinNearMe(false);
    }
  }, [visible, event]);

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast('Allow photo access to add a cover');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset) return;
    try {
      const ctx = ImageManipulator.manipulate(asset.uri);
      if ((asset.width || 0) > 1400) ctx.resize({ width: 1400 });
      const ref = await ctx.renderAsync();
      const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
      setCover({ uri: saved.uri, mimeType: 'image/jpeg' });
    } catch {
      setCover({ uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' });
    }
  };

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: startsAt,
        mode: 'date',
        minimumDate: new Date(),
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type !== 'set' || !d) return;
          const day = new Date(d);
          DateTimePickerAndroid.open({
            value: startsAt,
            mode: 'time',
            is24Hour: true,
            onChange: (e2: DateTimePickerEvent, t?: Date) => {
              if (e2.type !== 'set' || !t) return;
              const next = new Date(day);
              next.setHours(t.getHours(), t.getMinutes(), 0, 0);
              setStartsAt(next);
            },
          });
        },
      });
    } else {
      setIosPicker((v) => !v);
    }
  };

  const save = async () => {
    if (!user?.id) return;
    const t = title.trim();
    if (t.length < 3) return toast('Give your event a title (3+ characters)');
    if (startsAt.getTime() < Date.now() + 5 * 60 * 1000) return toast('Pick a start time in the future');
    const cap = capacity.trim() ? parseInt(capacity, 10) : null;
    if (cap != null && (!Number.isFinite(cap) || cap < 2 || cap > 5000)) return toast('Capacity must be between 2 and 5000');
    if (!city.trim()) return toast('Add the city');
    setSaving(true);
    lastCity = city.trim();
    try {
      const input = {
        title: t,
        description,
        category,
        city,
        area,
        location,
        startsAt,
        endsAt: durationH ? new Date(startsAt.getTime() + durationH * 3600 * 1000) : null,
        capacity: cap,
        coverLocal: cover,
        coverUrl: cover ? undefined : coverUrl,
        coverPath: cover ? undefined : coverUrl ? undefined : null,
        pinNearMe,
        keepPin: !!event?.has_location && pinNearMe,
      };
      if (event) {
        if (!cover && coverUrl === event.cover_url) delete (input as { coverUrl?: string | null }).coverUrl;
        await updateEvent(user.id, event.id, input);
        toast('Event updated — attendees were notified');
        onSaved(event.id);
      } else {
        const id = await createEvent(user.id, input);
        toast('Event created 🎉');
        onSaved(id);
      }
    } catch (err) {
      toast(eventErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const shownCover = cover?.uri ?? coverUrl;

  return (
    <Sheet visible={visible} onClose={onClose} title={event ? 'Edit event' : 'Create an event'} icon={<Calendar size={18} color={T.rose} />} maxHeight="92%">
      <Pressable onPress={pickCover} style={{ height: 130, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' }}>
        {shownCover ? (
          <>
            <Photo uri={shownCover} name={title} style={{ position: 'absolute', inset: 0 }} />
            <Pressable
              hitSlop={8}
              onPress={() => {
                setCover(null);
                setCoverUrl(null);
              }}
              style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: T.chipDark, alignItems: 'center', justifyContent: 'center' }}>
              <X size={14} color="#fff" />
            </Pressable>
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Camera size={22} color={T.muted} />
            <Txt size={12.5} color={T.muted}>
              Add a cover image
            </Txt>
          </View>
        )}
      </Pressable>

      <Label>Title</Label>
      <TextInput value={title} onChangeText={setTitle} placeholder="Rooftop Sunset Mixer" placeholderTextColor={T.mutedDim} maxLength={80} style={field} />

      <Label>Category</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {EVENT_CATEGORIES.map((c) => (
          <Chip key={c} small label={c} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>

      <Label>Date & time</Label>
      <Pressable onPress={openPicker} style={[field, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <Calendar size={16} color={T.muted} />
        <Txt size={15}>{fmtEventDate(startsAt.toISOString(), durationH ? new Date(startsAt.getTime() + durationH * 3600000).toISOString() : null)}</Txt>
      </Pressable>
      {iosPicker && Platform.OS === 'ios' ? (
        <DateTimePicker
          value={startsAt}
          mode="datetime"
          display="spinner"
          minimumDate={new Date()}
          minuteInterval={5}
          themeVariant="dark"
          onChange={(_e, d) => d && setStartsAt(d)}
        />
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {DURATIONS.map(([l, h]) => (
          <Chip key={l} small label={l} active={durationH === h} onPress={() => setDurationH(h)} />
        ))}
      </View>

      <Label>Where</Label>
      <View style={{ gap: 8 }}>
        <TextInput value={city} onChangeText={setCity} placeholder="City (e.g. Lisbon)" placeholderTextColor={T.mutedDim} maxLength={60} style={field} />
        <TextInput value={area} onChangeText={setArea} placeholder="Area / neighbourhood (e.g. Cais do Sodré)" placeholderTextColor={T.mutedDim} maxLength={80} style={field} />
        <TextInput value={location} onChangeText={setLocation} placeholder="Venue or meeting point (optional)" placeholderTextColor={T.mutedDim} maxLength={120} style={field} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border }}>
        <MapPin size={16} color={T.violet} />
        <View style={{ flex: 1 }}>
          <Txt size={13.5}>Show on the map near me</Txt>
          <Txt size={11} color={T.muted} style={{ marginTop: 2 }}>
            Uses your current position, rounded to ~1.5 km. Never shown exactly.
          </Txt>
        </View>
        <Toggle active={pinNearMe} onPress={() => setPinNearMe((v) => !v)} />
      </View>

      <Label>Capacity (optional)</Label>
      <View style={[field, { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 0 }]}>
        <Users size={16} color={T.muted} />
        <TextInput value={capacity} onChangeText={(v) => setCapacity(v.replace(/[^0-9]/g, ''))} placeholder="Unlimited" placeholderTextColor={T.mutedDim} keyboardType="number-pad" maxLength={4} style={{ flex: 1, color: T.text, fontSize: 15, paddingVertical: 13 }} />
      </View>

      <Label>Description (optional)</Label>
      <TextInput value={description} onChangeText={setDescription} placeholder="What's the plan? Dress code, what to bring…" placeholderTextColor={T.mutedDim} maxLength={1000} multiline style={[field, { minHeight: 90, textAlignVertical: 'top' }]} />

      <PrimaryButton label={event ? 'Save changes' : 'Create event'} onPress={save} loading={saving} style={{ marginTop: 20 }} />
    </Sheet>
  );
}
