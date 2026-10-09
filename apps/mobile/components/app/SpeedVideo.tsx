import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { loadLiveKit, type LK } from '@/components/app/LiveVideo';
import { Photo } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { fetchRoomToken } from '@/lib/speed';

export type RoomVideoStatus = 'unsupported' | 'connecting' | 'live' | 'not_configured' | 'ended' | 'not_allowed' | 'error';
export type RoomPerson = { id: string; name: string; photo: string | null };

/**
 * Camera grid for a speed date (2 people) or a group room (up to 10). LiveKit needs native WebRTC,
 * so in Expo Go / web we never load it: the photos of the people in the room are shown instead
 * with a short note, and the rest of the flow (timer, picks, report, leave) keeps working.
 */
export function RoomVideo({ kind, id, people, onStatus }: { kind: 'speed' | 'group'; id: string; people: RoomPerson[]; onStatus?: (s: RoomVideoStatus) => void }) {
  const lk = loadLiveKit();
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [status, setStatus] = useState<RoomVideoStatus>(lk ? 'connecting' : 'unsupported');

  const report = (s: RoomVideoStatus) => {
    setStatus(s);
    onStatus?.(s);
  };

  useEffect(() => {
    if (!lk) {
      report('unsupported');
      return;
    }
    let cancelled = false;
    report('connecting');
    fetchRoomToken(kind, id)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setConn({ token: r.token, url: r.url });
        else report(r.reason);
      })
      .catch(() => !cancelled && report('error'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, !!lk]);

  const note =
    status === 'unsupported'
      ? 'Video works in the MATCH app — Expo Go shows photos only'
      : status === 'not_configured'
        ? 'Video is being set up — you can still use the timer and picks'
        : status === 'error'
          ? "Couldn't connect the video"
          : null;

  return (
    <View style={{ flex: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: T.surface2 }}>
      <PhotoGrid people={people} />
      {lk && conn ? <LiveKitGrid lk={lk} token={conn.token} url={conn.url} onStatus={report} /> : null}
      {note ? (
        <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <Txt size={11.5} color="#fff" style={{ textAlign: 'center' }}>
            📷 {note}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function PhotoGrid({ people }: { people: RoomPerson[] }) {
  const cols = people.length <= 2 ? 1 : people.length <= 6 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(people.length / cols));
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap' }]}>
      {people.map((p) => (
        <View key={p.id} style={{ width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 1 }}>
          <Photo uri={p.photo} name={p.name} style={{ width: '100%', height: '100%' }} />
          <View style={{ position: 'absolute', left: 8, bottom: 8, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <Txt w={600} size={11} color="#fff">
              {p.name}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

function LiveKitGrid({ lk, token, url, onStatus }: { lk: LK; token: string; url: string; onStatus: (s: RoomVideoStatus) => void }) {
  const { LiveKitRoom, AudioSession } = lk.rn;
  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, [AudioSession]);
  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio
      video
      options={{ adaptiveStream: { pixelDensity: 'screen' } }}
      onConnected={() => onStatus('live')}
      onDisconnected={() => onStatus('ended')}
      onError={() => onStatus('error')}>
      <Tiles lk={lk} />
    </LiveKitRoom>
  );
}

function Tiles({ lk }: { lk: LK }) {
  const { useTracks, isTrackReference, VideoTrack } = lk.rn;
  const tracks = useTracks([lk.client.Track.Source.Camera], { onlySubscribed: false });
  const refs = tracks.filter(isTrackReference).slice(0, 10);
  if (!refs.length) return null;
  const cols = refs.length <= 2 ? 1 : refs.length <= 6 ? 2 : 3;
  const rows = Math.ceil(refs.length / cols);
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: T.ink }]} pointerEvents="none">
      {refs.map((t) => (
        <View key={`${t.participant.identity}:${t.publication.trackSid}`} style={{ width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 1 }}>
          <VideoTrack trackRef={t} style={{ flex: 1 }} objectFit="cover" mirror={t.participant.isLocal} />
        </View>
      ))}
    </View>
  );
}
