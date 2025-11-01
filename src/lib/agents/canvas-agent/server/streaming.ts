export type StructuredStream = {
  partialObjectStream: AsyncIterable<any>;
  fullStream: Promise<{ object: any }>;
};

export async function handleStructuredStreaming(
  stream: StructuredStream,
  onDelta: (delta: any[]) => Promise<void>,
  onFinal: (finalActions: any[]) => Promise<void>,
) {
  let last = 0;
  for await (const partial of stream.partialObjectStream) {
    const actions = partial?.actions ?? [];
    if (Array.isArray(actions) && actions.length > last) {
      const delta = actions.slice(last);
      await onDelta(delta);
      last = actions.length;
    }
  }
  const final = await stream.fullStream;
  const all = final?.object?.actions ?? [];
  if (Array.isArray(all) && all.length > last) {
    await onFinal(all);
  } else if (Array.isArray(all) && all.length > 0 && last === all.length) {
    await onFinal(all);
  } else if (!Array.isArray(all)) {
    await onFinal([]);
  }
}

