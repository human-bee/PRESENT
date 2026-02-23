import {
  assignVoiceFactorialVariant,
  attachExperimentAssignmentToMetadata,
  assignmentToDiagnostics,
  normalizeExperimentAssignment,
  readExperimentAssignmentFromUnknown,
  readVoiceFactorLevel,
} from './experiment-assignment';

describe('experiment assignment helpers', () => {
  it('assigns deterministic variants for room/session namespace input', () => {
    const a = assignVoiceFactorialVariant({
      namespace: 'voice_toolset_factorial_v1',
      roomId: 'canvas-123',
      sessionStartIso: '2026-02-23T00:00:00.000Z',
      assignmentTs: '2026-02-23T00:00:00.000Z',
    });
    const b = assignVoiceFactorialVariant({
      namespace: 'voice_toolset_factorial_v1',
      roomId: 'canvas-123',
      sessionStartIso: '2026-02-23T00:00:00.000Z',
      assignmentTs: '2026-02-23T00:00:00.000Z',
    });
    expect(a).toEqual(b);
    expect(a.variant_id).toMatch(/^v\d{2}$/);
    expect(a.factor_levels).toEqual(
      expect.objectContaining({
        initial_toolset: expect.any(String),
        lazy_load_policy: expect.any(String),
        instruction_pack: expect.any(String),
        harness_mode: expect.any(String),
      }),
    );
  });

  it('normalizes and rehydrates assignment envelopes from metadata wrappers', () => {
    const assignment = normalizeExperimentAssignment({
      experiment_id: 'voice_toolset_factorial_v1',
      variant_id: 'v05',
      assignment_namespace: 'voice_toolset_factorial_v1',
      assignment_unit: 'room_session',
      assignment_ts: '2026-02-23T03:21:00.000Z',
      factor_levels: {
        initial_toolset: 'lean_adaptive',
        lazy_load_policy: 'locked_session',
      },
    });
    expect(assignment).not.toBeNull();

    const wrapped = readExperimentAssignmentFromUnknown({
      metadata: {
        experiment: assignment,
      },
    });

    expect(wrapped).toMatchObject({
      experiment_id: 'voice_toolset_factorial_v1',
      variant_id: 'v05',
      assignment_namespace: 'voice_toolset_factorial_v1',
    });
    expect(readVoiceFactorLevel(wrapped, 'lazy_load_policy', 'adaptive_refresh')).toBe(
      'locked_session',
    );

    const merged = attachExperimentAssignmentToMetadata({ traceId: 'trace-1' }, wrapped);
    expect(merged).toMatchObject({
      traceId: 'trace-1',
      experiment: expect.objectContaining({
        experiment_id: 'voice_toolset_factorial_v1',
        variant_id: 'v05',
      }),
    });

    const diagnostics = assignmentToDiagnostics(wrapped);
    expect(diagnostics).toMatchObject({
      experimentId: 'voice_toolset_factorial_v1',
      variantId: 'v05',
    });
  });

  it('normalizes legacy assignment envelopes without factor levels', () => {
    const assignment = readExperimentAssignmentFromUnknown({
      experiment_id: 'voice_toolset_factorial_v1',
      variant_id: 'v09',
    });

    expect(assignment).toMatchObject({
      experiment_id: 'voice_toolset_factorial_v1',
      variant_id: 'v09',
      assignment_namespace: 'voice_toolset_factorial_v1',
      assignment_ts: 'legacy',
      factor_levels: {},
    });

    const diagnostics = assignmentToDiagnostics(assignment);
    expect(diagnostics).toMatchObject({
      experimentId: 'voice_toolset_factorial_v1',
      variantId: 'v09',
      factorLevels: {},
    });
  });
});
