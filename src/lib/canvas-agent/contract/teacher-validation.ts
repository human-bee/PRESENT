import { z, type ZodIssue, type ZodTypeAny } from 'zod';
import { actionParamSchemas } from './parsers';
import { TEACHER_ACTIONS, type TeacherActionName } from './teacher';

const validatorByAction = new Map<TeacherActionName, ZodTypeAny>();

const rawTeacherSchemas: Partial<Record<TeacherActionName, ZodTypeAny>> = {
  message: z.object({ text: z.string().min(1) }).passthrough(),
  move: z.object({ shapeId: z.string().min(1), x: z.number().finite(), y: z.number().finite() }).passthrough(),
  create: z
    .object({
      shape: z
        .object({
          _type: z.string().min(1),
        })
        .passthrough(),
    })
    .passthrough(),
  update: z
    .object({
      update: z
        .object({
          shapeId: z.string().min(1),
        })
        .passthrough(),
    })
    .passthrough(),
  delete: z.object({ shapeId: z.string().min(1) }).passthrough(),
  pen: z
    .object({
      points: z
        .array(
          z
            .object({
              x: z.number().finite(),
              y: z.number().finite(),
            })
            .passthrough(),
        )
        .min(2),
    })
    .passthrough(),
};

TEACHER_ACTIONS.forEach((name) => {
  const rawSchema = rawTeacherSchemas[name];
  if (rawSchema) {
    validatorByAction.set(name, rawSchema);
  }
});

TEACHER_ACTIONS.forEach((name) => {
  if (validatorByAction.has(name)) return;
  const fallback = actionParamSchemas[name];
  if (fallback && typeof fallback.safeParse === 'function') {
    validatorByAction.set(name, fallback);
  }
});

const missingValidators = TEACHER_ACTIONS.filter((name) => !validatorByAction.has(name));
if (missingValidators.length > 0) {
  console.warn('[CanvasAgent:TeacherValidationCoverage] missing validators', missingValidators);
}

export const teacherValidationCoverage = {
  validated: Array.from(validatorByAction.keys()),
  missing: missingValidators,
};

export type TeacherValidationResult =
  | { ok: true }
  | { ok: false; issues: ZodIssue[] };

export function validateTeacherActionPayload(name: TeacherActionName, payload: unknown): TeacherValidationResult {
  const validator = validatorByAction.get(name);
  if (!validator) {
    return { ok: true };
  }
  const parsed = validator.safeParse(payload);
  if (parsed.success) return { ok: true };
  return { ok: false, issues: parsed.error.issues };
}
