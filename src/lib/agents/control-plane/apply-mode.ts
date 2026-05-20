import type { ApplyMode } from './types';

const APPLY_MODE_BY_PATH: Array<{ prefix: string; mode: ApplyMode }> = [
  { prefix: 'knobs.conductor.taskLeaseTtlMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskIdlePollMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskIdlePollMaxMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskMaxRetryAttempts', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskRetryBaseDelayMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskRetryMaxDelayMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskRetryJitterRatio', mode: 'restart_required' },
  { prefix: 'knobs.conductor.roomConcurrency', mode: 'next_session' },
  { prefix: 'knobs.voice', mode: 'next_session' },
  { prefix: 'models.voiceRealtime', mode: 'next_session' },
  { prefix: 'models.voiceRealtimePrimary', mode: 'next_session' },
  { prefix: 'models.voiceRealtimeSecondary', mode: 'next_session' },
  { prefix: 'models.voiceRouter', mode: 'next_session' },
  { prefix: 'models.voiceStt', mode: 'next_session' },
  { prefix: 'knobs.voice.realtimeModelStrategy', mode: 'next_session' },
];

export const resolveApplyModeForPath = (path: string): ApplyMode => {
  for (const entry of APPLY_MODE_BY_PATH) {
    if (path.startsWith(entry.prefix)) return entry.mode;
  }
  return 'live';
};
