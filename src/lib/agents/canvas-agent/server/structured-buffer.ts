export type StructuredAction = Record<string, unknown>;

type StructuredBufferOptions = {
  isActionComplete?: (action: StructuredAction) => boolean;
};

const defaultCompletionPredicate = (action: StructuredAction) =>
  Boolean(action && typeof action === 'object' && (action as { complete?: boolean }).complete === true);

export class StructuredActionBuffer {
  private actions: StructuredAction[] = [];
  private emittedIndices = new Set<number>();
  private readonly isActionComplete: (action: StructuredAction) => boolean;

  constructor(options?: StructuredBufferOptions) {
    this.isActionComplete = options?.isActionComplete ?? defaultCompletionPredicate;
  }

  ingest(partialActions: StructuredAction[]): StructuredAction[] {
    if (!Array.isArray(partialActions) || partialActions.length === 0) {
      return [];
    }

    this.actions = partialActions.map((action) => (action ? { ...action } : action));
    const completed: StructuredAction[] = [];
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

  finalize(finalActions: StructuredAction[]): StructuredAction[] {
    if (!Array.isArray(finalActions) || finalActions.length === 0) {
      return [];
    }
    this.actions = finalActions.map((action) => (action ? { ...action } : action));
    const pending: StructuredAction[] = [];
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
