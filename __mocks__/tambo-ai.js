// Mock for @tambo-ai/react
const mockState = {
  isExpanded: true,
  showParticipants: true,
  showSettings: false,
  compactMode: false,
  selectedParticipant: null,
  pinnedParticipants: [],
  handRaisedParticipants: [],
  isRecording: false,
  recordingStartTime: null,
  backgroundBlurEnabled: false,
  assistantState: 'idle',
  lastVoiceCommand: null,
  connectionIssues: {},
  networkQuality: 3, // Excellent
  canvasPosition: { x: 0, y: 0 },
  canvasSize: { width: 800, height: 60 },
  isCanvasFocused: false,
};

const mockSetState = jest.fn();

module.exports = {
  useTamboComponentState: jest.fn(() => [mockState, mockSetState]),
  TamboProvider: ({ children }) => children,
}; 