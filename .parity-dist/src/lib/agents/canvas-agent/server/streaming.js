import { StructuredActionBuffer } from './structured-buffer';
export async function handleStructuredStreaming(stream, onDelta, onFinal) {
    const buffer = new StructuredActionBuffer();
    for await (const partial of stream.partialObjectStream) {
        const actions = Array.isArray(partial?.actions) ? partial.actions : [];
        if (actions.length === 0)
            continue;
        const completed = buffer.ingest(actions);
        if (completed.length > 0) {
            await onDelta(completed);
        }
    }
    const final = await stream.fullStream;
    const all = Array.isArray(final?.object?.actions) ? final.object.actions : [];
    const pending = buffer.finalize(all);
    await onFinal(pending);
}
//# sourceMappingURL=streaming.js.map