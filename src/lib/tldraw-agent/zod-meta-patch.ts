import { z } from 'zod'

const PATCHED_SYMBOL = Symbol.for('present.zod-meta-patched')

function applyZodMetaPatch() {
	if ((globalThis as Record<string | symbol, unknown>)[PATCHED_SYMBOL]) {
		return
	}

	const ZodType = (z as unknown as { ZodType?: { prototype: Record<string, unknown> } }).ZodType
	if (!ZodType?.prototype) {
		return
	}

	if (typeof ZodType.prototype.meta !== 'function') {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		ZodType.prototype.meta = function meta(metadata: unknown) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const self = this as any
			self._def ??= {}
			self._def.metadata = metadata
			return self
		}
	}

	if (typeof ZodType.prototype.getMetadata !== 'function') {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		ZodType.prototype.getMetadata = function getMetadata() {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (this as any)?._def?.metadata
		}
	}

	(globalThis as Record<string | symbol, unknown>)[PATCHED_SYMBOL] = true
}

applyZodMetaPatch()

export function ensureZodMeta() {
	// Backwards compatibility for callers expecting this symbol.
}
