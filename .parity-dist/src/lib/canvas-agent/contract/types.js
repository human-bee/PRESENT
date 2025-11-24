import { z } from 'zod';
import { TEACHER_ACTIONS } from './teacher';
export const ACTION_VERSION = 'tldraw-actions/1';
export const LEGACY_ACTION_NAMES = [
    'create_shape',
    'update_shape',
    'delete_shape',
    'move',
    'resize',
    'rotate',
    'group',
    'ungroup',
    'align',
    'distribute',
    'stack',
    'reorder',
    'think',
    'todo',
    'add_detail',
    'set_viewport',
    'apply_preset',
    'message',
];
if (TEACHER_ACTIONS.length === 0) {
    throw new Error('Teacher contract must define at least one action. Did you run scripts/gen-agent-contract.ts?');
}
const teacherActionTuple = TEACHER_ACTIONS;
const LegacyActionNameSchema = z.enum(LEGACY_ACTION_NAMES);
const TeacherActionNameSchema = z.enum(teacherActionTuple);
export const ActionNameSchema = z.union([LegacyActionNameSchema, TeacherActionNameSchema]);
export const AgentActionSchema = z.object({
    id: z.string(),
    name: ActionNameSchema,
    params: z.unknown(),
});
export const AgentActionEnvelopeSchema = z.object({
    v: z.literal(ACTION_VERSION),
    sessionId: z.string(),
    seq: z.number().int().nonnegative(),
    partial: z.boolean().optional(),
    actions: z.array(AgentActionSchema).min(1),
    ts: z.number().int(),
});
//# sourceMappingURL=types.js.map