import { describe, it, expect } from '@jest/globals';
import { parseAction, parseEnvelope, actionParamSchemas } from './parsers';
import { ACTION_VERSION } from './types';

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
        params: { ids: ['s1', 's2'], mode: 'left' },
      });
      expect(result.name).toBe('align');
      expect(result.params).toMatchObject({ mode: 'left' });
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
        'draw_pen',
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
  });
});



