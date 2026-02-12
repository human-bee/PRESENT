import {
  buildCapabilitiesForProfile,
  defaultCapabilities,
  defaultLeanCapabilities,
  queryCapabilities,
  resolveCapabilityProfile,
  type RoomLike,
} from '@/lib/agents/capabilities';

describe('capability profiles', () => {
  test('resolves profile aliases', () => {
    expect(resolveCapabilityProfile('lean')).toBe('lean_adaptive');
    expect(resolveCapabilityProfile('adaptive')).toBe('lean_adaptive');
    expect(resolveCapabilityProfile('full')).toBe('full');
    expect(resolveCapabilityProfile(undefined)).toBe('full');
  });

  test('lean profile is smaller than full profile', () => {
    const full = buildCapabilitiesForProfile('full');
    const lean = buildCapabilitiesForProfile('lean_adaptive');

    expect(lean.tools.length).toBeLessThan(full.tools.length);
    expect((lean.components || []).length).toBeLessThan((full.components || []).length);
    expect(lean.capabilityProfile).toBe('lean_adaptive');
  });

  test('tier1 widget metadata is included', () => {
    const full = buildCapabilitiesForProfile('full');
    const crowdPulse = (full.components || []).find((component) => component.name === 'CrowdPulseWidget');

    expect(crowdPulse?.tier).toBe('tier1');
    expect(crowdPulse?.critical).toBe(true);
    expect(crowdPulse?.lifecycleOps).toEqual(
      expect.arrayContaining(['create', 'update', 'hydrate', 'fill', 'edit', 'remove', 'recover']),
    );
  });

  test('query fallback returns full profile when lean request times out', async () => {
    let onHandler: ((data: Uint8Array) => void) | null = null;
    const room: RoomLike = {
      on: (_event, cb) => {
        onHandler = cb;
      },
      off: () => {},
      localParticipant: {
        publishData: () => undefined,
      },
    };

    const response = await queryCapabilities(room, {
      profile: 'lean_adaptive',
      timeoutMs: 1,
    });

    expect(onHandler).not.toBeNull();
    expect(response.tools.length).toBe(defaultCapabilities.tools.length);
    expect(response.capabilityProfile).toBe(defaultCapabilities.capabilityProfile);
    expect(response.fallbackReason).toBe('timeout');
  });

  test('default lean capability export stays stable', () => {
    expect(defaultLeanCapabilities.capabilityProfile).toBe('lean_adaptive');
    expect(defaultLeanCapabilities.tools.length).toBeGreaterThan(5);
  });
});
