import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import teacherContract from '../../../../generated/agent-contract.json';
import type { TeacherActionName } from './teacher';

const ajv = new Ajv({ allErrors: true, strict: false });

type TeacherSchemaEntry = (typeof teacherContract)['actions'][number];

const validatorByAction = new Map<TeacherActionName, ValidateFunction>();

const cloneSchema = <T>(schema: T): T => {
  if (typeof (globalThis as any).structuredClone === 'function') {
    return (globalThis as any).structuredClone(schema);
  }
  return JSON.parse(JSON.stringify(schema));
};

const normalizeSchemaRefs = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if ('$ref' in schema && typeof schema.$ref === 'string') {
    const ref = schema.$ref as string;
    if (ref.startsWith('properties/actions/items/definitions/')) {
      const definitionName = ref.split('/').pop();
      schema.$ref = `#/definitions/${definitionName}`;
    } else if (!ref.startsWith('#')) {
      schema.$ref = `#/${ref}`;
    }
  }
  Object.values(schema).forEach((value) => normalizeSchemaRefs(value));
  return schema;
};

// The generated teacher schemas describe the entire action object (including
// the `_type` discriminator), so we validate the raw payloads before any
// bridge-specific transforms normalize them into PRESENT's canonical verbs.
teacherContract.actions.forEach((entry: TeacherSchemaEntry) => {
  const name = entry.name as TeacherActionName;
  if (!entry.schema) return;
  try {
    const normalizedSchema = normalizeSchemaRefs(cloneSchema(entry.schema));
    const validator = ajv.compile(normalizedSchema as Record<string, unknown>);
    validatorByAction.set(name, validator);
  } catch (error) {
    console.warn('[CanvasAgent:TeacherSchemaCompileError]', { name, error });
  }
});

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
