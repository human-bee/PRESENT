import type { ToolJob, ToolQueueState } from './toolTypes';

export type QueueAction =
  | { type: 'ENQUEUE'; job: ToolJob }
  | { type: 'START'; id: string; startedAt: number }
  | { type: 'COMPLETE'; id: string; finishedAt: number; message?: string }
  | { type: 'ERROR'; id: string; finishedAt: number; error: string }
  | { type: 'RESET' };

export const initialQueueState: ToolQueueState = {
  jobs: [],
};

export function queueReducer(state: ToolQueueState, action: QueueAction): ToolQueueState {
  switch (action.type) {
    case 'ENQUEUE':
      return {
        jobs: [...state.jobs, action.job],
      };
    case 'START':
      return {
        jobs: state.jobs.map((job) =>
          job.id === action.id
            ? { ...job, status: 'running', startedAt: action.startedAt }
            : job,
        ),
      };
    case 'COMPLETE':
      return {
        jobs: state.jobs.map((job) =>
          job.id === action.id
            ? {
                ...job,
                status: 'succeeded',
                finishedAt: action.finishedAt,
                message: action.message ?? job.message,
              }
            : job,
        ),
      };
    case 'ERROR':
      return {
        jobs: state.jobs.map((job) =>
          job.id === action.id
            ? {
                ...job,
                status: 'error',
                finishedAt: action.finishedAt,
                message: action.error,
              }
            : job,
        ),
      };
    case 'RESET':
      return initialQueueState;
    default:
      return state;
  }
}

export function createQueueJob(id: string, tool: string, createdAt: number): ToolJob {
  return {
    id,
    tool,
    status: 'queued',
    createdAt,
  };
}
