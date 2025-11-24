import Ajv from 'ajv';
import teacherContract from '../../../../generated/agent-contract.json';
import { TEACHER_ACTIONS } from './teacher';
const ajv = new Ajv({ allErrors: true, strict: false });
const validatorByAction = new Map();
// TLDraw's generator emits JSON Pointer-like paths that start with
// `properties/actions/items/...`. Ajv expects canonical `#/definitions/...`
// references, so we rewrite them during normalization.
const ACTION_REF_PREFIX = 'properties/actions/items/';
const cloneSchema = (schema) => {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(schema);
    }
    return JSON.parse(JSON.stringify(schema));
};
const normalizeRef = (ref) => {
    if (ref.startsWith('#'))
        return ref;
    if (/^[a-zA-Z]+:/.test(ref))
        return ref;
    if (ref.startsWith(ACTION_REF_PREFIX)) {
        return `#/${ref.slice(ACTION_REF_PREFIX.length)}`;
    }
    if (ref.startsWith('/'))
        return `#${ref}`;
    return `#/${ref}`;
};
// TLDraw templates embed nested $ref strings such as
// `properties/actions/items/definitions/createAction/...`. Ajv accepts JSON
// Pointers rooted at `#/definitions`, so we rewrite those references before
// compiling.
const normalizeSchemaRefs = (schema) => {
    if (!schema || typeof schema !== 'object')
        return schema;
    if (Array.isArray(schema)) {
        schema.forEach((value) => normalizeSchemaRefs(value));
        return schema;
    }
    const scoped = schema;
    if ('$ref' in scoped && typeof scoped.$ref === 'string') {
        const ref = scoped.$ref;
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
teacherContract.actions.forEach((entry) => {
    const name = entry.name;
    if (!entry.schema) {
        return;
    }
    try {
        const normalizedSchema = normalizeSchemaRefs(cloneSchema(entry.schema));
        const validator = ajv.compile(normalizedSchema);
        validatorByAction.set(name, validator);
    }
    catch (error) {
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
export function validateTeacherActionPayload(name, payload) {
    const validator = validatorByAction.get(name);
    if (!validator) {
        return { ok: true };
    }
    const valid = validator(payload);
    if (valid)
        return { ok: true };
    return { ok: false, issues: validator.errors };
}
//# sourceMappingURL=teacher-validation.js.map