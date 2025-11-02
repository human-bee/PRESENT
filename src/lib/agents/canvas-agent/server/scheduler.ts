export type ScheduledTask = {
  id: string;
  sessionId: string;
  input: Record<string, unknown>;
  createdAt: number;
  depth: number;
};

export class SessionScheduler {
  private queues = new Map<string, ScheduledTask[]>();
  private maxDepth: number;

  constructor(opts: { maxDepth: number }) {
    this.maxDepth = Math.max(0, opts.maxDepth ?? 0);
  }

  enqueue(sessionId: string, task: { input: Record<string, unknown>; depth?: number }) {
    const queue = this.queues.get(sessionId) ?? [];
    const requestedDepth = typeof task.depth === 'number' ? task.depth : queue.length + 1;
    if (requestedDepth > this.maxDepth || queue.length >= this.maxDepth) {
      return false;
    }

    const record: ScheduledTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      input: task.input,
      createdAt: Date.now(),
      depth: requestedDepth,
    };
    queue.push(record);
    this.queues.set(sessionId, queue);
    return true;
  }

  dequeue(sessionId: string): ScheduledTask | undefined {
    const queue = this.queues.get(sessionId) ?? [];
    const next = queue.shift();
    this.queues.set(sessionId, queue);
    return next;
  }

  cancelOlderThan(sessionId: string, cutoffMs: number) {
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    this.queues.set(sessionId, queue.filter((task) => task.createdAt >= cutoffMs));
  }

  clear(sessionId: string) {
    this.queues.delete(sessionId);
  }

  depth(sessionId: string): number {
    return (this.queues.get(sessionId) ?? []).length;
  }
}

