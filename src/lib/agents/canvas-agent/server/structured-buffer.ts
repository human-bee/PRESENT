export type StructuredAction = Record<string, unknown>;

export class StructuredActionBuffer {
  private snapshots: Map<number, string> = new Map();
  private actions: StructuredAction[] = [];

  ingest(partialActions: StructuredAction[]): StructuredAction[] {
    if (!Array.isArray(partialActions) || partialActions.length === 0) {
      return [];
    }

    const deltas: StructuredAction[] = [];

    partialActions.forEach((action, index) => {
      const serialized = JSON.stringify(action ?? {});
      if (!this.snapshots.has(index)) {
        this.snapshots.set(index, serialized);
        this.actions[index] = action;
        deltas.push(action);
        return;
      }

      if (this.snapshots.get(index) !== serialized) {
        this.snapshots.set(index, serialized);
        this.actions[index] = action;
        deltas.push(action);
      }
    });

    if (this.actions.length < partialActions.length) {
      this.actions.length = partialActions.length;
    }

    return deltas;
  }

  finalize(finalActions: StructuredAction[]): StructuredAction[] {
    if (Array.isArray(finalActions)) {
      this.actions = finalActions.slice();
      this.snapshots.clear();
      this.actions.forEach((action, index) => {
        this.snapshots.set(index, JSON.stringify(action ?? {}));
      });
    }
    return this.actions.slice();
  }

  getAll() {
    return this.actions.slice();
  }
}
