import { z } from 'zod';
import type * as Y from 'yjs';
import { interviewAssetSchema } from '@present/contracts/interview-studio';
import type { InterviewRole } from '@present/contracts/interviews';
import { addBriefActivity } from '@/lib/interviews/document';
import { InterviewError } from './interview-store';

export const materialInputSchema = interviewAssetSchema.omit({ id: true, createdAt: true, createdBy: true, fileId: true, mime: true, bytes: true });
const shape = interviewAssetSchema.shape;
// Update fields must not inherit creation defaults: an omitted field stays unchanged.
const materialChangesSchema = z.object({
  title: shape.title, text: shape.text.removeDefault(), caption: shape.caption.removeDefault(),
  included: shape.included.removeDefault(), field: shape.field.removeDefault(),
  x: shape.x.removeDefault(), y: shape.y.removeDefault(),
}).partial();
export const assetMutationSchemas = [
  z.object({ action: z.literal('asset-add'), asset: materialInputSchema }),
  z.object({ action: z.literal('asset-update'), id: z.string().uuid(), changes: materialChangesSchema }),
  z.object({ action: z.literal('asset-remove'), id: z.string().uuid() }),
] as const;
const schema = z.discriminatedUnion('action', assetMutationSchemas);
export type AssetMutation = z.infer<typeof schema>;
export function applyAssetMutation(doc: Y.Doc, role: InterviewRole, mutation: AssetMutation) {
  const materials = doc.getMap('assets');
  if (mutation.action === 'asset-add') {
    if (['resume', 'image'].includes(mutation.asset.kind)) throw new InterviewError(400, 'Upload a file for this material.');
    if (!['note', 'workboard'].includes(mutation.asset.kind) && !mutation.asset.url) throw new InterviewError(400, 'Add a link for this material.');
    const id = crypto.randomUUID();
    materials.set(id, { ...mutation.asset, id, createdBy: role, createdAt: Date.now() });
    addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} added ${mutation.asset.title}.`);
    return;
  }
  const existing = materials.get(mutation.id);
  if (!existing) throw new InterviewError(404, 'This material is unavailable.');
  const asset = interviewAssetSchema.parse(existing);
  if (mutation.action === 'asset-remove') materials.delete(asset.id);
  else materials.set(asset.id, { ...asset, ...mutation.changes });
  addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} ${mutation.action === 'asset-remove' ? 'removed' : 'updated'} ${asset.title}.`);
}
