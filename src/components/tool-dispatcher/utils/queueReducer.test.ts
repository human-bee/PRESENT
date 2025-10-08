import { createQueueJob, initialQueueState, queueReducer } from './queueReducer';

describe('queueReducer', () => {
  it('enqueues jobs and marks lifecycle transitions', () => {
    const createdAt = Date.now();
    const job = createQueueJob('job-1', 'test_tool', createdAt);
    let state = queueReducer(initialQueueState, { type: 'ENQUEUE', job });
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].status).toBe('queued');

    state = queueReducer(state, { type: 'START', id: 'job-1', startedAt: createdAt + 10 });
    expect(state.jobs[0].status).toBe('running');

    state = queueReducer(state, {
      type: 'COMPLETE',
      id: 'job-1',
      finishedAt: createdAt + 20,
      message: 'done',
    });
    expect(state.jobs[0].status).toBe('succeeded');
    expect(state.jobs[0].message).toBe('done');
  });

  it('records errors', () => {
    const job = createQueueJob('job-2', 'tool', Date.now());
    let state = queueReducer(initialQueueState, { type: 'ENQUEUE', job });
    state = queueReducer(state, { type: 'ERROR', id: 'job-2', finishedAt: Date.now(), error: 'boom' });
    expect(state.jobs[0].status).toBe('error');
    expect(state.jobs[0].message).toBe('boom');
  });
});
