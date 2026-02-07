'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/shared/button';
import { Card } from '@/components/ui/shared/card';
import { usePresentTheme } from '@/components/ui/system/theme-provider';

import MemoryRecallWidget from '@/components/ui/productivity/memory-recall-widget';
import { MeetingSummaryWidget } from '@/components/ui/productivity/meeting-summary-widget';
import ActionItemTracker from '@/components/ui/productivity/action-item-tracker';
import CrowdPulseWidget from '@/components/ui/productivity/crowd-pulse-widget';
import { RetroTimerEnhanced } from '@/components/ui/productivity/retro-timer-enhanced';
import DebateScorecard, { debateScoreCardSchema } from '@/components/ui/productivity/debate-scorecard';
import { LinearKanbanShowcase } from '@/components/ui/showcase/linear-kanban-showcase';
import { ContextProvider } from '@/lib/stores/context-store';

export function UiShowcaseClient() {
  const theme = usePresentTheme();

  const scorecard = debateScoreCardSchema.parse({
    topic: 'OpenAI-parity UI refactor',
    round: 'Showcase fixture',
    status: { lastAction: 'Unified tokens + widget chrome sweep', pendingVerifications: [] },
    claims: [
      {
        id: 'c1',
        side: 'AFF',
        speech: '1AC',
        quote: 'Every surface should share one tokenized language.',
        speaker: 'AFF',
        status: 'VERIFIED',
        verdict: 'ACCURATE',
        impact: 'KEY_VOTER',
        confidence: 0.85,
        evidenceCount: 3,
        upvotes: 12,
        scoreDelta: 3,
      },
      {
        id: 'c2',
        side: 'NEG',
        speech: '1NC',
        quote: 'Gradients everywhere make it feel like 2020.',
        speaker: 'NEG',
        status: 'CHECKING',
        verdict: 'PARTIALLY_TRUE',
        impact: 'MINOR',
        confidence: 0.62,
        evidenceCount: 1,
        upvotes: 4,
        scoreDelta: -1,
      },
    ],
  });

  return (
    <div className="min-h-screen bg-surface p-6 md:p-10">
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

          <ContextProvider>
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
          </ContextProvider>

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

          <div className="lg:col-span-2">
            <DebateScorecard {...scorecard} />
          </div>
        </div>
      </div>
    </div>
  );
}

