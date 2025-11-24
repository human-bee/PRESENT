const defaultCompletionPredicate = (action) => Boolean(action && typeof action === 'object' && action.complete === true);
export class StructuredActionBuffer {
    constructor(options) {
        this.actions = [];
        this.emittedIndices = new Set();
        this.isActionComplete = options?.isActionComplete ?? defaultCompletionPredicate;
    }
    ingest(partialActions) {
        if (!Array.isArray(partialActions) || partialActions.length === 0) {
            return [];
        }
        this.actions = partialActions.map((action) => (action ? { ...action } : action));
        const completed = [];
        const lastIndex = this.actions.length - 1;
        this.actions.forEach((action, index) => {
            if (this.emittedIndices.has(index)) {
                return;
            }
            const predicateComplete = this.isActionComplete(action);
            const sequentialComplete = index < lastIndex;
            if (predicateComplete || sequentialComplete) {
                this.emittedIndices.add(index);
                completed.push(action);
            }
        });
        return completed;
    }
    finalize(finalActions) {
        if (!Array.isArray(finalActions) || finalActions.length === 0) {
            return [];
        }
        this.actions = finalActions.map((action) => (action ? { ...action } : action));
        const pending = [];
        this.actions.forEach((action, index) => {
            if (this.emittedIndices.has(index)) {
                return;
            }
            this.emittedIndices.add(index);
            pending.push(action);
        });
        return pending;
    }
    getAll() {
        return this.actions.slice();
    }
}
//# sourceMappingURL=structured-buffer.js.map