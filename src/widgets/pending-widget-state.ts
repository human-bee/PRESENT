type State = Record<string, unknown>;
type Pending = { requestId: string } & ({ patch: State } | { key: string; by: number });

/** Ephemeral iframe view edits. Only native state and its transaction receipts retire them. */
export function createWidgetStateView(initial: State) {
  let canonical = initial;
  let pending: Pending[] = [];
  const read = (): State => {
    const state = { ...canonical };
    for (const edit of pending) {
      if ('patch' in edit) Object.assign(state, edit.patch);
      else {
        const current = Object.hasOwn(state, edit.key) ? state[edit.key] : 0;
        if (typeof current === 'number' && Number.isFinite(current + edit.by)) state[edit.key] = current + edit.by;
      }
    }
    return state;
  };
  return {
    read,
    add: (edit: Pending) => { pending.push(edit); return read(); },
    receive: (state: State, receipts: string[]) => {
      canonical = state;
      const acknowledged = new Set(receipts);
      pending = pending.filter(edit => !acknowledged.has(edit.requestId));
      return read();
    },
    reject: (requestId: string) => { pending = pending.filter(edit => edit.requestId !== requestId); return read(); },
  };
}
