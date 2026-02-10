'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/shared/button';
import { Card } from '@/components/ui/shared/card';
import { usePresentTheme } from '@/components/ui/system/theme-provider';

import MemoryRecallWidget from '@/components/ui/productivity/memory-recall-widget';
import { MeetingSummaryWidget } from '@/components/ui/productivity/meeting-summary-widget';
import ActionItemTracker from '@/components/ui/productivity/action-item-tracker';
import CrowdPulseWidget from '@/components/ui/productivity/crowd-pulse-widget';
import { RetroTimerEnhanced } from '@/components/ui/productivity/retro-timer-enhanced';
import { LinearKanbanShowcase } from '@/components/ui/showcase/linear-kanban-showcase';
import { ContextProvider } from '@/lib/stores/context-store';
import { ResearchPanel } from '@/components/ui/research/research-panel';
import { RoomConnectorUI } from '@/components/ui/livekit/components/RoomConnectorUI';
import type { LivekitRoomConnectorState } from '@/components/ui/livekit/hooks/types';
import { SpeechTranscriptionView } from '@/components/ui/canvas/speech-transcription-view';
import { ToolDispatcherStub } from '@/components/tool-dispatcher/tool-dispatcher-stub';

export function UiShowcaseClient() {
  const theme = usePresentTheme();
  // Deterministic timestamps avoid SSR/CSR hydration mismatches on this page.
  const baseTimeMs = Date.parse('2026-02-08T00:00:00.000Z');

  const sampleResearchResults = [
    {
      id: 'r1',
      title: 'Neutral primaries, copper highlight',
      content:
        'Keep primary surfaces neutral and reserve copper for focus rings, selection, and active states.',
      source: {
        name: 'Present Design Notes',
        url: 'https://example.invalid',
        credibility: 'high' as const,
        type: 'other' as const,
      },
      relevance: 92,
      timestamp: new Date(baseTimeMs - 60_000).toISOString(),
      tags: ['tokens', 'a11y'],
      factCheck: { status: 'verified' as const, confidence: 90 },
    },
    {
      id: 'r2',
      title: 'TLDraw chrome should inherit app tokens',
      content:
        'Bridge TLDraw variables to the same token set so menus/toolbars look like the rest of the product.',
      source: {
        name: 'Internal Docs',
        url: 'https://example.invalid',
        credibility: 'medium' as const,
        type: 'wiki' as const,
      },
      relevance: 81,
      timestamp: new Date(baseTimeMs - 5 * 60_000).toISOString(),
      tags: ['tldraw', 'ui'],
      factCheck: { status: 'unverified' as const, confidence: 55 },
    },
  ];

  const connectorStates: Array<{ label: string; state: LivekitRoomConnectorState }> = [
    {
      label: 'Disconnected',
      state: {
        connectionState: 'disconnected',
        isMinimized: false,
        participantCount: 0,
        errorMessage: null,
        token: null,
        agentStatus: 'not-requested',
        agentIdentity: null,
      },
    },
    {
      label: 'Connecting',
      state: {
        connectionState: 'connecting',
        isMinimized: false,
        participantCount: 0,
        errorMessage: null,
        token: 'token',
        agentStatus: 'dispatching',
        agentIdentity: null,
      },
    },
    {
      label: 'Connected',
      state: {
        connectionState: 'connected',
        isMinimized: false,
        participantCount: 3,
        errorMessage: null,
        token: 'token',
        agentStatus: 'joined',
        agentIdentity: 'voice-agent',
      },
    },
    {
      label: 'Error',
      state: {
        connectionState: 'error',
        isMinimized: false,
        participantCount: 0,
        errorMessage: 'Failed to connect. Check LiveKit credentials.',
        token: null,
        agentStatus: 'failed',
        agentIdentity: null,
      },
    },
  ];

  return (
    <ContextProvider>
      <ToolDispatcherStub>
        <div className="min-h-screen bg-surface p-6 md:p-10" data-present-showcase-mounted="true">
          <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-tertiary">UI Showcase</div>
            <h1 className="text-2xl md:text-3xl font-semibold text-primary">Present 2026 surfaces</h1>
            <p className="text-sm text-secondary mt-2">
              Tokenized primitives, copper highlight, and consistent widget chrome.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => theme.setMode('system')}>
              System
            </Button>
            <Button variant="outline" size="sm" onClick={() => theme.setMode('light')}>
              Light
            </Button>
            <Button variant="outline" size="sm" onClick={() => theme.setMode('dark')}>
              Dark
            </Button>
            <div className="w-px h-6 bg-border" />
            <Link
              href="/canvas"
              className="inline-flex items-center justify-center rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            >
              Open Canvas
            </Link>
            <Link
              href="/mcp-config"
              className="inline-flex items-center justify-center rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            >
              MCP Config
            </Link>
            <Link
              href="/auth/signin"
              className="inline-flex items-center justify-center rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            >
              Sign In
            </Link>
          </div>
        </header>

        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-secondary">Theme mode:</div>
            <div className="text-sm font-medium text-primary">{theme.mode}</div>
            <div className="text-sm text-secondary">Resolved:</div>
            <div className="text-sm font-medium text-primary">{theme.resolved}</div>
            <div className="ml-auto text-xs text-tertiary">
              Tip: Screenshots are captured for both light/dark.
            </div>
          </div>
        </Card>

	        <div className="grid gap-6 lg:grid-cols-2">
          <MemoryRecallWidget
            title="Memory Recall"
            query="What did we decide about copper accents?"
            results={[
              { id: 'r1', text: 'Accent strategy: neutral primaries; copper for focus + selection.' },
              { id: 'r2', text: 'Canvas review: unify borders, radii, and menu surfaces.' },
            ]}
          />

          <MeetingSummaryWidget
            title="Meeting Summary"
            summary="We standardized UI tokens, bridged TLDraw variables, and started the widget chrome migration sweep."
            highlights={[
              'Apps SDK UI is the baseline for tokens and primitives.',
              'Copper highlight is reserved for focus + selection states.',
            ]}
            actionItems={[
              { task: 'Finish productivity widget chrome sweep', owner: 'You' },
              { task: 'Capture screenshots + render Remotion showcase', owner: 'Bea' },
            ]}
            decisions={[
              'Apps SDK UI tokens are the single source of truth.',
              'Copper highlight only for focus/selection.',
            ]}
          />

          <ActionItemTracker title="Action Item Tracker" />

          <CrowdPulseWidget
            title="Crowd Pulse"
            prompt="Live room vibe"
            status="counting"
            demoMode={true}
            handCount={7}
            peakCount={12}
            confidence={0.78}
            noiseLevel={0.41}
            activeQuestion="Can we ship this without breaking TLDraw?"
            questions={[
              { id: 'q1', text: 'Does dark mode persist?', votes: 9, tags: ['theme'] },
              { id: 'q2', text: 'Are focus rings consistent?', votes: 6, tags: ['a11y'] },
            ]}
            scoreboard={[
              { label: 'Engagement', score: 82, delta: 4 },
              { label: 'Clarity', score: 74, delta: 2 },
            ]}
            followUps={['Audit remaining widget modals', 'Add snapshot coverage for /showcase/ui']}
            sensorEnabled={false}
            showPreview={false}
          />

          <RetroTimerEnhanced title="Retro Timer (Enhanced)" initialMinutes={5} showPresets={true} />

	          <LinearKanbanShowcase className="lg:col-span-2" />
	        </div>

          <div className="pt-6">
            <div className="text-xs uppercase tracking-[0.25em] text-tertiary">Canvas Widgets</div>
            <h2 className="mt-2 text-xl font-semibold text-primary">Tokenized canvas chrome</h2>
            <p className="mt-2 text-sm text-secondary">
              Research panel, LiveKit connector states, and speech transcription view without LiveKit.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ResearchPanel
              title="Research"
              results={sampleResearchResults as any}
              currentTopic="OpenAI parity design"
              isLive={true}
              maxResults={10}
              showCredibilityFilter={true}
            />

            <div className="space-y-4">
              <Card className="p-4">
                <div className="text-sm font-medium text-primary mb-3">LiveKit Room Connector</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {connectorStates.map(({ label, state }) => (
                    <div key={label} className="space-y-2">
                      <div className="text-xs text-tertiary">{label}</div>
                      <RoomConnectorUI
                        state={state}
                        roomName="demo-room"
                        onMinimize={() => {}}
                        onConnect={() => {}}
                        onDisconnect={() => {}}
                        onCopyLink={() => {}}
                        onRequestAgent={() => {}}
                      />
                    </div>
                  ))}
                </div>
              </Card>

              <SpeechTranscriptionView
                tone="success"
                statusText="Agent active and listening"
                roomConnected={true}
                agentIdentity="voice-agent"
                isListening={true}
                canStart={true}
                transcriptions={[
                  {
                    id: 't1',
                    speaker: 'you',
                    text: 'Can you summarize the design changes?',
                    timestamp: baseTimeMs - 15_000,
                    isFinal: true,
                    source: 'user',
                  },
                  {
                    id: 't2',
                    speaker: 'voice-agent',
                    text: 'Yep. All widgets now share tokenized surfaces and consistent focus rings.',
                    timestamp: baseTimeMs - 8_000,
                    isFinal: true,
                    source: 'agent',
                  },
                ]}
                onClear={() => {}}
                onStartListening={() => {}}
                onStopListening={() => {}}
              />
            </div>
          </div>
	        </div>
	      </div>
      </ToolDispatcherStub>
    </ContextProvider>
  );
}
