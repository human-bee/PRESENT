'use client';

import { useCallback, useMemo, useState } from 'react';
import { useEditor, useValue } from '@tldraw/tldraw';
import { useFairyApp } from '@/vendor/tldraw-fairy/fairy/fairy-app/FairyAppProvider';
import type { FairyAgent } from '@/vendor/tldraw-fairy/fairy/fairy-agent/FairyAgent';
import { useFairyPromptData } from './fairy-prompt-data';
import {
  DEFAULT_FAIRY_CONTEXT_PROFILE,
  FAIRY_CONTEXT_PROFILES,
  getFairyContextSpectrum,
} from '@/lib/fairy-context/profiles';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';

function pickAgent(agents: FairyAgent[]): FairyAgent | null {
  if (!agents.length) return null;
  const selected = agents.find((agent) => agent.getEntity()?.isSelected);
  return selected ?? agents[0];
}

export function FairyPromptPanel() {
  const editor = useEditor();
  const fairyApp = useFairyApp();
  const { roomName, widgets } = useCanvasContext();
  const agents = useValue('fairy-agents', () => fairyApp?.agents.getAgents() ?? [], [fairyApp]);
  const activeAgent = useMemo(() => pickAgent(agents), [agents]);
  const isGenerating = useValue(
    'fairy-generating',
    () => activeAgent?.requests.isGenerating() ?? false,
    [activeAgent],
  );
  const buildPromptData = useFairyPromptData();
  const viewContext = useMemo(() => {
    const counts: Record<string, number> = {};
    widgets.forEach((widget) => {
      const type = widget.componentType || 'Unknown';
      counts[type] = (counts[type] ?? 0) + 1;
    });
    return {
      totalComponents: widgets.length,
      componentCounts: counts,
    };
  }, [widgets]);

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextProfile, setContextProfile] = useState<string>(DEFAULT_FAIRY_CONTEXT_PROFILE);

  const handleSummon = useCallback(() => {
    if (!activeAgent) return;
    if (activeAgent.mode.isSleeping()) {
      activeAgent.mode.setMode('idling');
    }
    activeAgent.updateEntity((f) => (f ? { ...f, isSelected: true } : f));
    activeAgent.position.summon();
  }, [activeAgent]);

  const handleSend = useCallback(async () => {
    if (!activeAgent) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    if (activeAgent.mode.isSleeping()) {
      activeAgent.mode.setMode('idling');
    }
    activeAgent.updateEntity((f) => (f ? { ...f, isSelected: true } : f));
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
            viewContext,
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
    } catch (error) {
      console.error('[FairyPanel] prompt failed', error);
      setError('Unable to send. Check the steward connection.');
    } finally {
      setIsSending(false);
    }
  }, [activeAgent, buildPromptData, contextProfile, editor, message, roomName, viewContext]);

  return (
    <div
      data-testid="fairy-panel"
      className="absolute bottom-4 right-4 z-20 flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-white/90 p-3 shadow-lg backdrop-blur"
      style={{ minWidth: 260 }}
    >
      <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>Fairy Control</span>
        <span className="text-xs text-slate-500">{agents.length} active</span>
      </div>
      <div className="text-xs text-slate-500" data-testid="fairy-status">
        {activeAgent
          ? `${activeAgent.getConfig()?.name ?? 'Fairy'} ${isGenerating || isSending ? '• thinking…' : 'ready'}`
          : 'No fairies'}
      </div>
      <div className="flex gap-2">
        <button
          data-testid="fairy-summon"
          type="button"
          className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
          onClick={handleSummon}
        >
          Summon
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
          onClick={() => {
            if (!activeAgent) return;
            activeAgent.updateEntity((f) => (f ? { ...f, isSelected: false } : f));
          }}
        >
          Deselect
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          data-testid="fairy-input"
          className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
          placeholder="Ask a fairy to draw…"
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
          disabled={!message.trim() || !activeAgent || isGenerating || isSending}
        >
          Send
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
