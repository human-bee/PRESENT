import type { JsonObject } from '@/lib/utils/json-schema';
import type { ActiveScorecard, ComponentRegistryEntry } from '../create-component';
import {
  ScorecardService,
  type ScorecardServiceDeps,
} from '../scorecard-service';

type SeedTaskPayload = Parameters<ScorecardServiceDeps['sendScorecardSeedTask']>[0];
type RegisterLedgerPayload = Parameters<ScorecardServiceDeps['registerLedgerEntry']>[0];

type HarnessOptions = {
  roomName?: string;
  now?: () => number;
  labels?: string[];
  sendToolCall?: (tool: string, params: JsonObject) => Promise<void>;
  sendScorecardSeedTask?: (payload: SeedTaskPayload) => Promise<void>;
};

const buildScorecardEntry = ({
  topic,
  createdAt,
  room = 'room-a',
  intentId,
  slot,
  affLabel = 'Alice',
  negLabel = 'Bob',
}: {
  topic: string;
  createdAt: number;
  room?: string;
  intentId?: string;
  slot?: string;
  affLabel?: string;
  negLabel?: string;
}): ComponentRegistryEntry => {
  const players: JsonObject[] = [
    { side: 'AFF', label: affLabel },
    { side: 'NEG', label: negLabel },
  ];

  return {
    type: 'DebateScorecard',
    createdAt,
    room,
    intentId,
    slot,
    props: { topic, players },
    state: { topic, players },
  };
};

const createHarness = (options: HarnessOptions = {}) => {
  const componentRegistry = new Map<string, ComponentRegistryEntry>();
  const ledgerByMessage = new Map<string, string>();
  const registerLedgerCalls: RegisterLedgerPayload[] = [];
  const sentToolCalls: Array<{ tool: string; params: JsonObject }> = [];
  const seedCalls: SeedTaskPayload[] = [];
  const callOrder: string[] = [];
  const lastByType = new Map<string, string>();
  let lastCreatedId: string | null = null;
  let lastScorecardProvisionedAt = 0;
  let activeScorecard: ActiveScorecard = null;

  const deps: ScorecardServiceDeps = {
    getRoomName: () => options.roomName ?? 'room-a',
    componentRegistry,
    getActiveScorecard: () => activeScorecard,
    setActiveScorecard: (scorecard) => {
      activeScorecard = scorecard;
    },
    findLedgerEntryByMessage: (messageId) => {
      const intentId = ledgerByMessage.get(messageId);
      return intentId ? { intentId } : undefined;
    },
    registerLedgerEntry: (entry) => {
      registerLedgerCalls.push(entry);
      ledgerByMessage.set(entry.messageId, entry.intentId);
    },
    setLastComponentForType: (type, messageId) => {
      lastByType.set(type, messageId);
    },
    setLastCreatedComponentId: (messageId) => {
      lastCreatedId = messageId;
    },
    setLastScorecardProvisionedAt: (createdAt) => {
      lastScorecardProvisionedAt = createdAt;
    },
    listRemoteParticipantLabels: () => options.labels ?? ['Alice', 'Bob'],
    sendToolCall: async (tool, params) => {
      callOrder.push(`tool:${tool}`);
      sentToolCalls.push({ tool, params });
      if (options.sendToolCall) {
        await options.sendToolCall(tool, params);
      }
    },
    sendScorecardSeedTask: async (payload) => {
      callOrder.push('seed');
      seedCalls.push(payload);
      if (options.sendScorecardSeedTask) {
        await options.sendScorecardSeedTask(payload);
      }
    },
    now: options.now,
  };

  return {
    service: new ScorecardService(deps),
    componentRegistry,
    setLedgerIntentForMessage: (messageId: string, intentId: string) => {
      ledgerByMessage.set(messageId, intentId);
    },
    sentToolCalls,
    seedCalls,
    callOrder,
    registerLedgerCalls,
    getActiveScorecard: () => activeScorecard,
    getLastCreatedId: () => lastCreatedId,
    getLastProvisionedAt: () => lastScorecardProvisionedAt,
    getLastComponentForType: (type: string) => lastByType.get(type),
  };
};

describe('ScorecardService', () => {
  it('reuses an existing scorecard by exact topic match and updates ledger pointers', async () => {
    const harness = createHarness();
    harness.componentRegistry.set(
      'score-latest',
      buildScorecardEntry({ topic: 'Climate Policy', createdAt: 200, intentId: 'intent-latest' }),
    );
    harness.componentRegistry.set(
      'score-match',
      buildScorecardEntry({ topic: 'AI Safety', createdAt: 100 }),
    );
    harness.setLedgerIntentForMessage('score-match', 'ledger-intent-match');

    const ensured = await harness.service.ensure('AI Safety');

    expect(ensured).toEqual({
      componentId: 'score-match',
      intentId: 'ledger-intent-match',
      topic: 'AI Safety',
    });
    expect(harness.sentToolCalls).toHaveLength(0);
    expect(harness.seedCalls).toHaveLength(0);
    expect(harness.getActiveScorecard()).toEqual(ensured);
    expect(harness.getLastComponentForType('DebateScorecard')).toBe('score-match');
    expect(harness.getLastCreatedId()).toBe('score-match');
    expect(harness.registerLedgerCalls).toContainEqual(
      expect.objectContaining({
        intentId: 'ledger-intent-match',
        messageId: 'score-match',
        componentType: 'DebateScorecard',
        state: 'updated',
      }),
    );
  });

  it('creates a new scorecard with reserve -> create -> seed ordering', async () => {
    const nowValues = [1_000, 1_100];
    const harness = createHarness({
      labels: ['Ada', 'Turing'],
      now: () => {
        const next = nowValues.shift();
        return typeof next === 'number' ? next : 1_100;
      },
    });

    const ensured = await harness.service.ensure('Tax Reform');

    expect(ensured).toEqual({
      componentId: 'debate-scorecard-1000',
      intentId: 'debate-scorecard-1000',
      topic: 'Tax Reform',
    });
    expect(harness.callOrder).toEqual([
      'tool:reserve_component',
      'tool:create_component',
      'seed',
    ]);
    expect(harness.sentToolCalls).toHaveLength(2);
    expect(harness.sentToolCalls[0]).toMatchObject({
      tool: 'reserve_component',
      params: {
        type: 'DebateScorecard',
        intentId: 'debate-scorecard-1000',
        messageId: 'debate-scorecard-1000',
        spec: {
          topic: 'Tax Reform',
          componentId: 'debate-scorecard-1000',
          version: 0,
          players: [
            { side: 'AFF', label: 'Ada' },
            { side: 'NEG', label: 'Turing' },
          ],
        },
      },
    });
    expect(harness.sentToolCalls[1]).toMatchObject({
      tool: 'create_component',
      params: {
        type: 'DebateScorecard',
        componentId: 'debate-scorecard-1000',
        messageId: 'debate-scorecard-1000',
      },
    });
    expect(harness.sentToolCalls[1]?.params).not.toHaveProperty('intentId');
    expect(harness.seedCalls).toEqual([
      expect.objectContaining({
        componentId: 'debate-scorecard-1000',
        intentId: 'debate-scorecard-1000',
        topic: 'Tax Reform',
      }),
    ]);
    expect(harness.seedCalls[0]).toHaveProperty('seedState');
    expect(harness.componentRegistry.get('debate-scorecard-1000')).toMatchObject({
      type: 'DebateScorecard',
      createdAt: 1_100,
      intentId: 'debate-scorecard-1000',
      room: 'room-a',
    });
    expect(harness.getLastProvisionedAt()).toBe(1_100);
    expect(harness.getLastComponentForType('DebateScorecard')).toBe('debate-scorecard-1000');
    expect(harness.getLastCreatedId()).toBe('debate-scorecard-1000');
  });

  it('uses inferred topic from context text when topic argument is omitted', async () => {
    const harness = createHarness();
    harness.componentRegistry.set(
      'score-latest',
      buildScorecardEntry({ topic: 'Healthcare Debate', createdAt: 500 }),
    );
    harness.componentRegistry.set(
      'score-inferred',
      buildScorecardEntry({ topic: 'Space Policy', createdAt: 100 }),
    );

    const ensured = await harness.service.ensure(
      undefined,
      'Can you update the debate scorecard about: Space Policy',
    );

    expect(ensured.componentId).toBe('score-inferred');
    expect(ensured.topic).toBe('Space Policy');
    expect(harness.sentToolCalls).toHaveLength(0);
    expect(harness.seedCalls).toHaveLength(0);
  });

  it('single-flights concurrent ensure calls so create flow runs once', async () => {
    let releaseReserve: (() => void) | null = null;
    const reserveGate = new Promise<void>((resolve) => {
      releaseReserve = resolve;
    });
    const harness = createHarness({
      now: (() => {
        let value = 9_000;
        return () => value++;
      })(),
      sendToolCall: async (tool) => {
        if (tool === 'reserve_component') {
          await reserveGate;
        }
      },
    });

    const first = harness.service.ensure('Nuclear Energy');
    const second = harness.service.ensure('Nuclear Energy');
    await Promise.resolve();

    expect(harness.sentToolCalls).toHaveLength(1);
    expect(harness.sentToolCalls[0]?.tool).toBe('reserve_component');

    if (!releaseReserve) {
      throw new Error('reserve gate was not initialized');
    }
    releaseReserve();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(harness.sentToolCalls.map((entry) => entry.tool)).toEqual([
      'reserve_component',
      'create_component',
    ]);
    expect(harness.seedCalls).toHaveLength(1);
  });
});

