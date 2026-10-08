import { LinearGradient } from 'expo-linear-gradient';
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadLiveKit, type LK } from '@/components/app/LiveVideo';
import { Avatar, Backdrop, PrimaryButton, RadialBlob, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import type { ActiveCall, UnsupportedCall } from '@/contexts/CallContext';
import { callDurationLabel, fetchCallToken } from '@/lib/calls';

/**
 * Full-screen call UI: incoming (accept / decline), ringing, in-call (remote video
 * full screen + local picture-in-picture, flip / mute / camera off / end), audio-only
 * layout, and the Expo Go state ("video calls work in the installed app").
 */

type TrackRef = {
  participant: { identity: string; isLocal: boolean };
  publication: { trackSid: string; isMuted?: boolean };
};
type Media = {
  VideoTrack: React.ComponentType<{
    trackRef: TrackRef;
    style?: object;
    objectFit?: 'cover' | 'contain';
    mirror?: boolean;
    zOrder?: number;
  }>;
  local: TrackRef | null;
  remote: TrackRef | null;
  remoteJoined: boolean;
  micOn: boolean;
  camOn: boolean;
  facing: 'user' | 'environment';
  toggleMic: () => void;
  toggleCam: () => void;
  flip: () => void;
};

type Handlers = {
  onAccept: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onMediaError: (reason: string) => void;
};

export function CallOverlay({
  active,
  unsupported,
  onCloseUnsupported,
  ...h
}: Handlers & {
  active: ActiveCall | null;
  unsupported: UnsupportedCall | null;
  onCloseUnsupported: () => void;
}) {
  const visible = !!active || !!unsupported;
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => (active ? (active.phase === 'ringing' && active.role === 'callee' ? h.onDecline() : h.onHangUp()) : onCloseUnsupported())}>
      {active ? (
        <CallView a={active} {...h} />
      ) : unsupported ? (
        <UnsupportedView u={unsupported} onClose={onCloseUnsupported} />
      ) : (
        <View style={{ flex: 1, backgroundColor: T.ink }} />
      )}
    </Modal>
  );
}

/* ------------------------------ active call ------------------------------ */

function CallView({ a, ...h }: Handlers & { a: ActiveCall }) {
  const lk = loadLiveKit();
  // Caller connects while ringing (own camera preview); callee once accepted.
  const connect = !!lk && a.phase !== 'ended' && (a.role === 'caller' || a.phase === 'in_call');
  if (connect && lk) return <CallRoom lk={lk} a={a} {...h} />;
  return <Frame a={a} media={null} {...h} />;
}

function CallRoom({ lk, a, ...h }: Handlers & { lk: LK; a: ActiveCall }) {
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const callId = a.call.id;
  const onMediaError = h.onMediaError;

  useEffect(() => {
    let cancelled = false;
    fetchCallToken(callId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setConn({ token: r.token, url: r.url });
        else onMediaError(r.reason);
      })
      .catch(() => !cancelled && onMediaError('error'));
    return () => {
      cancelled = true;
    };
  }, [callId, onMediaError]);

  const { AudioSession, LiveKitRoom } = lk.rn;
  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, [AudioSession]);

  if (!conn) return <Frame a={a} media={null} {...h} />;
  const video = a.call.kind === 'video';
  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio video={video} onError={() => onMediaError('error')}>
      <RoomInner lk={lk} a={a} {...h} />
    </LiveKitRoom>
  );
}

function RoomInner({ lk, a, ...h }: Handlers & { lk: LK; a: ActiveCall }) {
  const { useLocalParticipant, useTracks, isTrackReference, useRemoteParticipants, VideoTrack } = lk.rn;
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([lk.client.Track.Source.Camera], {
    onlySubscribed: false,
  }).filter(isTrackReference);
  const remotes = useRemoteParticipants();
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

  const local = (tracks.find((t) => t.participant.isLocal) as unknown as TrackRef) ?? null;
  const remote = (tracks.find((t) => !t.participant.isLocal) as unknown as TrackRef) ?? null;

  const media: Media = {
    VideoTrack: VideoTrack as unknown as Media['VideoTrack'],
    local,
    remote,
    remoteJoined: remotes.length > 0,
    micOn: isMicrophoneEnabled,
    camOn: isCameraEnabled,
    facing,
    toggleMic: () => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled),
    toggleCam: () => void localParticipant.setCameraEnabled(!isCameraEnabled),
    flip: () => {
      const next = facing === 'user' ? 'environment' : 'user';
      const pub = localParticipant.getTrackPublication(lk.client.Track.Source.Camera);
      const track = pub?.videoTrack as
        | {
            restartTrack?: (o: { facingMode: string }) => Promise<void>;
            mediaStreamTrack?: { _switchCamera?: () => void };
          }
        | undefined;
      if (!track) return;
      setFacing(next);
      const p = track.restartTrack?.({ facingMode: next });
      if (p) p.catch(() => track.mediaStreamTrack?._switchCamera?.());
      else track.mediaStreamTrack?._switchCamera?.();
    },
  };
  return <Frame a={a} media={media} {...h} />;
}

function useElapsed(since: string | null | undefined, on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [on]);
  return since ? now - new Date(since).getTime() : 0;
}

function Pulse({ children, on }: { children: ReactNode; on: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [on, v]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      {on
        ? [0, 1].map((i) => (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 132,
                height: 132,
                borderRadius: 66,
                borderWidth: 2,
                borderColor: T.rose,
                opacity: v.interpolate({
                  inputRange: [0, 1],
                  outputRange: i ? [0.35, 0] : [0.6, 0],
                }),
                transform: [
                  {
                    scale: v.interpolate({
                      inputRange: [0, 1],
                      outputRange: i ? [1.1, 1.9] : [1, 1.55],
                    }),
                  },
                ],
              }}
            />
          ))
        : null}
      {children}
    </View>
  );
}

function CtrlBtn({
  children,
  onPress,
  active = true,
  danger,
  accept,
  size = 58,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  accept?: boolean;
  size?: number;
  label?: string;
}) {
  const body = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {children}
    </View>
  );
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}>
        {danger || accept ? (
          <LinearGradient
            colors={danger ? [T.rose, T.coral] : [T.mint, '#38B8A2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: size / 2,
              shadowColor: danger ? T.rose : T.mint,
              shadowOpacity: 0.5,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 8 },
            }}>
            {body}
          </LinearGradient>
        ) : (
          <View
            style={{
              borderRadius: size / 2,
              backgroundColor: active ? 'rgba(255,255,255,0.14)' : T.text,
              borderWidth: 1,
              borderColor: T.border,
            }}>
            {body}
          </View>
        )}
      </Pressable>
      {label ? (
        <Txt size={11} color={T.muted}>
          {label}
        </Txt>
      ) : null}
    </View>
  );
}

function Frame({ a, media, onAccept, onDecline, onHangUp }: Handlers & { a: ActiveCall; media: Media | null }) {
  const insets = useSafeAreaInsets();
  const video = a.call.kind === 'video';
  const incoming = a.role === 'callee' && a.phase === 'ringing';
  const elapsed = useElapsed(a.call.answered_at, a.phase === 'in_call');
  const remoteVideo = video && media?.remote && !media.remote.publication.isMuted ? media.remote : null;
  const localVideo = video && media?.local && media.camOn ? media.local : null;
  const VideoTrack = media?.VideoTrack;
  // While ringing (caller) the local preview fills the screen; once connected it shrinks to PiP.
  const localFull = !!localVideo && !remoteVideo && a.phase === 'ringing';

  const status =
    a.phase === 'ended'
      ? (a.endedLabel ?? 'Call ended')
      : incoming
        ? `Incoming ${video ? 'video' : 'voice'} call`
        : a.phase === 'ringing'
          ? 'Ringing…'
          : media?.remoteJoined
            ? callDurationLabel(elapsed)
            : 'Connecting…';

  return (
    <View style={{ flex: 1, backgroundColor: T.ink }}>
      <Backdrop />
      {a.peer.photo && !remoteVideo ? <Image source={{ uri: a.peer.photo }} blurRadius={40} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} /> : null}
      <RadialBlob color={T.rose} size={520} opacity={0.22} style={{ top: -160, left: -140 }} />
      <RadialBlob color={T.violet} size={480} opacity={0.18} style={{ bottom: -140, right: -160 }} />

      {VideoTrack && remoteVideo ? <VideoTrack trackRef={remoteVideo} style={StyleSheet.absoluteFill} objectFit="cover" /> : null}
      {VideoTrack && localFull && localVideo ? <VideoTrack trackRef={localVideo} style={StyleSheet.absoluteFill} objectFit="cover" mirror={media?.facing === 'user'} /> : null}
      {remoteVideo || localFull ? (
        <LinearGradient
          colors={['rgba(10,8,14,0.65)', 'transparent', 'transparent', 'rgba(10,8,14,0.75)']}
          locations={[0, 0.25, 0.65, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}

      {/* header */}
      <View
        style={{
          paddingTop: insets.top + 18,
          alignItems: 'center',
          paddingHorizontal: 24,
        }}>
        {remoteVideo ? (
          <>
            <Txt v="display" size={22}>
              {a.peer.name}
            </Txt>
            <Txt v="mono" size={12} color={T.text} style={{ marginTop: 4, opacity: 0.85 }}>
              {status}
            </Txt>
          </>
        ) : null}
      </View>

      {/* centre: avatar (audio / ringing / remote camera off) */}
      {!remoteVideo ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            paddingHorizontal: 24,
          }}>
          {!localFull ? (
            <Pulse on={a.phase === 'ringing'}>
              <Avatar uri={a.peer.photo} name={a.peer.name} size={120} ring={T.rose} />
            </Pulse>
          ) : null}
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Txt v="display" size={28} center>
              {a.peer.name}
            </Txt>
            <Txt v="mono" size={12.5} color={a.phase === 'ended' ? T.rose : T.muted} center style={{ letterSpacing: 0.5 }}>
              {status}
            </Txt>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }} />
      )}

      {/* local picture-in-picture */}
      {VideoTrack && localVideo && !localFull ? (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 16,
            right: 16,
            width: 104,
            height: 148,
            borderRadius: 18,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.18)',
            backgroundColor: T.surface2,
          }}>
          <VideoTrack trackRef={localVideo} style={{ flex: 1 }} objectFit="cover" mirror={media?.facing === 'user'} zOrder={1} />
        </View>
      ) : null}

      {/* controls */}
      <View style={{ paddingBottom: insets.bottom + 34, paddingHorizontal: 24 }}>
        {a.phase === 'ended' ? (
          <View style={{ height: 80 }} />
        ) : incoming ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <CtrlBtn danger size={68} label="Decline" onPress={onDecline}>
              <PhoneOff size={26} color="#fff" />
            </CtrlBtn>
            <CtrlBtn accept size={68} label="Accept" onPress={onAccept}>
              {video ? <Video size={26} color="#fff" /> : <Phone size={26} color="#fff" />}
            </CtrlBtn>
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-evenly',
              alignItems: 'flex-start',
            }}>
            {video ? (
              <CtrlBtn label="Flip" onPress={() => media?.flip()}>
                <SwitchCamera size={22} color={T.text} />
              </CtrlBtn>
            ) : null}
            <CtrlBtn label={media?.micOn === false ? 'Unmute' : 'Mute'} active={media?.micOn !== false} onPress={() => media?.toggleMic()}>
              {media?.micOn === false ? <MicOff size={22} color={T.ink} /> : <Mic size={22} color={T.text} />}
            </CtrlBtn>
            {video ? (
              <CtrlBtn label={media?.camOn === false ? 'Camera on' : 'Camera off'} active={media?.camOn !== false} onPress={() => media?.toggleCam()}>
                {media?.camOn === false ? <VideoOff size={22} color={T.ink} /> : <Video size={22} color={T.text} />}
              </CtrlBtn>
            ) : null}
            <CtrlBtn danger label="End" onPress={onHangUp}>
              <PhoneOff size={22} color="#fff" />
            </CtrlBtn>
          </View>
        )}
      </View>
    </View>
  );
}

/* ------------------------------ Expo Go ------------------------------ */

function UnsupportedView({ u, onClose }: { u: UnsupportedCall; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const incoming = !!u.incoming;
  const what = u.kind === 'video' ? 'Video calls' : 'Voice calls';
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: T.ink,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 28,
        paddingHorizontal: 28,
      }}>
      <Backdrop />
      <RadialBlob color={T.rose} size={480} opacity={0.2} style={{ top: -140, left: -140 }} />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}>
        <Pulse on={incoming}>
          <Avatar uri={u.peer.photo} name={u.peer.name} size={108} ring={T.rose} />
        </Pulse>
        <Txt v="display" size={26} center>
          {incoming ? `${u.peer.name} is calling` : `${what} work in the installed app`}
        </Txt>
        <Txt size={14} color={T.muted} center lh={1.45} style={{ maxWidth: 320 }}>
          {incoming
            ? `${what} work in the installed MATCH app. You're in Expo Go, which can't run live video — open MATCH on your phone to call ${u.peer.name} back.`
            : `You're in Expo Go, which can't run live video. Install the MATCH app to call ${u.peer.name} — everything else keeps working here.`}
        </Txt>
      </View>
      <PrimaryButton label={incoming ? 'Decline' : 'Got it'} onPress={onClose} />
      {incoming ? null : <TextButton label="Back to chat" onPress={onClose} />}
    </View>
  );
}
