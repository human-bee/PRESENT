import { act, render, screen } from '@testing-library/react';
import CrowdPulseWidget from '@/components/ui/productivity/crowd-pulse-widget';

let capturedApplyPatch: ((patch: Record<string, unknown>) => void) | null = null;
const originalRandomUuid = globalThis.crypto?.randomUUID;

jest.mock('@/lib/component-registry', () => ({
  useComponentRegistration: (
    _messageId: string,
    _componentType: string,
    _props: unknown,
    _contextKey: string,
    applyPatch: (patch: Record<string, unknown>) => void,
  ) => {
    capturedApplyPatch = applyPatch;
  },
}));

describe('CrowdPulseWidget question ledger', () => {
  beforeAll(() => {
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => 'test-uuid' },
        configurable: true,
      });
      return;
    }
    if (typeof globalThis.crypto.randomUUID !== 'function') {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: () => 'test-uuid',
        configurable: true,
      });
    }
  });

  afterAll(() => {
    if (!globalThis.crypto) return;
    if (typeof originalRandomUuid === 'function') {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: originalRandomUuid,
        configurable: true,
      });
      return;
    }
    try {
      // Keep the fallback polyfill in tests when no native implementation exists.
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: () => 'test-uuid',
        configurable: true,
      });
    } catch {
      // noop
    }
  });

  beforeEach(() => {
    capturedApplyPatch = null;
  });

  it('auto-appends activeQuestion into question queue when questions patch is an empty array', () => {
    render(
      <CrowdPulseWidget
        __custom_message_id="crowd-test-1"
        title="Launch Readiness"
        sensorEnabled={false}
        questions={[]}
      />,
    );

    expect(typeof capturedApplyPatch).toBe('function');

    act(() => {
      capturedApplyPatch?.({
        activeQuestion: 'What blocks GA?',
        questions: [],
      });
    });

    const renderedQuestionText = screen.getAllByText('What blocks GA?');
    // One render is the live question, one render is the question queue entry.
    expect(renderedQuestionText.length).toBeGreaterThanOrEqual(2);
  });

  it('treats an explicit empty-string activeQuestion as a clear operation', () => {
    render(
      <CrowdPulseWidget
        __custom_message_id="crowd-test-2"
        title="Launch Readiness"
        sensorEnabled={false}
        questions={[]}
      />,
    );

    act(() => {
      capturedApplyPatch?.({ activeQuestion: 'Can we ship Friday?' });
    });

    expect(screen.queryByText('Live Question')).not.toBeNull();

    act(() => {
      capturedApplyPatch?.({ activeQuestion: '' });
    });

    expect(screen.queryByText('Live Question')).toBeNull();
  });
});
