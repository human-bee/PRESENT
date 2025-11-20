import { describe, expect, it } from '@jest/globals';

import { teacherValidationCoverage, validateTeacherActionPayload } from './teacher-validation';

describe('teacher contract validation', () => {
  it('exports validator coverage for telemetry', () => {
    expect(teacherValidationCoverage.validated.length).toBeGreaterThan(0);
  });

  it('accepts a valid message payload', () => {
    const result = validateTeacherActionPayload('message', { _type: 'message', text: 'Hello' });
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid message payload', () => {
    const result = validateTeacherActionPayload('message', { _type: 'message' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues?.length).toBeGreaterThan(0);
    }
  });

  it('validates create draw actions', () => {
    const payload = {
      _type: 'create',
      intent: 'sketch',
      shape: {
        _type: 'draw',
        color: 'red',
        fill: 'none',
        note: 'blob',
        shapeId: 'shape:1',
      },
    };
    const result = validateTeacherActionPayload('create', payload);
    expect(result.ok).toBe(true);
  });

  it('validates pen actions with point arrays', () => {
    const payload = {
      _type: 'pen',
      intent: 'sketch',
      color: 'blue',
      fill: 'none',
      closed: false,
      style: 'smooth',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
    };
    const result = validateTeacherActionPayload('pen', payload);
    expect(result.ok).toBe(true);
  });

  it('rejects move payloads missing numbers', () => {
    const bad = {
      _type: 'move',
      intent: 'place',
      shapeId: 'shape:missing',
      x: 'offset',
      y: 10,
    } as any;
    const result = validateTeacherActionPayload('move', bad);
    expect(result.ok).toBe(false);
  });
});
