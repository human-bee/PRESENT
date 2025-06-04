import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LiveCaptions from './LiveCaptions';

// Mock the dependencies
jest.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ name: 'test-room', state: 'connected' }),
  useDataChannel: () => {},
  useParticipants: () => [],
}));

jest.mock('@tambo-ai/react', () => ({
  useTamboComponentState: () => [
    {
      transcripts: [],
      isConnected: true,
      participantCount: 1,
      canvasSize: { width: 800, height: 600 },
      settings: {
        showSpeakerAvatars: true,
        showTimestamps: true,
        enableDragAndDrop: true,
        maxTranscripts: 50,
        autoPosition: true,
        exportFormat: 'txt' as const,
        canvasTheme: 'dots' as const,
      },
    },
    jest.fn(),
  ],
}));

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('LiveCaptions', () => {
  it('renders without crashing', () => {
    render(<LiveCaptions />);
    expect(screen.getByText('Live Captions')).toBeInTheDocument();
  });

  it('shows connected status', () => {
    render(<LiveCaptions />);
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
  });

  it('shows empty state when no transcripts', () => {
    render(<LiveCaptions />);
    expect(screen.getByText('Waiting for speech...')).toBeInTheDocument();
  });

  it('shows caption count', () => {
    render(<LiveCaptions />);
    expect(screen.getByText('0 captions')).toBeInTheDocument();
  });
}); 