import { systemRegistry } from '../system-registry';
// Using JSDoc import type to avoid TS syntax in Jest without ts-jest
/** @typedef {import('../shared-state').StateEnvelope} StateEnvelope */

describe('State Synchronization (Phase 4)', () => {
  beforeEach(() => {
    // Clear registry state before each test
    jest.clearAllMocks();
  });

  describe('State Ingestion', () => {
    it('should ingest new state correctly', () => {
      const envelope: StateEnvelope = {
        id: 'test-component-1',
        kind: 'component_created',
        payload: { componentName: 'TestComponent' },
        version: 1,
        ts: Date.now(),
        origin: 'browser'
      };

      systemRegistry.ingestState(envelope);
      const retrieved = systemRegistry.getState('test-component-1');
      
      expect(retrieved).toEqual(envelope);
    });

    it('should reject stale updates based on version', () => {
      const envelope1: StateEnvelope = {
        id: 'test-component-1',
        kind: 'component_updated',
        payload: { value: 'first' },
        version: 2,
        ts: Date.now(),
        origin: 'browser'
      };

      const envelope2: StateEnvelope = {
        id: 'test-component-1', 
        kind: 'component_updated',
        payload: { value: 'second' },
        version: 1, // Older version
        ts: Date.now() + 1000,
        origin: 'agent'
      };

      systemRegistry.ingestState(envelope1);
      systemRegistry.ingestState(envelope2);
      
      const retrieved = systemRegistry.getState('test-component-1');
      expect(retrieved?.payload).toEqual({ value: 'first' });
      expect(retrieved?.version).toBe(2);
    });

    it('should accept updates with same version (idempotency)', () => {
      const envelope: StateEnvelope = {
        id: 'test-component-1',
        kind: 'component_updated',
        payload: { value: 'test' },
        version: 1,
        ts: Date.now(),
        origin: 'browser'
      };

      systemRegistry.ingestState(envelope);
      systemRegistry.ingestState(envelope); // Duplicate
      
      const retrieved = systemRegistry.getState('test-component-1');
      expect(retrieved).toEqual(envelope);
    });
  });

  describe('State Subscription', () => {
    it('should notify listeners on state changes', (done) => {
      const envelope: StateEnvelope = {
        id: 'test-component-1',
        kind: 'component_created',
        payload: { componentName: 'TestComponent' },
        version: 1,
        ts: Date.now(),
        origin: 'browser'
      };

      const unsubscribe = systemRegistry.onState((received) => {
        expect(received).toEqual(envelope);
        unsubscribe();
        done();
      });

      systemRegistry.ingestState(envelope);
    });

    it('should not notify for rejected updates', () => {
      const listener = jest.fn();
      const unsubscribe = systemRegistry.onState(listener);

      const envelope1: StateEnvelope = {
        id: 'test-1',
        kind: 'component_updated',
        payload: { value: 'first' },
        version: 2,
        ts: Date.now(),
        origin: 'browser'
      };

      const envelope2: StateEnvelope = {
        id: 'test-1',
        kind: 'component_updated',
        payload: { value: 'second' },
        version: 1, // Older
        ts: Date.now() + 1000,
        origin: 'agent'
      };

      systemRegistry.ingestState(envelope1);
      expect(listener).toHaveBeenCalledTimes(1);
      
      systemRegistry.ingestState(envelope2); // Should be rejected
      expect(listener).toHaveBeenCalledTimes(1); // No additional call

      unsubscribe();
    });
  });

  describe('State Snapshot', () => {
    it('should return full snapshot of all states', () => {
      const envelopes: StateEnvelope[] = [
        {
          id: 'comp-1',
          kind: 'component_created',
          payload: { name: 'Comp1' },
          version: 1,
          ts: Date.now(),
          origin: 'browser'
        },
        {
          id: 'comp-2',
          kind: 'component_created',
          payload: { name: 'Comp2' },
          version: 1,
          ts: Date.now() + 100,
          origin: 'agent'
        }
      ];

      envelopes.forEach(env => systemRegistry.ingestState(env));
      
      const snapshot = systemRegistry.getSnapshot();
      expect(snapshot).toHaveLength(2);
      expect(snapshot).toContainEqual(envelopes[0]);
      expect(snapshot).toContainEqual(envelopes[1]);
    });
  });

  describe('Conflict Resolution', () => {
    it('should implement last-write-wins based on version', () => {
      const base: StateEnvelope = {
        id: 'conflict-test',
        kind: 'component_created',
        payload: { value: 'initial' },
        version: 1,
        ts: 1000,
        origin: 'browser'
      };

      const update1: StateEnvelope = {
        ...base,
        payload: { value: 'update1' },
        version: 2,
        ts: 2000,
        origin: 'agent'
      };

      const update2: StateEnvelope = {
        ...base,
        payload: { value: 'update2' },
        version: 3,
        ts: 1500, // Earlier timestamp but higher version
        origin: 'browser'
      };

      systemRegistry.ingestState(base);
      systemRegistry.ingestState(update1);
      systemRegistry.ingestState(update2);

      const final = systemRegistry.getState('conflict-test');
      expect(final?.payload).toEqual({ value: 'update2' });
      expect(final?.version).toBe(3);
    });
  });
}); 