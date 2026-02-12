import { buildVoiceAgentInstructions } from '@/lib/agents/instructions';
import { buildCapabilitiesForProfile } from '@/lib/agents/capabilities';

describe('buildVoiceAgentInstructions profile behavior', () => {
  test('lean profile generates a shorter instruction set', () => {
    const fullCapabilities = buildCapabilitiesForProfile('full');
    const leanCapabilities = buildCapabilitiesForProfile('lean_adaptive');

    const fullInstructions = buildVoiceAgentInstructions(
      fullCapabilities,
      fullCapabilities.components || [],
      { profile: 'full' },
    );
    const leanInstructions = buildVoiceAgentInstructions(
      leanCapabilities,
      leanCapabilities.components || [],
      { profile: 'lean_adaptive' },
    );

    expect(leanInstructions.length).toBeLessThan(fullInstructions.length);
    expect(leanInstructions).toContain('Capability profile: lean_adaptive');
    expect(fullInstructions).toContain("Few‑shot Do / Don't");
  });
});
