'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

type Item = { id: string; topic: string; payload: any; ts: number };

export function DevEventFeed({ max = 50 }: { max?: number }) {
  const room = useRoomContext();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);
  const [open, setOpen] = React.useState(true);
  const [items, setItems] = React.useState<Item[]>([]);

  React.useEffect(() => {
    if (!room) return;
    const add = (topic: string) => (payload: any) => {
      setItems((prev) => {
        const next = [{ id: crypto.randomUUID?.() || String(Date.now()), topic, payload, ts: Date.now() }, ...prev];
        return next.slice(0, max);
      });
    };
    const offs = [
      bus.on('decision', add('decision')),
      bus.on('tool_call', add('tool_call')),
      bus.on('tool_result', add('tool_result')),
      bus.on('tool_error', add('tool_error')),
      bus.on('editor_action', add('editor_action')),
      bus.on('capability_query', add('capability')),
    ];
    return () => offs.forEach((off) => off?.());
  }, [room, bus, max]);

  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 1000 }}>
      <div style={{ marginBottom: 6 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid #94a3b8',
            background: open ? '#0f172a' : '#1e293b',
            color: '#e2e8f0',
          }}
        >
          {open ? 'Hide' : 'Show'} Dev Event Feed
        </button>
      </div>
      {open && (
        <div
          style={{
            width: 360,
            maxHeight: 280,
            overflow: 'auto',
            background: 'rgba(2,6,23,0.85)',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 8,
            color: '#e2e8f0',
            fontSize: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          }}
        >
          {items.length === 0 && <div style={{ opacity: 0.7 }}>No events yet…</div>}
          {items.map((it) => (
            <div key={it.id} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: '#38bdf8' }}>{it.topic}</strong>
                <span style={{ opacity: 0.6 }}>{new Date(it.ts).toLocaleTimeString()}</span>
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(148,163,184,0.2)',
                  borderRadius: 6,
                  padding: 6,
                }}
              >
                {(() => {
                  try {
                    return JSON.stringify(it.payload, null, 2);
                  } catch {
                    return String(it.payload);
                  }
                })()}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DevEventFeed;

