'use client';

import { useCallback, useState } from 'react';
import { useEditor } from '@tldraw/tldraw';
import { useFairyPromptData } from './fairy-prompt-data';
import {
  DEFAULT_FAIRY_CONTEXT_PROFILE,
  FAIRY_CONTEXT_PROFILES,
  getFairyContextSpectrum,
} from '@/lib/fairy-context/profiles';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';

export function FairyPromptPanel() {
  const editor = useEditor();
  const { roomName, widgets } = useCanvasContext();
  const buildPromptData = useFairyPromptData();

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextProfile, setContextProfile] = useState<string>(DEFAULT_FAIRY_CONTEXT_PROFILE);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    try {
      setIsSending(true);
      setError(null);

      const selectionIds =
        editor && typeof (editor as any).getSelectedShapeIds === 'function'
          ? (editor as any).getSelectedShapeIds()
          : [];
      const bounds =
        editor && typeof (editor as any).getViewportPageBounds === 'function'
          ? (editor as any).getViewportPageBounds()
          : undefined;

      const bundle = buildPromptData({ selectionIds, profile: contextProfile });
      const spectrum = getFairyContextSpectrum(
        (contextProfile as any) || DEFAULT_FAIRY_CONTEXT_PROFILE,
      ).value;

      const counts: Record<string, number> = {};
      widgets.forEach((widget) => {
        const type = widget.componentType || 'Unknown';
        counts[type] = (counts[type] ?? 0) + 1;
      });

      const payload = {
        room: roomName,
        task: 'fairy.intent',
        params: {
          id:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          room: roomName,
          message: trimmed,
          source: 'fairy',
          selectionIds,
          bounds,
          contextProfile,
          spectrum,
          metadata: {
            promptData: bundle.parts,
            promptSummary: bundle.summary,
            contextProfile,
            spectrum,
            viewContext: {
              totalComponents: widgets.length,
              componentCounts: counts,
            },
          },
        },
      };

      const response = await fetch('/api/steward/runCanvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `request_failed_${response.status}`);
      }

      setMessage('');
    } catch (sendError) {
      console.error('[FairyPromptPanel] dispatch failed', sendError);
      setError('Unable to dispatch fairy intent. Check steward/queue logs.');
    } finally {
      setIsSending(false);
    }
  }, [buildPromptData, contextProfile, editor, message, roomName, widgets]);

  return (
    <div
      data-testid="fairy-panel"
      className="absolute bottom-4 right-4 z-20 flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-white/90 p-3 shadow-lg backdrop-blur"
      style={{ minWidth: 280 }}
    >
      <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>Fairy Intent Control</span>
        <span className="text-xs text-slate-500">server queue</span>
      </div>
      <div className="text-xs text-slate-500">Dispatches `fairy.intent` via `/api/steward/runCanvas`.</div>
      <div className="flex items-center gap-2">
        <input
          data-testid="fairy-input"
          className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
          placeholder="Describe what to draw or update..."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleSend();
            }
          }}
        />
        <button
          data-testid="fairy-send"
          type="button"
          className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white"
          onClick={() => void handleSend()}
          disabled={!message.trim() || isSending}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
      {error && <div className="text-[11px] text-rose-500">{error}</div>}
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>Context</span>
        <select
          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700"
          value={contextProfile}
          onChange={(event) => setContextProfile(event.target.value)}
        >
          {FAIRY_CONTEXT_PROFILES.map((profile) => (
            <option key={profile} value={profile}>
              {profile}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
