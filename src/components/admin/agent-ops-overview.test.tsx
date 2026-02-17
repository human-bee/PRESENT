import { render, screen } from '@testing-library/react';
import { AgentOpsOverview } from './agent-ops-overview';

describe('AgentOpsOverview', () => {
  it('labels queue counts as tasks and shows active workers', () => {
    render(
      <AgentOpsOverview
        overview={{
          ok: true,
          actorUserId: 'user-1',
          queue: {
            queued: 2,
            running: 3,
            failed: 1,
            succeeded: 4,
            canceled: 0,
          },
          tracesLastHour: 9,
          activeWorkers: 2,
          workers: [],
          generatedAt: '2026-02-17T12:00:00.000Z',
          queueOldestQueuedAgeMs: 12_000,
        }}
      />,
    );

    expect(screen.getByText('Running Tasks')).toBeTruthy();
    expect(screen.getByText('Active Workers')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);
  });
});
