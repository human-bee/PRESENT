import { handleStructuredStreaming } from './streaming';

function makeStream(parts: any[]) {
  async function* partialObjectStream() {
    for (const part of parts) {
      yield part;
    }
  }
  return {
    partialObjectStream: partialObjectStream(),
    fullStream: Promise.resolve({ object: parts[parts.length - 1] ?? { actions: [] } }),
  };
}

describe('handleStructuredStreaming', () => {
  it('emits deltas and final payload', async () => {
    const calls: Array<{ type: string; payload: any }> = [];
    const stream = makeStream([
      { actions: [{ id: 1 }] },
      { actions: [{ id: 1 }, { id: 2 }] },
      { actions: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    ]);

    await handleStructuredStreaming(
      stream,
      async (delta) => calls.push({ type: 'delta', payload: delta }),
      async (final) => calls.push({ type: 'final', payload: final }),
    );

    expect(calls).toEqual([
      { type: 'delta', payload: [{ id: 1 }] },
      { type: 'delta', payload: [{ id: 2 }] },
      { type: 'final', payload: [{ id: 3 }] },
    ]);
  });
});
