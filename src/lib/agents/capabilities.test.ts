import {
  buildCapabilitiesForProfile,
  queryCapabilities,
  resolveCapabilityProfile,
  type RoomLike,
  type SystemCapabilities,
} from './capabilities';

type DataHandler = (data: Uint8Array) => void;

class MockRoom implements RoomLike {
  private readonly handlers = new Set<DataHandler>();
  private readonly onQuery: (message: Record<string, unknown>) => void;
  readonly sentProfiles: string[] = [];

  constructor(onQuery: (message: Record<string, unknown>) => void) {
    this.onQuery = onQuery;
  }

  on = (_event: string, cb: (...args: any[]) => void) => {
    this.handlers.add(cb as DataHandler);
  };

  off = (_event: string, cb: (...args: any[]) => void) => {
    this.handlers.delete(cb as DataHandler);
  };

  localParticipant = {
    publishData: (data: Uint8Array) => {
      const message = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
      if (message.type === 'capability_query') {
        const profile = typeof message.capabilityProfile === 'string' ? message.capabilityProfile : 'full';
        this.sentProfiles.push(profile);
        this.onQuery(message);
      }
      return undefined;
    },
  };

  emitCapabilities(capabilities: SystemCapabilities, capabilityProfile: 'full' | 'lean_adaptive') {
    const payload = {
      type: 'capability_list',
      capabilityProfile,
      capabilities,
      timestamp: Date.now(),
    };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    for (const handler of this.handlers) {
      handler(encoded);
    }
  }
}

describe('capabilities', () => {
  it('accepts capability profile aliases', () => {
    expect(resolveCapabilityProfile('lean')).toBe('lean_adaptive');
    expect(resolveCapabilityProfile('adaptive')).toBe('lean_adaptive');
    expect(resolveCapabilityProfile('full')).toBe('full');
  });

  it('preserves manifest-derived resolve lifecycle metadata', () => {
    const full = buildCapabilitiesForProfile('full');
    const crowdPulse = full.components?.find((component) => component.name === 'CrowdPulseWidget');
    expect(crowdPulse?.lifecycleOps).toEqual(expect.arrayContaining(['create', 'resolve', 'update', 'recover']));
  });

  it('includes do_nothing in lean toolset', () => {
    const lean = buildCapabilitiesForProfile('lean_adaptive');
    expect(lean.tools.some((tool) => tool.name === 'do_nothing')).toBe(true);
  });

  it('uses remote lean response when available', async () => {
    const room = new MockRoom((message) => {
      if (message.capabilityProfile === 'lean_adaptive') {
        room.emitCapabilities(
          {
            tools: [{ name: 'create_component', description: 'create' }],
            components: [
              {
                name: 'CrowdPulseWidget',
                description: 'Crowd pulse',
                tier: 'tier1',
                group: 'widget-lifecycle',
                lifecycleOps: ['create', 'resolve', 'update'],
              },
            ],
            capabilityProfile: 'lean_adaptive',
          },
          'lean_adaptive',
        );
      }
    });

    const result = await queryCapabilities(room, { profile: 'lean_adaptive', timeoutMs: 50 });
    expect(result.capabilityProfile).toBe('lean_adaptive');
    expect(result.fallbackReason).toBeUndefined();
    expect(room.sentProfiles).toEqual(['lean_adaptive']);
  });

  it('falls back to full when lean request times out', async () => {
    const room = new MockRoom(() => {
      // no-op (timeout path)
    });

    const result = await queryCapabilities(room, { profile: 'lean_adaptive', timeoutMs: 1 });
    expect(result.capabilityProfile).toBe('full');
    expect(result.fallbackReason).toBe('timeout');
  });
});
