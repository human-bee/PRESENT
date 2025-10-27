import { describe, it, expect } from '@jest/globals';
import { SessionScheduler } from './scheduler';

describe('SessionScheduler', () => {
  it('should enqueue and dequeue tasks', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    const enqueued = scheduler.enqueue('session-1', { input: { message: 'task 1' } });
    expect(enqueued).toBe(true);
    expect(scheduler.depth('session-1')).toBe(1);
    
    const task = scheduler.dequeue('session-1');
    expect(task).toBeDefined();
    expect(task?.input).toMatchObject({ message: 'task 1' });
    expect(scheduler.depth('session-1')).toBe(0);
  });

  it('should enforce max depth', () => {
    const scheduler = new SessionScheduler({ maxDepth: 2 });
    expect(scheduler.enqueue('session-1', { input: { message: '1' } })).toBe(true);
    expect(scheduler.enqueue('session-1', { input: { message: '2' } })).toBe(true);
    expect(scheduler.enqueue('session-1', { input: { message: '3' } })).toBe(false);
    expect(scheduler.depth('session-1')).toBe(2);
  });

  it('should maintain separate queues per session', () => {
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

  it('should return undefined when dequeuing from empty session', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    const task = scheduler.dequeue('nonexistent');
    expect(task).toBeUndefined();
  });

  it('should clear session queue', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    scheduler.enqueue('session-1', { input: { message: '1' } });
    scheduler.enqueue('session-1', { input: { message: '2' } });
    expect(scheduler.depth('session-1')).toBe(2);
    
    scheduler.clear('session-1');
    expect(scheduler.depth('session-1')).toBe(0);
  });

  it('should maintain FIFO order', () => {
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

  it('should generate unique task IDs', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    scheduler.enqueue('session-1', { input: { message: 'A' } });
    scheduler.enqueue('session-1', { input: { message: 'B' } });
    
    const t1 = scheduler.dequeue('session-1');
    const t2 = scheduler.dequeue('session-1');
    
    expect(t1?.id).toBeDefined();
    expect(t2?.id).toBeDefined();
    expect(t1?.id).not.toBe(t2?.id);
  });

  it('should attach createdAt timestamp', () => {
    const scheduler = new SessionScheduler({ maxDepth: 3 });
    const before = Date.now();
    scheduler.enqueue('session-1', { input: { message: 'test' } });
    const after = Date.now();
    
    const task = scheduler.dequeue('session-1');
    expect(task?.createdAt).toBeGreaterThanOrEqual(before);
    expect(task?.createdAt).toBeLessThanOrEqual(after);
  });
});




