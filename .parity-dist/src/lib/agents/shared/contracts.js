import { z } from 'zod';
import { jsonObjectSchema } from '@/lib/utils/json-schema';
export const CreateComponent = z.object({
    type: z.string(),
    spec: z.string(),
});
export const UpdateComponent = z.object({
    componentId: z.string(),
    patch: z.union([z.string(), jsonObjectSchema]),
});
export const FlowchartCommit = z.object({
    room: z.string(),
    docId: z.string(),
    prevVersion: z.number().optional(),
    format: z.enum(['streamdown', 'markdown', 'mermaid']),
    doc: z.string(),
});
//# sourceMappingURL=contracts.js.map