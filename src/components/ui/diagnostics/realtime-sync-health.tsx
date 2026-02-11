'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { useCanvasLiveKit } from '@/components/ui/livekit/livekit-room-connector';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

export type RealtimeSyncHealthSnapshot = {
  contract?: any;
  syncDiagnostics?: any;
  sessionSync?: any;
  executor?: any;
  tldrawSync?: any;
  lastProcessedToolCallId?: string | null;
};

function readWindowSnapshot(): RealtimeSyncHealthSnapshot {
  if (typeof window === 'undefined') return {};
  const w = (window as any).__present || {};
  return {
    contract: w.syncContract,
    syncDiagnostics: w.syncDiagnostics,
    sessionSync: w.sessionSync,
    executor: w.executor,
    tldrawSync: w.tldrawSync,
    lastProcessedToolCallId:
      typeof w.lastProcessedToolCallId === 'string' ? w.lastProcessedToolCallId : null,
  };
}

export function RealtimeSyncHealth({ enabled = true }: { enabled?: boolean }) {
  const room = useRoomContext();
  const livekitCtx = useCanvasLiveKit();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);
  const [snapshot, setSnapshot] = React.useState<RealtimeSyncHealthSnapshot>(() => readWindowSnapshot());
  const [probe, setProbe] = React.useState<{
    id: string | null;
    sentAt: number | null;
    acks: Set<string>;
  }>({ id: null, sentAt: null, acks: new Set() });
  const probeIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const refresh = () => setSnapshot(readWindowSnapshot());
    refresh();
    const timer = setInterval(refresh, 1000);
    window.addEventListener('present:sync-contract', refresh as EventListener);
    window.addEventListener('present:sync-diagnostic', refresh as EventListener);
    window.addEventListener('present:session-sync', refresh as EventListener);
    window.addEventListener('present:executor-state', refresh as EventListener);
    return () => {
      clearInterval(timer);
      window.removeEventListener('present:sync-contract', refresh as EventListener);
      window.removeEventListener('present:sync-diagnostic', refresh as EventListener);
      window.removeEventListener('present:session-sync', refresh as EventListener);
      window.removeEventListener('present:executor-state', refresh as EventListener);
    };
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    const localIdentity = room?.localParticipant?.identity || '';
    const offProbe = bus.on('sync_probe', (message: any) => {
      const probeId = typeof message?.probeId === 'string' ? message.probeId : null;
      const sender = typeof message?.sender === 'string' ? message.sender : null;
      if (!probeId || sender === localIdentity) return;
      bus.send('sync_probe_ack', {
        type: 'sync_probe_ack',
        probeId,
        from: localIdentity || 'unknown',
        room: room?.name || '',
        ts: Date.now(),
      });
    });
    const offAck = bus.on('sync_probe_ack', (message: any) => {
      const probeId = typeof message?.probeId === 'string' ? message.probeId : null;
      const from = typeof message?.from === 'string' ? message.from : null;
      if (!probeId || !from || probeIdRef.current !== probeId) return;
      setProbe((prev) => {
        const nextAcks = new Set(prev.acks);
        nextAcks.add(from);
        return { ...prev, acks: nextAcks };
      });
    });
    return () => {
      offProbe?.();
      offAck?.();
    };
  }, [bus, enabled, room?.localParticipant?.identity, room?.name]);

  if (!enabled) return null;

  const roomName = livekitCtx?.roomName || room?.name || 'unknown';
  const contractOk = Boolean(snapshot.syncDiagnostics?.contract?.ok);
  const tldrawOk = Boolean(snapshot.syncDiagnostics?.tldraw?.ok);
  const sessionOk = Boolean(snapshot.syncDiagnostics?.session?.ok);
  const livekitConnected = Boolean(livekitCtx?.isConnected);
  const executorIdentity =
    typeof snapshot.executor?.executorIdentity === 'string'
      ? snapshot.executor.executorIdentity
      : 'none';
  const leaseExpiry =
    typeof snapshot.executor?.leaseExpiresAt === 'string'
      ? snapshot.executor.leaseExpiresAt
      : 'none';
  const healthy = contractOk && tldrawOk && sessionOk && livekitConnected;
  const probeLatency =
    probe.sentAt != null ? Math.max(0, Date.now() - probe.sentAt) : null;
  const contractCanvasId =
    typeof snapshot.contract?.canvasId === 'string' ? snapshot.contract.canvasId : 'none';
  const contractRoom =
    typeof snapshot.contract?.livekitRoomName === 'string'
      ? snapshot.contract.livekitRoomName
      : roomName;
  const contractTldrawRoom =
    typeof snapshot.contract?.tldrawRoomId === 'string'
      ? snapshot.contract.tldrawRoomId
      : 'none';
  const tldrawConnection =
    typeof snapshot.tldrawSync?.connectionStatus === 'string'
      ? snapshot.tldrawSync.connectionStatus
      : 'unknown';

  return (
    <div className="fixed bottom-4 left-4 z-[1200] w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-default bg-surface/95 p-3 text-xs text-primary shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Realtime Sync Health</div>
        <span
          className={[
            'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            healthy ? 'bg-success-surface text-success' : 'bg-danger-surface text-danger',
          ].join(' ')}
        >
          {healthy ? 'healthy' : 'degraded'}
        </span>
      </div>
      <div className="space-y-1 text-secondary">
        <div>Room: <span className="font-mono text-primary">{roomName}</span></div>
        <div>CanvasId: <span className="font-mono text-primary">{contractCanvasId}</span></div>
        <div>Contract Room: <span className="font-mono text-primary">{contractRoom}</span></div>
        <div>TLDraw Room: <span className="font-mono text-primary">{contractTldrawRoom}</span></div>
        <div>Participants: <span className="font-mono text-primary">{livekitCtx?.participantCount ?? 0}</span></div>
        <div>Contract: <span className="font-mono text-primary">{contractOk ? 'ok' : 'mismatch'}</span></div>
        <div>TLDraw Sync: <span className="font-mono text-primary">{snapshot.tldrawSync?.status ?? 'unknown'}</span></div>
        <div>TLDraw Conn: <span className="font-mono text-primary">{tldrawConnection}</span></div>
        <div>Session: <span className="font-mono text-primary">{snapshot.sessionSync?.sessionId ?? 'none'}</span></div>
        <div>Session Room: <span className="font-mono text-primary">{snapshot.syncDiagnostics?.session?.roomName ?? 'none'}</span></div>
        <div>Executor: <span className="font-mono text-primary">{executorIdentity}</span></div>
        <div>Lease Expiry: <span className="font-mono text-primary">{leaseExpiry}</span></div>
        <div>Writer: <span className="font-mono text-primary">{snapshot.sessionSync?.isWriter ? 'true' : 'false'}</span></div>
        <div>Last Tool Call: <span className="font-mono text-primary">{snapshot.lastProcessedToolCallId ?? 'none'}</span></div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded border border-default bg-surface-secondary px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary"
          onClick={() => {
            const localIdentity = room?.localParticipant?.identity || 'unknown';
            const probeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            probeIdRef.current = probeId;
            setProbe({ id: probeId, sentAt: Date.now(), acks: new Set() });
            bus.send('sync_probe', {
              type: 'sync_probe',
              probeId,
              sender: localIdentity,
              room: room?.name || '',
              ts: Date.now(),
            });
          }}
        >
          Run Probe
        </button>
        <div className="text-[10px] text-secondary">
          Probe: {probe.id ? `${probe.acks.size} ack(s)` : 'idle'}
          {probeLatency != null ? ` • ${probeLatency}ms` : ''}
        </div>
      </div>
    </div>
  );
}

export default RealtimeSyncHealth;
