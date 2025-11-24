import { z } from 'zod';
const PATCHED_SYMBOL = Symbol.for('present.zod-meta-patched');
function applyZodMetaPatch() {
    if (globalThis[PATCHED_SYMBOL]) {
        return;
    }
    const ZodType = z.ZodType;
    if (!ZodType?.prototype) {
        return;
    }
    if (typeof ZodType.prototype.meta !== 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ZodType.prototype.meta = function meta(metadata) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const self = this;
            self._def ?? (self._def = {});
            self._def.metadata = metadata;
            return self;
        };
    }
    if (typeof ZodType.prototype.getMetadata !== 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ZodType.prototype.getMetadata = function getMetadata() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return this?._def?.metadata;
        };
    }
    globalThis[PATCHED_SYMBOL] = true;
}
applyZodMetaPatch();
export function ensureZodMeta() {
    // Backwards compatibility for callers expecting this symbol.
}
//# sourceMappingURL=zod-meta-patch.js.map