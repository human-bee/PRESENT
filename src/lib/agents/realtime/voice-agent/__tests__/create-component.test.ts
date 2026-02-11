import type { JsonObject } from '@/lib/utils/json-schema';
import {
  executeCreateComponent,
  type ActiveScorecard,
  type ComponentRegistryEntry,
  type ExecuteCreateComponentDeps,
} from '../create-component';

const createDeps = (): {
  deps: ExecuteCreateComponentDeps;
  sentCalls: Array<{ tool: string; params: JsonObject }>;
  getLastCreatedId: () => string | null;
} => {
  const registry = new Map<string, ComponentRegistryEntry>();
  const fingerprints = new Map<string, {
    fingerprint: string;
    messageId: string;
    createdAt: number;
    turnId: number;
    intentId: string;
    slot?: string;
  }>();
  const lastByType = new Map<string, string>();
  let activeScorecard: ActiveScorecard = null;
  let lastCreatedId: string | null = null;
  const sentCalls: Array<{ tool: string; params: JsonObject }> = [];

  const deps: ExecuteCreateComponentDeps = {
    roomName: 'room-a',
    currentTurnId: 7,
    scorecardSuppressWindowMs: 10_000,
    lastScorecardProvisionedAt: 0,
    lastUserPrompt: 'set up a timer',
    activeScorecard,
    findLatestScorecardEntryInRoom: () => null,
    getLastComponentForType: (type) => lastByType.get(type),
    setLastComponentForType: (type, messageId) => {
      lastByType.set(type, messageId);
    },
    setLastCreatedComponentId: (messageId) => {
      lastCreatedId = messageId;
    },
    getRecentCreateFingerprint: (type) => fingerprints.get(type),
    setRecentCreateFingerprint: (type, fingerprint) => {
      fingerprints.set(type, fingerprint);
    },
    getComponentEntry: (messageId) => registry.get(messageId),
    setComponentEntry: (messageId, entry) => {
      registry.set(messageId, entry);
    },
    findLedgerEntryByMessage: () => undefined,
    registerLedgerEntry: () => {},
    listRemoteParticipantLabels: () => ['Alice', 'Bob'],
    sendToolCall: async (tool, params) => {
      sentCalls.push({ tool, params });
    },
    sendScorecardSeedTask: async () => {},
    setActiveScorecard: (next) => {
      activeScorecard = next;
      deps.activeScorecard = next;
    },
  };

  return { deps, sentCalls, getLastCreatedId: () => lastCreatedId };
};

describe('executeCreateComponent', () => {
  it('suppresses duplicate create calls with same fingerprint in the same turn', async () => {
    const { deps, sentCalls, getLastCreatedId } = createDeps();

    const first = await executeCreateComponent(
      {
        type: 'RetroTimerEnhanced',
        spec: { initialMinutes: 5, autoStart: true },
      },
      deps,
    );
    const second = await executeCreateComponent(
      {
        type: 'RetroTimerEnhanced',
        spec: { initialMinutes: 5, autoStart: true },
      },
      deps,
    );

    expect(first.status).toBe('queued');
    expect(second.status).toBe('duplicate_skipped');
    expect(sentCalls.filter((entry) => entry.tool === 'create_component')).toHaveLength(1);
    expect(getLastCreatedId()).not.toBeNull();
  });

  it('uses global ttl for cross-turn duplicate suppression and allows coalesced update after expiry', async () => {
    const { deps, sentCalls } = createDeps();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const first = await executeCreateComponent(
      {
        type: 'RetroTimerEnhanced',
        spec: { initialMinutes: 5, autoStart: true },
        messageId: 'ui-fixed',
        intentId: 'intent-fixed',
      },
      deps,
    );

    deps.currentTurnId = 8;
    nowSpy.mockReturnValue(15_000);
    const withinTtl = await executeCreateComponent(
      {
        type: 'RetroTimerEnhanced',
        spec: { initialMinutes: 5, autoStart: true },
        messageId: 'ui-fixed',
        intentId: 'intent-fixed',
      },
      deps,
    );

    nowSpy.mockReturnValue(35_500);
    const expiredTtl = await executeCreateComponent(
      {
        type: 'RetroTimerEnhanced',
        spec: { initialMinutes: 5, autoStart: true },
        messageId: 'ui-fixed',
        intentId: 'intent-fixed',
      },
      deps,
    );

    nowSpy.mockRestore();

    expect(first.status).toBe('queued');
    expect(withinTtl.status).toBe('duplicate_skipped');
    expect(expiredTtl.status).toBe('queued');
    expect(expiredTtl.reusedExisting).toBe(true);
    expect(sentCalls.filter((entry) => entry.tool === 'create_component')).toHaveLength(1);
    expect(sentCalls.filter((entry) => entry.tool === 'update_component')).toHaveLength(1);
  });

  it('routes AIResponse widget creates to canvas.quick_text dispatch', async () => {
    const { deps, sentCalls } = createDeps();
    const result = await executeCreateComponent(
      {
        type: 'AIResponse',
        props: {
          text: 'hello from ai',
          x: 120,
          y: 240,
        },
      },
      deps,
    );

    expect(result.status).toBe('queued');
    expect(sentCalls).toHaveLength(1);
    expect(sentCalls[0]?.tool).toBe('dispatch_to_conductor');
    expect(sentCalls[0]?.params).toMatchObject({
      task: 'canvas.quick_text',
      params: {
        room: 'room-a',
        text: 'hello from ai',
        x: 120,
        y: 240,
      },
    });
  });
});
