export class SessionScheduler {
    constructor(opts) {
        this.queues = new Map();
        this.maxDepth = Math.max(0, opts.maxDepth ?? 0);
    }
    enqueue(sessionId, task) {
        const queue = this.queues.get(sessionId) ?? [];
        const requestedDepth = typeof task.depth === 'number' ? task.depth : queue.length + 1;
        if (requestedDepth > this.maxDepth || queue.length >= this.maxDepth) {
            return false;
        }
        const record = {
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
    dequeue(sessionId) {
        const queue = this.queues.get(sessionId) ?? [];
        const next = queue.shift();
        this.queues.set(sessionId, queue);
        return next;
    }
    cancelOlderThan(sessionId, cutoffMs) {
        const queue = this.queues.get(sessionId);
        if (!queue)
            return;
        this.queues.set(sessionId, queue.filter((task) => task.createdAt >= cutoffMs));
    }
    clear(sessionId) {
        this.queues.delete(sessionId);
    }
    depth(sessionId) {
        return (this.queues.get(sessionId) ?? []).length;
    }
}
//# sourceMappingURL=scheduler.js.map