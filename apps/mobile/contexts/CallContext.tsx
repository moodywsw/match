import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { CallOverlay } from '@/components/app/CallScreens';
import { loadLiveKit } from '@/components/app/LiveVideo';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  answerCall,
  callErrorMessage,
  callHeartbeat,
  endCall,
  fetchCall,
  fetchCallPeer,
  fetchRingingForMe,
  isFinal,
  pushMissedCall,
  RING_TIMEOUT_MS,
  startCall,
  subscribeCall,
  subscribeIncomingCalls,
  type CallKind,
  type CallPeer,
  type CallRow,
  type CallStatus,
} from '@/lib/calls';

/**
 * App-wide call state. Incoming calls arrive over Realtime while the app is open
 * (ringing a closed app needs native CallKit / ConnectionService + VoIP push —
 * not in this build; the callee gets a missed-call push instead).
 */

export type CallPhase = 'ringing' | 'in_call' | 'ended';
export type ActiveCall = {
  call: CallRow;
  role: 'caller' | 'callee';
  peer: CallPeer;
  phase: CallPhase;
  endedLabel?: string;
};
/** Shown instead of a call where LiveKit is not in the binary (Expo Go / web). */
export type UnsupportedCall = {
  peer: CallPeer;
  kind: CallKind;
  incoming?: CallRow;
};

type CallCtx = {
  supported: boolean;
  active: ActiveCall | null;
  placeCall: (conversationId: string, peer: CallPeer, kind: CallKind) => Promise<void>;
};

const Ctx = createContext<CallCtx>({
  supported: false,
  active: null,
  placeCall: async () => {},
});
export const useCalls = () => useContext(Ctx);

function endedLabelFor(status: CallStatus, role: 'caller' | 'callee'): string {
  if (status === 'declined') return role === 'caller' ? 'Call declined' : 'Declined';
  if (status === 'missed') return role === 'caller' ? 'No answer' : 'Missed call';
  return 'Call ended';
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const supported = useMemo(() => !!loadLiveKit(), []);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [unsupported, setUnsupported] = useState<UnsupportedCall | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  activeRef.current = active;
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback((status: CallStatus) => {
    setActive((a) =>
      a && a.phase !== 'ended'
        ? {
            ...a,
            phase: 'ended',
            call: { ...a.call, status },
            endedLabel: endedLabelFor(status, a.role),
          }
        : a,
    );
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setActive(null), 1600);
  }, []);

  const applyStatus = useCallback(
    (status: CallStatus | null) => {
      const a = activeRef.current;
      if (!a || !status || a.phase === 'ended') return;
      if (isFinal(status)) finish(status);
      else if (status === 'accepted' && a.phase === 'ringing')
        setActive({
          ...a,
          phase: 'in_call',
          call: {
            ...a.call,
            status,
            answered_at: a.call.answered_at ?? new Date().toISOString(),
          },
        });
    },
    [finish],
  );

  /* ---------- incoming ---------- */
  const onRing = useCallback(
    async (row: CallRow) => {
      if (!user?.id || row.callee_id !== user.id) return;
      if (activeRef.current && activeRef.current.call.id !== row.id && activeRef.current.phase !== 'ended') return;
      if (activeRef.current?.call.id === row.id) return;
      const peer = await fetchCallPeer(row.caller_id);
      if (!supported) {
        setUnsupported({ peer, kind: row.kind, incoming: row });
        return;
      }
      setActive({ call: row, role: 'callee', peer, phase: 'ringing' });
    },
    [user?.id, supported],
  );

  useEffect(() => {
    if (!user?.id) {
      setActive(null);
      setUnsupported(null);
      return;
    }
    const uid = user.id;
    const unsub = subscribeIncomingCalls(uid, (row) => void onRing(row));
    const check = () => {
      if (activeRef.current) return;
      fetchRingingForMe(uid)
        .then((row) => row && onRing(row))
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      unsub();
      sub.remove();
    };
  }, [user?.id, onRing]);

  /* ---------- current call: realtime + heartbeat/poll ---------- */
  const callId = active?.call.id;
  const phase = active?.phase;
  useEffect(() => {
    if (!callId || phase === 'ended') return;
    const unsub = subscribeCall(callId, (row) => applyStatus(row.status));
    // Ringing: poll fast (Realtime can lag); in call: heartbeat keeps the call alive server-side.
    const every = phase === 'ringing' ? 3000 : 15000;
    const beat = () => void callHeartbeat(callId).then(applyStatus);
    beat();
    const iv = setInterval(beat, every);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, [callId, phase, applyStatus]);

  /* ---------- caller ring timeout ---------- */
  useEffect(() => {
    if (!active || active.role !== 'caller' || active.phase !== 'ringing') return;
    const elapsed = Date.now() - new Date(active.call.created_at).getTime();
    const t = setTimeout(
      () => {
        endCall(active.call.id)
          .then((s) => {
            if (s === 'missed') pushMissedCall(active.call.callee_id);
            finish(s);
          })
          .catch(() => finish('missed'));
      },
      Math.max(1000, RING_TIMEOUT_MS - (Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0)),
    );
    return () => clearTimeout(t);
  }, [active, finish]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  // Expo Go "answer in the installed app" card: close it when the caller gives up.
  const unsupportedIncomingId = unsupported?.incoming?.id;
  useEffect(() => {
    if (!unsupportedIncomingId) return;
    const close = (s: CallStatus | null | undefined) => isFinal(s) && setUnsupported(null);
    const unsub = subscribeCall(unsupportedIncomingId, (row) => close(row.status));
    const t = setTimeout(() => setUnsupported((u) => (u?.incoming?.id === unsupportedIncomingId ? null : u)), RING_TIMEOUT_MS + 2000);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [unsupportedIncomingId]);

  /* ---------- actions ---------- */
  const placeCall = useCallback(
    async (conversationId: string, peer: CallPeer, kind: CallKind) => {
      if (!user?.id) return;
      if (activeRef.current && activeRef.current.phase !== 'ended') {
        toast('You’re already on a call');
        return;
      }
      if (!supported) {
        setUnsupported({ peer, kind });
        return;
      }
      try {
        const id = await startCall(conversationId, kind);
        const row =
          (await fetchCall(id)) ??
          ({
            id,
            conversation_id: conversationId,
            caller_id: user.id,
            callee_id: peer.id,
            kind,
            status: 'ringing',
            created_at: new Date().toISOString(),
            answered_at: null,
            ended_at: null,
          } satisfies CallRow);
        setActive({ call: row, role: 'caller', peer, phase: 'ringing' });
      } catch (err) {
        toast(callErrorMessage(err));
      }
    },
    [user?.id, supported, toast],
  );

  const accept = useCallback(async () => {
    const a = activeRef.current;
    if (!a) return;
    try {
      const s = await answerCall(a.call.id, true);
      if (s === 'accepted')
        setActive({
          ...a,
          phase: 'in_call',
          call: { ...a.call, status: s, answered_at: new Date().toISOString() },
        });
      else finish(s);
    } catch (err) {
      toast(callErrorMessage(err));
      finish('ended');
    }
  }, [finish, toast]);

  const decline = useCallback(async () => {
    const a = activeRef.current;
    if (!a) return;
    finish('declined');
    try {
      await answerCall(a.call.id, false);
    } catch {
      /* already over */
    }
  }, [finish]);

  const hangUp = useCallback(async () => {
    const a = activeRef.current;
    if (!a || a.phase === 'ended') return;
    try {
      const s = await endCall(a.call.id);
      if (s === 'missed' && a.role === 'caller') pushMissedCall(a.call.callee_id);
      finish(s);
    } catch {
      finish('ended');
    }
  }, [finish]);

  const declineUnsupported = useCallback(async () => {
    const u = unsupported;
    setUnsupported(null);
    if (u?.incoming) {
      try {
        await answerCall(u.incoming.id, false);
      } catch {
        /* already over */
      }
    }
  }, [unsupported]);

  const onMediaError = useCallback(
    (reason: string) => {
      if (reason === 'not_configured') toast('Video calls aren’t switched on yet');
      else if (reason === 'call_ended') {
        applyStatus('ended');
        return;
      } else if (reason === 'rate_limited') toast('Too many call attempts — try again in a few minutes');
      else toast('Call connection failed');
      void hangUp();
    },
    [toast, hangUp, applyStatus],
  );

  const value = useMemo(() => ({ supported, active, placeCall }), [supported, active, placeCall]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <CallOverlay
        active={active}
        unsupported={unsupported}
        onAccept={accept}
        onDecline={decline}
        onHangUp={hangUp}
        onCloseUnsupported={declineUnsupported}
        onMediaError={onMediaError}
      />
    </Ctx.Provider>
  );
}
