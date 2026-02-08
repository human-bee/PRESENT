import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpeechTranscriptionView } from './speech-transcription-view';

describe('SpeechTranscriptionView', () => {
  it('renders status and respects canStart', () => {
    const onClear = jest.fn();
    const onStartListening = jest.fn();
    const onStopListening = jest.fn();

    render(
      <SpeechTranscriptionView
        isListening={false}
        tone="warning"
        statusText="Waiting for agent"
        roomConnected={false}
        agentIdentity={null}
        canStart={false}
        transcriptions={[]}
        onClear={onClear}
        onStartListening={onStartListening}
        onStopListening={onStopListening}
      />,
    );

    expect(screen.getByText('Waiting for agent')).toBeTruthy();
    const start = screen.getByRole('button', { name: /start listening/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    const clear = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('shows stop button when listening', () => {
    const onStopListening = jest.fn();

    render(
      <SpeechTranscriptionView
        isListening={true}
        tone="success"
        statusText="Agent active and listening"
        roomConnected={true}
        agentIdentity="voice-agent"
        canStart={true}
        transcriptions={[
          {
            id: 't1',
            speaker: 'voice-agent',
            text: 'Hello',
            timestamp: Date.now(),
            isFinal: true,
            source: 'agent',
          },
        ]}
        onClear={() => {}}
        onStartListening={() => {}}
        onStopListening={onStopListening}
      />,
    );

    const stop = screen.getByRole('button', { name: /stop listening/i });
    fireEvent.click(stop);
    expect(onStopListening).toHaveBeenCalledTimes(1);
  });
});

