import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useEffect, useState } from 'react';
import { NativeModules, Platform, StyleSheet, View } from 'react-native';

import { fetchLiveKitToken } from '@/lib/live';

/**
 * Real video for live rooms (LiveKit). LiveKit needs native WebRTC modules, so it only
 * runs in a dev/production build (EAS). In Expo Go (and on web) the native module is
 * missing: we never `require` LiveKit there and the room keeps working without video
 * (server-backed chat, reactions, viewers and LIVE MATCH votes).
 */

type LiveKitRN = typeof import('@livekit/react-native');
type LiveKitClient = typeof import('livekit-client');
export type LK = { rn: LiveKitRN; client: LiveKitClient };

export const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let cached: LK | null | undefined;

export function loadLiveKit(): LK | null {
  if (cached !== undefined) return cached;
  if (IS_EXPO_GO || Platform.OS === 'web' || !NativeModules.WebRTCModule) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('@livekit/react-native') as LiveKitRN;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const client = require('livekit-client') as LiveKitClient;
    rn.registerGlobals();
    cached = { rn, client };
  } catch {
    cached = null;
  }
  return cached;
}

/** True when this binary can do real video (dev/production build with LiveKit linked). */
export type LiveVideoStatus = 'unsupported' | 'connecting' | 'live' | 'not_configured' | 'ended' | 'not_allowed' | 'error';

export function LiveVideo({ streamId, onStatus }: { streamId: string; onStatus?: (s: LiveVideoStatus) => void }) {
  const lk = loadLiveKit();
  const [conn, setConn] = useState<{ token: string; url: string; canPublish: boolean } | null>(null);

  useEffect(() => {
    if (!lk) {
      onStatus?.('unsupported');
      return;
    }
    let cancelled = false;
    onStatus?.('connecting');
    fetchLiveKitToken(streamId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setConn({ token: r.token, url: r.url, canPublish: r.canPublish });
        } else {
          onStatus?.(r.reason === 'not_configured' ? 'not_configured' : r.reason === 'stream_ended' ? 'ended' : r.reason === 'not_allowed' ? 'not_allowed' : 'error');
        }
      })
      .catch(() => !cancelled && onStatus?.('error'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, !!lk]);

  if (!lk || !conn) return null;
  return <LiveKitStage lk={lk} {...conn} onStatus={onStatus} />;
}

function LiveKitStage({ lk, token, url, canPublish, onStatus }: { lk: LK; token: string; url: string; canPublish: boolean; onStatus?: (s: LiveVideoStatus) => void }) {
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
      audio={canPublish}
      video={canPublish}
      options={{ adaptiveStream: { pixelDensity: 'screen' } }}
      onConnected={() => onStatus?.('live')}
      onDisconnected={() => onStatus?.('ended')}
      onError={() => onStatus?.('error')}
    >
      <Tiles lk={lk} />
    </LiveKitRoom>
  );
}

function Tiles({ lk }: { lk: LK }) {
  const { useTracks, isTrackReference, VideoTrack } = lk.rn;
  const tracks = useTracks([lk.client.Track.Source.Camera], { onlySubscribed: false });
  const refs = tracks.filter(isTrackReference).slice(0, 2);
  if (!refs.length) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {refs.map((t) => (
        <VideoTrack key={`${t.participant.identity}:${t.publication.trackSid}`} trackRef={t} style={{ flex: 1 }} objectFit="cover" mirror={t.participant.isLocal} />
      ))}
    </View>
  );
}
