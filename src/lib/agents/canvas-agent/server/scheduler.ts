export type ScheduledTask = {
  id: string;
  sessionId: string;
  input: Record<string, unknown>;
  createdAt: number;
};

export class SessionScheduler {
  private queues = new Map<string, ScheduledTask[]>();
  private maxDepth: number;

  constructor(opts: { maxDepth: number }) {
    this.maxDepth = Math.max(0, opts.maxDepth || 0);
  }

  enqueue(sessionId: string, task: Omit<ScheduledTask, 'id' | 'createdAt' | 'sessionId'>) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ScheduledTask = { id, sessionId, input: task.input, createdAt: Date.now() };
    const queue = this.queues.get(sessionId) || [];
    if (queue.length >= this.maxDepth) return false;
    queue.push(record);
    this.queues.set(sessionId, queue);
    return true;
  }

  dequeue(sessionId: string): ScheduledTask | undefined {
    const queue = this.queues.get(sessionId) || [];
    const next = queue.shift();
    this.queues.set(sessionId, queue);
    return next;
  }

  clear(sessionId: string) {
    this.queues.delete(sessionId);
  }

  depth(sessionId: string): number {
    return (this.queues.get(sessionId) || []).length;
  }
}






