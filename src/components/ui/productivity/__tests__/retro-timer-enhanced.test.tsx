import React from 'react';
import { render, cleanup, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RetroTimerEnhanced } from '../retro-timer-enhanced';
import { ComponentRegistry } from '@/lib/component-registry';

afterEach(() => {
  cleanup();
  ComponentRegistry.clear();
});

describe('RetroTimerEnhanced AI updates', () => {
  it('accepts numeric strings in patch and updates countdown', async () => {
    render(<RetroTimerEnhanced componentId="test-timer" />);

    const messageId = 'timer-test-timer-5min';

    await act(async () => {
      await ComponentRegistry.update(messageId, { initialMinutes: '7' } as Record<string, unknown>);
    });

    expect(await screen.findByText('07:00')).toBeInTheDocument();
  });

  it('auto-starts when patch boolean is provided as string', async () => {
    render(<RetroTimerEnhanced componentId="autostart-timer" />);

    const messageId = 'timer-autostart-timer-5min';

    await act(async () => {
      await ComponentRegistry.update(messageId, { autoStart: 'true' } as Record<string, unknown>);
    });

    expect(await screen.findByRole('button', { name: /pause timer/i })).toBeInTheDocument();
  });
});
