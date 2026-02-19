import {
  inferExplicitTargetIds,
  mergeFollowupWithInferredTargets,
  normalizeShapeIdForLookup,
  resolveMissingTargetIds,
} from './target-id-contract';

describe('target-id-contract', () => {
  test('normalizes shape ids for lookup', () => {
    expect(normalizeShapeIdForLookup('shape:forest-tree-1')).toBe('forest-tree-1');
    expect(normalizeShapeIdForLookup('  FoReSt-TrEe-2  ')).toBe('forest-tree-2');
    expect(normalizeShapeIdForLookup('')).toBe('');
  });

  test('infers explicit ids when prompt declares exact ids', () => {
    const ids = inferExplicitTargetIds(
      'Use these exact ids and geometry: forest-tree-1 rectangle, forest-tree-2 rectangle, forest-tree-3 rectangle.',
    );
    expect(ids).toEqual(['forest-tree-1', 'forest-tree-2', 'forest-tree-3']);
  });

  test('does not infer ids when prompt does not declare id cues', () => {
    const ids = inferExplicitTargetIds(
      'Draw a forest around the bunny with three trees and one ground line.',
    );
    expect(ids).toEqual([]);
  });

  test('merges inferred ids into strict followup contract', () => {
    const merged = mergeFollowupWithInferredTargets(
      null,
      'Use with id sticky-bunny and exact ids: forest-tree-1, forest-tree-2.',
      0,
    );
    expect(merged).toMatchObject({
      strict: true,
      reason: 'explicit_target_ids',
      depth: 0,
      targetIds: ['sticky-bunny', 'forest-tree-1', 'forest-tree-2'],
    });
  });

  test('keeps explicit followup fields while adding inferred targets', () => {
    const merged = mergeFollowupWithInferredTargets(
      {
        message: 'keep this',
        originalMessage: 'origin',
        depth: 1,
        reason: 'existing_reason',
        targetIds: ['shape:forest-tree-1'],
      },
      'Use these exact ids and geometry: forest-tree-1, forest-tree-2.',
      1,
    );
    expect(merged).toMatchObject({
      message: 'keep this',
      originalMessage: 'origin',
      depth: 1,
      reason: 'existing_reason',
      strict: true,
      targetIds: ['shape:forest-tree-1', 'forest-tree-2'],
    });
  });

  test('resolves missing target ids against known shapes', () => {
    const missing = resolveMissingTargetIds(
      ['forest-tree-1', 'shape:forest-tree-2', 'forest-tree-3'],
      ['shape:forest-tree-1', 'forest-tree-2'],
    );
    expect(missing).toEqual(['forest-tree-3']);
  });
});
