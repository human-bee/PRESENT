'use client';

import { useCallback, useMemo, useState } from 'react';
import { useValue } from '@tldraw/tldraw';
import { useFairyApp } from '@/vendor/tldraw-fairy/fairy/fairy-app/FairyAppProvider';
import type { FairyAgent } from '@/vendor/tldraw-fairy/fairy/fairy-agent/FairyAgent';

function pickAgent(agents: FairyAgent[]): FairyAgent | null {
  if (!agents.length) return null;
  const selected = agents.find((agent) => agent.getEntity()?.isSelected);
  return selected ?? agents[0];
}

export function FairyPromptPanel() {
  const fairyApp = useFairyApp();
  const agents = useValue('fairy-agents', () => fairyApp?.agents.getAgents() ?? [], [fairyApp]);
  const activeAgent = useMemo(() => pickAgent(agents), [agents]);
  const isGenerating = useValue(
    'fairy-generating',
    () => activeAgent?.requests.isGenerating() ?? false,
    [activeAgent],
  );

  const [message, setMessage] = useState('');

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
      await activeAgent.prompt({ message: trimmed, source: 'user' } as any);
    } catch (error) {
      console.error('[FairyPanel] prompt failed', error);
    }
    setMessage('');
  }, [activeAgent, message]);

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
        {activeAgent ? `${activeAgent.getConfig()?.name ?? 'Fairy'} ${isGenerating ? '• thinking…' : 'ready'}` : 'No fairies'}
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
          disabled={!message.trim() || !activeAgent || isGenerating}
        >
          Send
        </button>
      </div>
    </div>
  );
}
