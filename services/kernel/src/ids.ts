import { randomUUID } from 'node:crypto';

export const RESET_ID_PREFIXES = {
  workspaceSession: 'ws',
  executorSession: 'exec',
  taskRun: 'task',
  artifact: 'artifact',
  approval: 'approval',
  presence: 'presence',
  trace: 'trace',
  event: 'evt',
  modelProfile: 'profile',
} as const;

export function createResetId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
