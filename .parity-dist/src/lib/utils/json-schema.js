import { z } from 'zod';
const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const jsonValueSchema = z.lazy(() => z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)]));
export const jsonObjectSchema = z.record(jsonValueSchema);
//# sourceMappingURL=json-schema.js.map