import type { JsonObject } from '@/lib/utils/json-schema';

export type ExperimentAssignmentUnit = 'room_session';

export type InitialToolsetLevel = 'full' | 'lean_adaptive';
export type LazyLoadPolicyLevel = 'adaptive_refresh' | 'locked_session';
export type InstructionPackLevel = 'baseline' | 'capability_explicit';
export type HarnessModeLevel = 'quick_first_async_proof' | 'queue_first';

export type VoiceFactorLevels = {
  initial_toolset: InitialToolsetLevel;
  lazy_load_policy: LazyLoadPolicyLevel;
  instruction_pack: InstructionPackLevel;
  harness_mode: HarnessModeLevel;
};

export type ExperimentAssignment = {
  experiment_id: string;
  variant_id: string;
  assignment_namespace: string;
  assignment_unit: ExperimentAssignmentUnit;
  assignment_ts: string;
  factor_levels: Record<string, string>;
};

const DEFAULT_ASSIGNMENT_NAMESPACE = 'voice_toolset_factorial_v1';

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const hash32 = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const toFactorLevels = (index: number): VoiceFactorLevels => ({
  initial_toolset: (index & 0b0001) === 0 ? 'full' : 'lean_adaptive',
  lazy_load_policy: (index & 0b0010) === 0 ? 'adaptive_refresh' : 'locked_session',
  instruction_pack: (index & 0b0100) === 0 ? 'baseline' : 'capability_explicit',
  harness_mode: (index & 0b1000) === 0 ? 'quick_first_async_proof' : 'queue_first',
});

const isValidFactorValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeFactorLevels = (value: unknown): Record<string, string> | null => {
  const record = readObject(value);
  if (!record) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!isValidFactorValue(raw)) continue;
    out[key] = raw.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
};

export const assignmentToDiagnostics = (
  assignment: ExperimentAssignment | null | undefined,
): JsonObject | null => {
  if (!assignment) return null;
  return {
    experimentId: assignment.experiment_id,
    variantId: assignment.variant_id,
    assignmentNamespace: assignment.assignment_namespace,
    assignmentUnit: assignment.assignment_unit,
    assignmentTs: assignment.assignment_ts,
    factorLevels: assignment.factor_levels,
  };
};

export const normalizeExperimentAssignment = (value: unknown): ExperimentAssignment | null => {
  const record = readObject(value);
  if (!record) return null;
  const experimentId =
    normalizeString(record.experiment_id) ??
    normalizeString(record.experimentId) ??
    normalizeString(record.id);
  const variantId = normalizeString(record.variant_id) ?? normalizeString(record.variantId);
  const assignmentNamespace =
    normalizeString(record.assignment_namespace) ??
    normalizeString(record.assignmentNamespace) ??
    experimentId ??
    DEFAULT_ASSIGNMENT_NAMESPACE;
  const assignmentUnitRaw =
    normalizeString(record.assignment_unit) ?? normalizeString(record.assignmentUnit);
  const assignmentTs =
    normalizeString(record.assignment_ts) ?? normalizeString(record.assignmentTs) ?? 'legacy';
  const factorLevels = normalizeFactorLevels(record.factor_levels ?? record.factorLevels) ?? {};

  if (!experimentId || !variantId) {
    return null;
  }

  const assignmentUnit: ExperimentAssignmentUnit =
    assignmentUnitRaw === 'room_session' || !assignmentUnitRaw ? 'room_session' : 'room_session';

  return {
    experiment_id: experimentId,
    variant_id: variantId,
    assignment_namespace: assignmentNamespace,
    assignment_unit: assignmentUnit,
    assignment_ts: assignmentTs,
    factor_levels: factorLevels,
  };
};

export const readExperimentAssignmentFromUnknown = (
  source: unknown,
): ExperimentAssignment | null => {
  const direct = normalizeExperimentAssignment(source);
  if (direct) return direct;

  const record = readObject(source);
  if (!record) return null;

  return (
    normalizeExperimentAssignment(record.experiment) ||
    normalizeExperimentAssignment(record.experiments) ||
    normalizeExperimentAssignment(record.assignment) ||
    normalizeExperimentAssignment(record.metadata) ||
    normalizeExperimentAssignment(
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>).experiment
        : null,
    ) ||
    normalizeExperimentAssignment(
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>).assignment
        : null,
    ) ||
    null
  );
};

export const attachExperimentAssignmentToMetadata = (
  metadata: JsonObject | null | undefined,
  assignment: ExperimentAssignment | null | undefined,
): JsonObject | null => {
  if (!assignment) return metadata ?? null;
  const next: JsonObject = {
    ...(metadata ?? {}),
    experiment: {
      experiment_id: assignment.experiment_id,
      variant_id: assignment.variant_id,
      assignment_namespace: assignment.assignment_namespace,
      assignment_unit: assignment.assignment_unit,
      assignment_ts: assignment.assignment_ts,
      factor_levels: assignment.factor_levels,
    },
  };
  return next;
};

export const assignVoiceFactorialVariant = (input: {
  namespace?: string;
  roomId: string;
  sessionStartIso: string;
  assignmentTs?: string;
}): ExperimentAssignment => {
  const namespace = normalizeString(input.namespace) ?? DEFAULT_ASSIGNMENT_NAMESPACE;
  const roomId = normalizeString(input.roomId) ?? 'unknown-room';
  const sessionStartIso = normalizeString(input.sessionStartIso) ?? new Date().toISOString();
  const assignmentTs = normalizeString(input.assignmentTs) ?? new Date().toISOString();

  const seed = `${namespace}::${roomId}::${sessionStartIso}`;
  const bucket = hash32(seed) % 16;
  const levels = toFactorLevels(bucket);

  return {
    experiment_id: namespace,
    variant_id: `v${String(bucket).padStart(2, '0')}`,
    assignment_namespace: namespace,
    assignment_unit: 'room_session',
    assignment_ts: assignmentTs,
    factor_levels: {
      initial_toolset: levels.initial_toolset,
      lazy_load_policy: levels.lazy_load_policy,
      instruction_pack: levels.instruction_pack,
      harness_mode: levels.harness_mode,
    },
  };
};

export const readVoiceFactorLevel = <T extends string>(
  assignment: ExperimentAssignment | null | undefined,
  key: keyof VoiceFactorLevels,
  fallback: T,
): T => {
  if (!assignment) return fallback;
  const value = assignment.factor_levels[key];
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value as T;
};

export const getDefaultAssignmentNamespace = (): string => DEFAULT_ASSIGNMENT_NAMESPACE;
