import {
  buildCapabilitiesForProfile,
  queryCapabilities,
  type RoomLike,
  type SystemCapabilities,
} from './capabilities';

type DataHandler = (data: Uint8Array) => void;

class MockRoom implements RoomLike {
  private handlers = new Set<DataHandler>();
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly onQuery: (message: Record<string, unknown>) => void;

  constructor(onQuery: (message: Record<string, unknown>) => void) {
    this.onQuery = onQuery;
  }

  on = (_event: string, cb: (...args: unknown[]) => void) => {
    this.handlers.add(cb as DataHandler);
  };

  off = (_event: string, cb: (...args: unknown[]) => void) => {
    this.handlers.delete(cb as DataHandler);
  };

  localParticipant = {
    publishData: (data: Uint8Array) => {
      const parsed = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
      this.sent.push(parsed);
      if (parsed.type === 'capability_query') {
        this.onQuery(parsed);
      }
      return Promise.resolve();
    },
  };

  emitCapabilities(capabilities: SystemCapabilities, capabilityProfile: 'full' | 'lean_adaptive') {
    const payload = {
      type: 'capability_list',
      capabilityProfile,
      capabilities,
      timestamp: Date.now(),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    for (const handler of this.handlers) {
      handler(bytes);
    }
  }
}

describe('capabilities profile handling', () => {
  it('builds lean profile with Tier-1 components only', () => {
    const full = buildCapabilitiesForProfile(
      {
        tools: [{ name: 'create_component', description: 'create' }],
        components: [
          { name: 'CrowdPulseWidget', description: 'tier1 widget' },
          { name: 'OnboardingGuide', description: 'tier2 widget' },
        ],
      },
      'full',
    );
    const lean = buildCapabilitiesForProfile(full, 'lean_adaptive');

    expect(lean.capabilityProfile).toBe('lean_adaptive');
    expect(lean.components?.some((component) => component.name === 'CrowdPulseWidget')).toBe(true);
    expect(lean.components?.some((component) => component.name === 'OnboardingGuide')).toBe(false);
  });

  it('returns remote lean profile capabilities when available', async () => {
    const room = new MockRoom((message) => {
      if (message.capabilityProfile === 'lean_adaptive') {
        room.emitCapabilities(
          {
            tools: [{ name: 'create_component', description: 'create' }],
            components: [{ name: 'CrowdPulseWidget', description: 'tier1 widget' }],
          },
          'lean_adaptive',
        );
      }
    });

    const result = await queryCapabilities(room, {
      profile: 'lean_adaptive',
      timeoutMs: 20,
    });

    expect(result.capabilityProfile).toBe('lean_adaptive');
    expect(result.fallbackUsed).toBe(false);
    expect(result.source).toBe('remote');
    expect(result.capabilities.components?.[0]?.name).toBe('CrowdPulseWidget');
  });

  it('falls back to full profile when lean profile query misses', async () => {
    const room = new MockRoom((message) => {
      if (message.capabilityProfile === 'full') {
        room.emitCapabilities(
          {
            tools: [{ name: 'create_component', description: 'create' }],
            components: [{ name: 'OnboardingGuide', description: 'tier2 widget' }],
          },
          'full',
        );
      }
    });

    const result = await queryCapabilities(room, {
      profile: 'lean_adaptive',
      timeoutMs: 20,
      fallbackTimeoutMs: 50,
    });

    expect(result.requestedCapabilityProfile).toBe('lean_adaptive');
    expect(result.capabilityProfile).toBe('full');
    expect(result.fallbackUsed).toBe(true);
    expect(result.source).toBe('remote');
    expect(room.sent.map((message) => message.capabilityProfile)).toEqual([
      'lean_adaptive',
      'full',
    ]);
  });
});
