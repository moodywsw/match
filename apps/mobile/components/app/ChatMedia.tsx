import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { Pause, Play, Send, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { chatMediaUrl } from '@/lib/chat';

export const WAVE_BARS = 28;

export function fmtDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Prototype waveform (deterministic) when a voice note carries no samples. */
const FALLBACK_WAVE = Array.from({ length: 16 }, (_, bi) => (4 + ((bi * 7) % 14)) / 18);

function useChatMediaUrl(path: string | null | undefined, localUri?: string | null) {
  const [url, setUrl] = useState<string | null>(localUri ?? null);
  useEffect(() => {
    if (localUri || !path) return;
    let alive = true;
    chatMediaUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, localUri]);
  return url;
}

/* ------------------------------ image ------------------------------ */
export function ImageBubble({ path, uri, mine, pending }: { path?: string | null; uri?: string | null; mine: boolean; pending?: boolean }) {
  const url = useChatMediaUrl(path, uri);
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <>
      <Pressable onPress={() => url && setOpen(true)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 180, height: 180, borderRadius: 16, overflow: 'hidden', backgroundColor: T.surface3, alignItems: 'center', justifyContent: 'center' }}>
          {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          {!url || pending ? <ActivityIndicator color={T.text} /> : null}
          {pending && url ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} /> : null}
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(10,8,14,0.96)', justifyContent: 'center' }}>
          {url ? <Image source={{ uri: url }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <View style={{ position: 'absolute', top: insets.top + 12, right: 18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/* ------------------------------ voice ------------------------------ */
function Wave({ samples, progress, color, height = 18 }: { samples: number[]; progress: number; color: string; height?: number }) {
  const n = samples.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height }}>
      {samples.map((v, i) => (
        <View
          key={i}
          style={{
            width: 2,
            height: Math.max(3, Math.round(4 + v * (height - 4))),
            backgroundColor: color,
            opacity: n && i / n < progress ? 1 : 0.55,
            borderRadius: 2,
          }}
        />
      ))}
    </View>
  );
}

function VoiceShell({ mine, children }: { mine: boolean; children: ReactNode }) {
  const radius = { borderRadius: 18, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4 };
  const style = [{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 10, paddingHorizontal: 14 }, radius];
  return mine ? (
    <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ alignSelf: 'flex-end' }, ...style]}>
      {children}
    </LinearGradient>
  ) : (
    <View style={[{ alignSelf: 'flex-start', backgroundColor: T.surface2 }, ...style]}>{children}</View>
  );
}

/** Demo-only bubble (prototype look, no audio). */
export function StaticVoiceBubble({ mine, duration }: { mine: boolean; duration: string }) {
  const color = mine ? '#fff' : T.text;
  return (
    <VoiceShell mine={mine}>
      <View style={styles.playDot}>
        <Play size={12} color={color} fill={color} />
      </View>
      <Wave samples={FALLBACK_WAVE} progress={0} color={color} />
      <Txt v="mono" size={10.5} color={color} style={{ opacity: 0.85 }}>
        {duration}
      </Txt>
    </VoiceShell>
  );
}

export function VoiceBubble({
  path,
  uri,
  mine,
  durationMs,
  waveform,
  pending,
}: {
  path?: string | null;
  uri?: string | null;
  mine: boolean;
  durationMs?: number | null;
  waveform?: number[] | null;
  pending?: boolean;
}) {
  const url = useChatMediaUrl(path, uri);
  const player = useAudioPlayer(url ? { uri: url } : null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const color = mine ? '#fff' : T.text;
  const totalMs = durationMs || (status.duration ? status.duration * 1000 : 0);
  const progress = totalMs ? Math.min(1, (status.currentTime * 1000) / totalMs) : 0;

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const toggle = async () => {
    if (!url) return;
    if (status.playing) {
      player.pause();
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    if (totalMs && status.currentTime * 1000 >= totalMs - 150) await player.seekTo(0);
    player.play();
  };

  const samples = waveform?.length ? waveform : FALLBACK_WAVE;
  return (
    <Pressable onPress={toggle} disabled={!url || pending}>
      <VoiceShell mine={mine}>
        <View style={styles.playDot}>
          {!url || pending ? (
            <ActivityIndicator size="small" color={color} />
          ) : status.playing ? (
            <Pause size={12} color={color} fill={color} />
          ) : (
            <Play size={12} color={color} fill={color} />
          )}
        </View>
        <Wave samples={samples} progress={progress} color={color} />
        <Txt v="mono" size={10.5} color={color} style={{ opacity: 0.85 }}>
          {status.playing || status.currentTime > 0 ? fmtDuration(status.currentTime * 1000) : fmtDuration(totalMs)}
        </Txt>
      </VoiceShell>
    </Pressable>
  );
}

/* ------------------------------ recorder ------------------------------ */
export type VoiceClip = { uri: string; durationMs: number; waveform: number[] };

function downsample(values: number[], n: number): number[] {
  if (!values.length) return Array.from({ length: n }, () => 0.15);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * values.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / n));
    const slice = values.slice(start, end);
    out.push(Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100);
  }
  return out;
}

const MAX_MS = 120_000;

export function useVoiceRecorder() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  activeRef.current = active;
  const levels = useRef<number[]>([]);

  useEffect(() => {
    if (!active || !state.isRecording) return;
    const db = state.metering ?? -60;
    levels.current.push(Math.max(0.05, Math.min(1, (db + 55) / 55)));
  }, [state.durationMillis, state.metering, state.isRecording, active]);

  const start = useCallback(async (): Promise<boolean> => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return false;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    levels.current = [];
    await recorder.prepareToRecordAsync();
    recorder.record();
    setActive(true);
    return true;
  }, [recorder]);

  const stop = useCallback(async (): Promise<VoiceClip | null> => {
    const durationMs = recorder.getStatus().durationMillis || state.durationMillis;
    await recorder.stop();
    setActive(false);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (!uri || durationMs < 600) return null;
    return { uri, durationMs, waveform: downsample(levels.current, WAVE_BARS) };
  }, [recorder, state.durationMillis]);

  const cancel = useCallback(async () => {
    if (!activeRef.current) return;
    try {
      await recorder.stop();
    } catch {
      /* not recording */
    }
    setActive(false);
    levels.current = [];
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }, [recorder]);

  return { active, durationMs: state.durationMillis, levels: levels.current, start, stop, cancel, maxReached: state.durationMillis >= MAX_MS };
}

function RecDot() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: T.rose, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }} />;
}

/** Replaces the composer while recording: ● 0:07 ▁▃▅▂… [trash] [send]. */
export function RecordingBar({ durationMs, levels, onCancel, onSend, sending }: { durationMs: number; levels: number[]; onCancel: () => void; onSend: () => void; sending: boolean }) {
  const recent = levels.slice(-WAVE_BARS);
  const padded = [...Array.from({ length: Math.max(0, WAVE_BARS - recent.length) }, () => 0.08), ...recent];
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flex: 1 }}>
      <Pressable onPress={onCancel} disabled={sending} style={styles.iconBtn}>
        <Trash2 size={16} color={T.text} />
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: `${T.rose}66`, backgroundColor: T.surface2 }}>
        <RecDot />
        <Txt v="mono" size={12} color={T.text}>
          {fmtDuration(durationMs)}
        </Txt>
        <View style={{ flex: 1, overflow: 'hidden', alignItems: 'flex-end' }}>
          <Wave samples={padded} progress={1} color={T.rose} />
        </View>
      </View>
      <Pressable onPress={onSend} disabled={sending} style={{ opacity: sending ? 0.6 : 1 }}>
        <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Send size={16} color="#fff" />}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  playDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' },
});
