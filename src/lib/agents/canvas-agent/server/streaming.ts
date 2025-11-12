export type StructuredStream = {
  partialObjectStream: AsyncIterable<any>;
  fullStream: Promise<{ object: any }>;
};

export async function handleStructuredStreaming(
  stream: StructuredStream,
  onDelta: (delta: any[]) => Promise<void>,
  onFinal: (finalActions: any[]) => Promise<void>,
) {
  let lastCount = 0;
  const snapshots: string[] = [];

  const recordSnapshot = (index: number, action: any) => {
    const serialized = JSON.stringify(action ?? {});
    snapshots[index] = serialized;
    return serialized;
  };

  const snapshotChanged = (index: number, action: any) => {
    const serialized = JSON.stringify(action ?? {});
    if (snapshots[index] !== serialized) {
      snapshots[index] = serialized;
      return true;
    }
    return false;
  };

  for await (const partial of stream.partialObjectStream) {
    const actions = Array.isArray(partial?.actions) ? partial.actions : [];
    if (actions.length === 0) continue;
    const delta: any[] = [];

    actions.forEach((action, index) => {
      if (index >= lastCount) {
        recordSnapshot(index, action);
        delta.push(action);
      } else if (snapshotChanged(index, action)) {
        delta.push(action);
      }
    });

    if (delta.length > 0) {
      await onDelta(delta);
    }
    if (actions.length > lastCount) {
      lastCount = actions.length;
    }
  }

  const final = await stream.fullStream;
  const all = Array.isArray(final?.object?.actions) ? final.object.actions : [];
  if (all.length === 0) {
    await onFinal([]);
    return;
  }

  // Keep local snapshot bookkeeping in sync so the next stream run doesn't
  // emit stale deltas, but always pass the full action list to onFinal.
  all.forEach((action, index) => {
    recordSnapshot(index, action);
  });

  await onFinal(all);
}
