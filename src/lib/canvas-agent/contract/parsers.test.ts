import { describe, it, expect } from '@jest/globals';
import { parseAction, parseEnvelope, actionParamSchemas } from './parsers';
import { ACTION_VERSION } from './types';
import { TEACHER_ACTIONS } from './teacher';

describe('Canvas Agent Parsers', () => {
  describe('parseAction', () => {
    it('should parse valid create_shape action', () => {
      const result = parseAction({
        id: 'test-1',
        name: 'create_shape',
        params: { type: 'geo', id: 'shape:test', x: 120, y: 80, props: { geo: 'rectangle' } },
      });
      expect(result.id).toBe('test-1');
      expect(result.name).toBe('create_shape');
      expect(result.params).toMatchObject({ type: 'geo', x: 120, y: 80 });
    });

    it('should parse valid move action', () => {
      const result = parseAction({
        id: 'test-2',
        name: 'move',
        params: { ids: ['shape1', 'shape2'], dx: 10, dy: 20 },
      });
      expect(result.name).toBe('move');
      expect(result.params).toMatchObject({ ids: ['shape1', 'shape2'], dx: 10, dy: 20 });
    });

    it('should parse valid align action', () => {
      const result = parseAction({
        id: 'test-3',
        name: 'align',
        params: { ids: ['s1', 's2'], axis: 'x', mode: 'start' },
      });
      expect(result.name).toBe('align');
      expect(result.params).toMatchObject({ axis: 'x', mode: 'start' });
    });

    it('should parse valid think action', () => {
      const result = parseAction({
        id: 'test-4',
        name: 'think',
        params: { text: 'planning next step' },
      });
      expect(result.name).toBe('think');
      expect(result.params).toMatchObject({ text: 'planning next step' });
    });

    it('should throw on invalid action name', () => {
      expect(() => {
        parseAction({ id: 'test', name: 'invalid_action', params: {} });
      }).toThrow();
    });

    it('should throw on invalid params schema', () => {
      expect(() => {
        parseAction({ id: 'test', name: 'move', params: { ids: 'not-an-array' } });
      }).toThrow();
    });

    it('should throw on missing required param', () => {
      expect(() => {
        parseAction({ id: 'test', name: 'delete_shape', params: {} });
      }).toThrow();
    });

    it('should parse teacher clear action params', () => {
      const result = parseAction({
        id: 'teacher-clear',
        name: 'clear',
        params: {},
      });
      expect(result.name).toBe('clear');
      expect(result.params).toEqual({});
    });

    it('should parse teacher place action params', () => {
      const result = parseAction({
        id: 'teacher-place',
        name: 'place',
        params: {
          shapeId: 'shape-1',
          referenceShapeId: 'shape-2',
          side: 'right',
          sideOffset: 12,
          align: 'center',
          alignOffset: 4,
        },
      });
      expect(result.name).toBe('place');
      expect(result.params).toMatchObject({
        shapeId: 'shape-1',
        referenceShapeId: 'shape-2',
        side: 'right',
      });
    });

    it('should parse teacher resize scale payload', () => {
      const result = parseAction({
        id: 'teacher-resize',
        name: 'resize',
        params: {
          shapeIds: ['a', 'b'],
          originX: 0,
          originY: 0,
          scaleX: 1.2,
          scaleY: 0.9,
        },
      });
      expect(result.name).toBe('resize');
      expect(result.params).toMatchObject({
        shapeIds: ['a', 'b'],
        originX: 0,
        originY: 0,
        scaleX: 1.2,
        scaleY: 0.9,
      });
    });
  });

  describe('parseEnvelope', () => {
    it('should parse valid envelope', () => {
      const envelope = {
        v: ACTION_VERSION,
        sessionId: 'session-123',
        seq: 0,
        actions: [{ id: 'a1', name: 'think', params: { text: 'test' } }],
        ts: Date.now(),
      };
      const result = parseEnvelope(envelope);
      expect(result.v).toBe(ACTION_VERSION);
      expect(result.sessionId).toBe('session-123');
      expect(result.seq).toBe(0);
      expect(result.actions).toHaveLength(1);
    });

    it('should parse envelope with partial flag', () => {
      const envelope = {
        v: ACTION_VERSION,
        sessionId: 'session-123',
        seq: 1,
        partial: true,
        actions: [{ id: 'a1', name: 'think', params: { text: 'test' } }],
        ts: Date.now(),
      };
      const result = parseEnvelope(envelope);
      expect(result.partial).toBe(true);
    });

    it('should throw on invalid version', () => {
      expect(() => {
        parseEnvelope({
          v: 'invalid-version',
          sessionId: 'session-123',
          seq: 0,
          actions: [{ id: 'a1', name: 'think', params: { text: 'test' } }],
          ts: Date.now(),
        });
      }).toThrow();
    });

    it('should throw on negative seq', () => {
      expect(() => {
        parseEnvelope({
          v: ACTION_VERSION,
          sessionId: 'session-123',
          seq: -1,
          actions: [{ id: 'a1', name: 'think', params: { text: 'test' } }],
          ts: Date.now(),
        });
      }).toThrow();
    });

    it('should throw on empty actions array', () => {
      expect(() => {
        parseEnvelope({
          v: ACTION_VERSION,
          sessionId: 'session-123',
          seq: 0,
          actions: [],
          ts: Date.now(),
        });
      }).toThrow();
    });
  });

  describe('actionParamSchemas', () => {
    it('should have schemas for all TLDraw-native actions', () => {
      const expectedActions = [
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
      ];
      expectedActions.forEach((action) => {
        expect(actionParamSchemas[action]).toBeDefined();
      });
    });

    it('should register schemas for every teacher action name', () => {
      TEACHER_ACTIONS.forEach((name) => {
        expect(actionParamSchemas[name]).toBeDefined();
      });
    });

    it('should not leave any teacher action on z.never schema', () => {
      const neverActions = TEACHER_ACTIONS.filter(
        (name) => (actionParamSchemas[name] as any)?._def?.typeName === 'ZodNever',
      );
      expect(neverActions).toEqual([]);
    });
  });
});
