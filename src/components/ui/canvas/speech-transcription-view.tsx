'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { WidgetFrame } from '@/components/ui/productivity/widget-frame';
import { Button } from '@/components/ui/shared/button';
import { AudioLines, Mic, MicOff, Trash2 } from 'lucide-react';

export interface SpeechTranscriptionViewTranscription {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  source: 'agent' | 'user';
}

export type SpeechTranscriptionViewTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface SpeechTranscriptionViewProps {
  className?: string;
  isListening: boolean;
  tone: SpeechTranscriptionViewTone;
  statusText: string;
  roomConnected: boolean;
  agentIdentity?: string | null;
  canStart: boolean;
  transcriptions: SpeechTranscriptionViewTranscription[];
  onClear: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
}

function toneTextClass(tone: SpeechTranscriptionViewTone): string {
  switch (tone) {
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    case 'danger':
      return 'text-danger';
    case 'neutral':
    default:
      return 'text-tertiary';
  }
}

export function SpeechTranscriptionView({
  className,
  isListening,
  tone,
  statusText,
  roomConnected,
  agentIdentity,
  canStart,
  transcriptions,
  onClear,
  onStartListening,
  onStopListening,
}: SpeechTranscriptionViewProps) {
  const toneClass = toneTextClass(tone);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [transcriptions.length]);

  return (
    <div className={cn('w-full', className)}>
      <WidgetFrame
        title={
          <div className="flex items-center gap-2">
            <AudioLines className="h-4 w-4 text-[var(--present-accent)]" />
            <span>Speech Transcription</span>
          </div>
        }
        meta={
          <span className="inline-flex items-center gap-2">
            <span className={cn('inline-flex items-center gap-2', toneClass)}>
              <span className="h-2 w-2 rounded-full bg-current" />
              {statusText}
            </span>
            {roomConnected ? <span className="text-tertiary">Room connected</span> : null}
            {agentIdentity ? <span className="text-tertiary">Agent: {agentIdentity}</span> : null}
          </span>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={onClear} className="hover:bg-surface-secondary">
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
        }
      >
        <div className="flex items-center justify-center gap-3">
          {!isListening ? (
            <Button onClick={onStartListening} disabled={!canStart}>
              <Mic className="h-4 w-4" /> Start Listening
            </Button>
          ) : (
            <Button variant="destructive" onClick={onStopListening}>
              <MicOff className="h-4 w-4" /> Stop Listening
            </Button>
          )}
        </div>

        <div
          ref={containerRef}
          className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-default bg-surface p-3"
        >
          {transcriptions.length === 0 ? (
            <div className="py-6 text-center text-sm text-tertiary">No transcriptions yet.</div>
          ) : (
            <div className="space-y-3">
              {transcriptions.map((t) => (
                <div key={t.id} className="rounded-lg border border-default bg-surface-elevated p-3">
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 truncate font-medium text-secondary">{t.speaker}</div>
                    <div className="shrink-0 text-tertiary">
                      {new Date(t.timestamp).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="text-sm text-primary">{t.text}</div>
                  {!t.isFinal ? (
                    <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-tertiary">
                      interim
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </WidgetFrame>
    </div>
  );
}

