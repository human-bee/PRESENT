import { fireEvent, render, screen } from '@testing-library/react';
import { AgentQueueTable } from './agent-queue-table';

describe('AgentQueueTable', () => {
  it('renders worker and failure reason columns', () => {
    const onSelectTask = jest.fn();
    render(
      <AgentQueueTable
        tasks={[
          {
            id: 'task-1',
            room: 'canvas-room-1',
            task: 'fairy.intent',
            status: 'failed',
            priority: 100,
            attempt: 2,
            trace_id: 'trace-1',
            worker_id: 'worker-1',
            last_failure_reason: 'model timeout',
            created_at: '2026-02-17T12:00:00.000Z',
          },
        ]}
        onSelectTask={onSelectTask}
      />,
    );

    expect(screen.getByText('Worker')).toBeTruthy();
    expect(screen.getByText('Failure Reason')).toBeTruthy();
    expect(screen.getByText('worker-1')).toBeTruthy();
    expect(screen.getByText('model timeout')).toBeTruthy();

    fireEvent.click(screen.getByText('fairy.intent'));
    expect(onSelectTask).toHaveBeenCalledTimes(1);
  });
});
