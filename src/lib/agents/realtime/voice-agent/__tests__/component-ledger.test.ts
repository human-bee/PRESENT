import {
  COMPONENT_INTENT_LEDGER_TTL_MS,
  type ResolveComponentContext,
  VoiceComponentLedger,
} from '../component-ledger';

type TestComponentEntry = {
  type: string;
  intentId?: string;
  slot?: string;
  room?: string;
};

describe('VoiceComponentLedger', () => {
  it('tracks per-room last component state independently', () => {
    let room = 'room-a';
    const ledger = new VoiceComponentLedger(() => room);

    ledger.setLastComponentForType('DebateScorecard', 'score-a');
    ledger.setLastCreatedComponentId('score-a');
    ledger.setRecentCreateFingerprint('DebateScorecard', {
      fingerprint: 'f-a',
      messageId: 'score-a',
      createdAt: 1,
      turnId: 1,
      intentId: 'intent-a',
    });

    room = 'room-b';
    expect(ledger.getLastComponentForType('DebateScorecard')).toBeUndefined();
    expect(ledger.getLastCreatedComponentId()).toBeNull();
    expect(ledger.getRecentCreateFingerprint('DebateScorecard')).toBeUndefined();

    ledger.setLastComponentForType('DebateScorecard', 'score-b');
    expect(ledger.getLastComponentForType('DebateScorecard')).toBe('score-b');

    room = 'room-a';
    expect(ledger.getLastComponentForType('DebateScorecard')).toBe('score-a');
    expect(ledger.getLastCreatedComponentId()).toBe('score-a');
    expect(ledger.getRecentCreateFingerprint('DebateScorecard')?.intentId).toBe('intent-a');
  });

  it('resolves component ids using componentId > intentId > slot > type > last precedence', () => {
    let room = 'room-a';
    const ledger = new VoiceComponentLedger(() => room);
    const components = new Map<string, TestComponentEntry>([
      ['intent-component', { type: 'Timer', intentId: 'intent-a', room: 'room-a' }],
      ['slot-component', { type: 'Timer', slot: 'slot-a', room: 'room-a' }],
      ['type-component', { type: 'Timer', room: 'room-a' }],
      ['last-component', { type: 'TodoList', room: 'room-a' }],
    ]);
    const context: ResolveComponentContext = {
      getComponentEntry: (id) => components.get(id),
      listComponentEntries: () => components.entries(),
    };

    ledger.registerIntentEntry({
      intentId: 'intent-a',
      messageId: 'intent-component',
      componentType: 'Timer',
      state: 'created',
    });
    ledger.registerIntentEntry({
      intentId: 'slot-intent-a',
      messageId: 'slot-component',
      componentType: 'Timer',
      slot: 'slot-a',
      state: 'created',
    });
    ledger.setLastComponentForType('Timer', 'type-component');
    ledger.setLastCreatedComponentId('last-component');

    expect(
      ledger.resolveComponentId(
        { componentId: ' explicit-id ', intentId: 'intent-a', slot: 'slot-a', type: 'Timer' },
        context,
      ),
    ).toBe('explicit-id');
    expect(ledger.resolveComponentId({ intentId: 'intent-a', slot: 'slot-a', type: 'Timer' }, context)).toBe(
      'intent-component',
    );
    expect(ledger.resolveComponentId({ slot: 'slot-a', type: 'Timer' }, context)).toBe('slot-component');
    expect(ledger.resolveComponentId({ type: 'Timer' }, context)).toBe('type-component');
    expect(ledger.resolveComponentId({}, context)).toBe('last-component');
  });

  it('keeps intent and resolve behavior scoped per room', () => {
    let room = 'room-a';
    const ledger = new VoiceComponentLedger(() => room);
    const components = new Map<string, TestComponentEntry>([
      ['room-a-intent-component', { type: 'Timer', room: 'room-a' }],
      ['room-a-slot-component', { type: 'Timer', room: 'room-a' }],
      ['room-b-intent-component', { type: 'Timer', room: 'room-b' }],
      ['room-b-slot-component', { type: 'Timer', room: 'room-b' }],
    ]);
    const context: ResolveComponentContext = {
      getComponentEntry: (id) => components.get(id),
      listComponentEntries: () => components.entries(),
    };

    ledger.registerIntentEntry({
      intentId: 'room-a-intent',
      messageId: 'room-a-intent-component',
      componentType: 'Timer',
      state: 'created',
    });
    ledger.registerIntentEntry({
      intentId: 'room-a-slot-intent',
      messageId: 'room-a-slot-component',
      componentType: 'Timer',
      slot: 'slot-main',
      state: 'created',
    });

    room = 'room-b';
    ledger.registerIntentEntry({
      intentId: 'room-b-intent',
      messageId: 'room-b-intent-component',
      componentType: 'Timer',
      state: 'created',
    });
    ledger.registerIntentEntry({
      intentId: 'room-b-slot-intent',
      messageId: 'room-b-slot-component',
      componentType: 'Timer',
      slot: 'slot-main',
      state: 'created',
    });

    expect(
      ledger.resolveComponentId(
        { intentId: 'room-a-intent', type: 'NonMatchingType' },
        context,
      ),
    ).toBe('');
    expect(ledger.resolveComponentId({ intentId: 'room-b-intent' }, context)).toBe('room-b-intent-component');
    expect(ledger.resolveComponentId({ slot: 'slot-main' }, context)).toBe('room-b-slot-component');
    expect(ledger.findIntentByMessage('room-a-intent-component')).toBeUndefined();

    room = 'room-a';
    expect(ledger.resolveComponentId({ intentId: 'room-a-intent' }, context)).toBe('room-a-intent-component');
    expect(ledger.resolveComponentId({ slot: 'slot-main' }, context)).toBe('room-a-slot-component');
    expect(ledger.findIntentByMessage('room-b-intent-component')).toBeUndefined();
  });

  it('expires stale intent entries and removes slot/message mappings', () => {
    let room = 'room-a';
    const ledger = new VoiceComponentLedger(() => room);
    const components = new Map<string, TestComponentEntry>([
      ['ttl-component', { type: 'Timer', room: 'room-a' }],
    ]);
    const context: ResolveComponentContext = {
      getComponentEntry: (id) => components.get(id),
      listComponentEntries: () => components.entries(),
    };

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    ledger.registerIntentEntry({
      intentId: 'ttl-intent',
      messageId: 'ttl-component',
      componentType: 'Timer',
      slot: 'ttl-slot',
      state: 'created',
    });
    nowSpy.mockRestore();

    expect(ledger.findIntentByMessage('ttl-component')?.intentId).toBe('ttl-intent');
    expect(ledger.resolveComponentId({ slot: 'ttl-slot' }, context)).toBe('ttl-component');

    ledger.cleanupExpired(1_000 + COMPONENT_INTENT_LEDGER_TTL_MS - 1);
    expect(ledger.findIntentByMessage('ttl-component')?.intentId).toBe('ttl-intent');
    expect(ledger.resolveComponentId({ slot: 'ttl-slot' }, context)).toBe('ttl-component');

    ledger.cleanupExpired(1_000 + COMPONENT_INTENT_LEDGER_TTL_MS + 1);
    expect(ledger.findIntentByMessage('ttl-component')).toBeUndefined();
    expect(ledger.resolveComponentId({ slot: 'ttl-slot' }, context)).toBe('');
  });

  it('recovers from stale component ids by resolving latest matching type', () => {
    const ledger = new VoiceComponentLedger(() => 'room-a');
    const components = new Map<string, TestComponentEntry>([
      ['crowd-current', { type: 'CrowdPulseWidget', room: 'room-a' }],
    ]);
    const context: ResolveComponentContext = {
      getComponentEntry: (id) => components.get(id),
      listComponentEntries: () => components.entries(),
    };

    ledger.setLastComponentForType('CrowdPulseWidget', 'crowd-stale');
    ledger.setLastCreatedComponentId('crowd-stale');
    ledger.registerIntentEntry({
      intentId: 'crowd-intent',
      messageId: 'crowd-stale',
      componentType: 'CrowdPulseWidget',
      state: 'updated',
    });
    ledger.clearIntentForMessage('crowd-stale');
    ledger.clearLastComponentForType('CrowdPulseWidget', 'crowd-stale');

    const resolved = ledger.resolveComponentId(
      { type: 'CrowdPulseWidget', allowLast: true },
      context,
    );

    expect(resolved).toBe('crowd-current');
  });
});
