/** Ownership and progress changes cannot replace a human-edited action text record. */
export function briefActionMetaPatch(actionId: string, field: 'owner' | 'status', value: string): Record<string, string> {
  if (!/^[\w-]{1,100}$/.test(actionId) || typeof value !== 'string') throw new Error('Invalid action update.');
  if (field === 'owner' && value.length <= 80) return { [`owner:${actionId}`]: value };
  if (field === 'status' && ['To do', 'Doing', 'Done'].includes(value)) return { [`status:${actionId}`]: value };
  throw new Error('Invalid action update.');
}
