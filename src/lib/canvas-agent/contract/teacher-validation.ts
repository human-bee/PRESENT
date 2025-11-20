import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import teacherContract from '../../../../generated/agent-contract.json';
import { TEACHER_ACTIONS, type TeacherActionName } from './teacher';

const ajv = new Ajv({ allErrors: true, strict: false });

type TeacherSchemaEntry = (typeof teacherContract)['actions'][number];

const validatorByAction = new Map<TeacherActionName, ValidateFunction>();
// TLDraw's generator emits JSON Pointer-like paths that start with
// `properties/actions/items/...`. Ajv expects canonical `#/definitions/...`
// references, so we rewrite them during normalization.
const ACTION_REF_PREFIX = 'properties/actions/items/';

const cloneSchema = <T>(schema: T): T => {
  if (typeof (globalThis as any).structuredClone === 'function') {
    return (globalThis as any).structuredClone(schema);
  }
  return JSON.parse(JSON.stringify(schema));
};

const normalizeRef = (ref: string): string => {
  if (ref.startsWith('#')) return ref;
  if (/^[a-zA-Z]+:/.test(ref)) return ref;
  if (ref.startsWith(ACTION_REF_PREFIX)) {
    return `#/${ref.slice(ACTION_REF_PREFIX.length)}`;
  }
  if (ref.startsWith('/')) return `#${ref}`;
  return `#/${ref}`;
};

// TLDraw templates embed nested $ref strings such as
// `properties/actions/items/definitions/createAction/...`. Ajv accepts JSON
// Pointers rooted at `#/definitions`, so we rewrite those references before
// compiling.
const normalizeSchemaRefs = (schema: unknown): unknown => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    schema.forEach((value) => normalizeSchemaRefs(value));
    return schema;
  }
  const scoped = schema as Record<string, unknown>;
  if ('$ref' in scoped && typeof scoped.$ref === 'string') {
    const ref = scoped.$ref as string;
    if (ref.startsWith(ACTION_REF_PREFIX) || (!ref.startsWith('#') && !/^[a-zA-Z]+:/.test(ref))) {
      scoped.$ref = normalizeRef(ref);
    }
  }
  Object.values(scoped).forEach((value) => normalizeSchemaRefs(value));
  return schema;
};

// The generated teacher schemas describe the entire action object (including
// the `_type` discriminator), so we validate the raw payloads before any
// bridge-specific transforms normalize them into PRESENT's canonical verbs.
teacherContract.actions.forEach((entry: TeacherSchemaEntry) => {
  const name = entry.name as TeacherActionName;
  if (!entry.schema) {
    return;
  }
  try {
    const normalizedSchema = normalizeSchemaRefs(cloneSchema(entry.schema));
    const validator = ajv.compile(normalizedSchema as Record<string, unknown>);
    validatorByAction.set(name, validator);
  } catch (error) {
    console.warn('[CanvasAgent:TeacherSchemaCompileError]', { name, error });
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
  | { ok: false; issues: ErrorObject[] | null | undefined };

export function validateTeacherActionPayload(name: TeacherActionName, payload: unknown): TeacherValidationResult {
  const validator = validatorByAction.get(name);
  if (!validator) {
    return { ok: true };
  }
  const valid = validator(payload);
  if (valid) return { ok: true };
  return { ok: false, issues: validator.errors };
}
