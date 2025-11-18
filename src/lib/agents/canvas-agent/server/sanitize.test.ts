import { describe, it, expect } from '@jest/globals';
jest.mock('nanoid', () => ({ customAlphabet: () => () => 'mockid' }));

import { sanitizeActions } from './sanitize';
import type { AgentAction } from '@/lib/canvas-agent/contract/types';

describe('Canvas Agent Sanitizer', () => {
  const mockExists = (id: string) => id.startsWith('shape:');

  it('should generate IDs for create_shape without id', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'create_shape', params: { type: 'geo' } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
    expect((result[0].params as any).id).toMatch(/^ag:/);
  });

  it('should drop update_shape for non-existent shapes', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'update_shape', params: { id: 'nonexistent', props: {} } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(0);
  });

  it('should keep update_shape for existing shapes', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'update_shape', params: { id: 'shape:123', props: {} } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
  });

  it('should filter delete_shape ids to existing only', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'delete_shape', params: { ids: ['shape:1', 'nonexistent', 'shape:2'] } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
    expect((result[0].params as any).ids).toEqual(['shape:1', 'shape:2']);
  });

  it('should drop delete_shape with no valid ids', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'delete_shape', params: { ids: ['nonexistent1', 'nonexistent2'] } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(0);
  });

  it('should clamp resize dimensions', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'resize', params: { id: 'shape:1', w: 999999, h: 0.5, anchor: 'tl' } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
    expect((result[0].params as any).w).toBeLessThanOrEqual(100000);
    expect((result[0].params as any).h).toBeGreaterThanOrEqual(1);
  });

  it('should clamp move deltas', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'move', params: { ids: ['shape:1'], dx: 200000, dy: -200000 } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
    expect((result[0].params as any).dx).toBeLessThanOrEqual(100000);
    expect((result[0].params as any).dy).toBeGreaterThanOrEqual(-100000);
  });

  it('should clamp rotate angle', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'rotate', params: { ids: ['shape:1'], angle: 100 } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
    expect(Math.abs((result[0].params as any).angle)).toBeLessThanOrEqual(Math.PI * 4);
  });

  it('should order creates before updates', () => {
    const actions: AgentAction[] = [
      { id: 'a2', name: 'update_shape', params: { id: 'shape:1', props: { color: 'red' } } },
      { id: 'a1', name: 'create_shape', params: { type: 'geo', id: 'new:1' } },
      { id: 'a3', name: 'delete_shape', params: { ids: ['shape:2'] } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result[0].name).toBe('create_shape');
    expect(result[result.length - 1].name).toBe('delete_shape');
  });

  it('should retain follow-up actions for newly created shapes', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'create_shape', params: { type: 'geo', id: 'temp:1' } },
      { id: 'a2', name: 'move', params: { ids: ['temp:1'], dx: 10, dy: 5 } },
      { id: 'a3', name: 'delete_shape', params: { ids: ['temp:1'] } },
    ];

    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(3);
    expect((result[1].params as any).ids).toEqual(['temp:1']);
    expect((result[2].params as any).ids).toEqual(['temp:1']);
  });

  it('should retain actions that reference shapes created later in the envelope', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'move', params: { ids: ['temp:2'], dx: 5, dy: -3 } },
      { id: 'a2', name: 'create_shape', params: { type: 'geo', id: 'temp:2' } },
    ];

    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('create_shape');
    expect((result[1].params as any).ids).toEqual(['temp:2']);
  });

  it('should drop malformed actions silently', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'create_shape', params: null as any },
      { id: 'a2', name: 'think', params: { text: 'valid' } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('think');
  });

  it('should keep think/todo/add_detail actions', () => {
    const actions: AgentAction[] = [
      { id: 'a1', name: 'think', params: { text: 'planning' } },
      { id: 'a2', name: 'todo', params: { text: 'follow up' } },
      { id: 'a3', name: 'add_detail', params: { hint: 'more detail' } },
    ];
    const result = sanitizeActions(actions, mockExists);
    expect(result).toHaveLength(3);
  });
});
