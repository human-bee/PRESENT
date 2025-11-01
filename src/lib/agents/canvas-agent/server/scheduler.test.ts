import { describe, it, expect } from '@jest/globals';
import { SessionScheduler } from './scheduler';

describe('SessionScheduler', () => {
  it('enqueues tasks with depth tracking', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    const enqueued = scheduler.enqueue('session-1', { input: { message: 'task 1' } });
    expect(enqueued).toBe(true);
    expect(scheduler.depth('session-1')).toBe(1);
    
    const task = scheduler.dequeue('session-1');
    expect(task).toBeDefined();
    expect(task?.input).toMatchObject({ message: 'task 1' });
    expect(task?.depth).toBe(1);
    expect(scheduler.depth('session-1')).toBe(0);
  });

  it('enforces max depth for outstanding tasks', () => {
    const scheduler = new SessionScheduler({ maxDepth: 2 });
    expect(scheduler.enqueue('session-1', { input: { message: '1' } })).toBe(true);
    expect(scheduler.enqueue('session-1', { input: { message: '2' } })).toBe(true);
    expect(scheduler.enqueue('session-1', { input: { message: '3' } })).toBe(false);
    expect(scheduler.depth('session-1')).toBe(2);
  });

  it('maintains separate queues per session', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    scheduler.enqueue('session-1', { input: { message: 'A' } });
    scheduler.enqueue('session-2', { input: { message: 'B' } });
    
    expect(scheduler.depth('session-1')).toBe(1);
    expect(scheduler.depth('session-2')).toBe(1);
    
    const task1 = scheduler.dequeue('session-1');
    expect(task1?.input).toMatchObject({ message: 'A' });
    expect(scheduler.depth('session-1')).toBe(0);
    expect(scheduler.depth('session-2')).toBe(1);
  });

  it('returns undefined when dequeuing from empty session', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    const task = scheduler.dequeue('nonexistent');
    expect(task).toBeUndefined();
  });

  it('clears session queue', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    scheduler.enqueue('session-1', { input: { message: '1' } });
    scheduler.enqueue('session-1', { input: { message: '2' } });
    expect(scheduler.depth('session-1')).toBe(2);
    
    scheduler.clear('session-1');
    expect(scheduler.depth('session-1')).toBe(0);
  });

  it('maintains FIFO order', () => {
    const scheduler = new SessionScheduler({ maxDepth: 5 });
    scheduler.enqueue('session-1', { input: { order: 1 } });
    scheduler.enqueue('session-1', { input: { order: 2 } });
    scheduler.enqueue('session-1', { input: { order: 3 } });
    
    const t1 = scheduler.dequeue('session-1');
    const t2 = scheduler.dequeue('session-1');
    const t3 = scheduler.dequeue('session-1');
    
    expect((t1?.input as any).order).toBe(1);
    expect((t2?.input as any).order).toBe(2);
    expect((t3?.input as any).order).toBe(3);
  });

  it('generates unique task IDs', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    scheduler.enqueue('session-1', { input: { message: 'A' } });
    scheduler.enqueue('session-1', { input: { message: 'B' } });
    
    const t1 = scheduler.dequeue('session-1');
    const t2 = scheduler.dequeue('session-1');
    
    expect(t1?.id).toBeDefined();
    expect(t2?.id).toBeDefined();
    expect(t1?.id).not.toBe(t2?.id);
  });

  it('attaches createdAt timestamp', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    const before = Date.now();
    scheduler.enqueue('session-1', { input: { message: 'test' } });
    const after = Date.now();
    
    const task = scheduler.dequeue('session-1');
    expect(task?.createdAt).toBeGreaterThanOrEqual(before);
    expect(task?.createdAt).toBeLessThanOrEqual(after);
  });

  it('cancels tasks older than cutoff', async () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    scheduler.enqueue('session-1', { input: { message: 'first' } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cutoff = Date.now();
    scheduler.enqueue('session-1', { input: { message: 'second' } });
    scheduler.cancelOlderThan('session-1', cutoff);
    const task = scheduler.dequeue('session-1');
    expect(task?.input).toMatchObject({ message: 'second' });
    expect(task?.depth).toBe(2);
  });
});

