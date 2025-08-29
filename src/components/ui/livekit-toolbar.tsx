'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { z } from 'zod';
import {
  useLocalParticipant,
  useParticipants,
  useTrackToggle,
  useIsMuted,
  useConnectionQualityIndicator,
  useRoomContext,
  useRemoteParticipants,
} from '@livekit/components-react';
import { Track, ConnectionQuality, Participant } from 'livekit-client';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  Hand,
  SignalLow,
  SignalMedium,
  SignalHigh,
  Circle,
  Square,
  X,
  Pin,
  UserX,
  MoreHorizontal,
  AlertTriangle,
  Wifi,
} from 'lucide-react';
import { createLiveKitBus } from '../../lib/livekit/livekit-bus';

// Custom Unpin icon as alternative
const Unpin = ({ className }: { className?: string }) => (
  <div className={className}>
    <Pin className="w-full h-full rotate-45" />
  </div>
);

// Enhanced schema for real-world usage
export const livekitToolbarSchema = z.object({
  // Room Configuration
  roomName: z.string().optional().describe('Current room name'),
  enableVoiceCommands: z
    .boolean()
    .optional()
    .default(true)
    .describe('Enable voice control for toolbar'),
  enableParticipantControls: z
    .boolean()
    .optional()
    .default(true)
    .describe('Show individual participant controls'),
  enableAdaptiveUI: z
    .boolean()
    .optional()
    .default(true)
    .describe('Automatically show/hide controls based on context'),

  // Moderation Settings
  moderationEnabled: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable host moderation controls'),
  autoMuteOnJoin: z.boolean().optional().default(false).describe('Auto-mute participants on join'),
  maxParticipants: z.number().optional().describe('Maximum participants allowed'),

  // UI Preferences
  compactMode: z
    .boolean()
    .optional()
    .default(false)
    .describe('Use compact layout for smaller screens'),
  showConnectionStatus: z
    .boolean()
    .optional()
    .default(true)
    .describe('Show connection quality indicators'),
  showParticipantList: z
    .boolean()
    .optional()
    .default(true)
    .describe('Show expandable participant list'),

  // Feature Toggles
  features: z
    .object({
      recording: z.boolean().optional().default(true),
      screenShare: z.boolean().optional().default(true),
      chat: z.boolean().optional().default(true),
      handRaise: z.boolean().optional().default(true),
      backgroundBlur: z.boolean().optional().default(true),
      aiAssistant: z.boolean().optional().default(true),
    })
    .optional(),
});

export type LivekitToolbarProps = z.infer<typeof livekitToolbarSchema>;

// Enhanced state type for real participant management
type LivekitToolbarState = {
  // UI State
  isExpanded: boolean;
  showParticipants: boolean;
  showSettings: boolean;
  compactMode: boolean;

  // Interaction State
  selectedParticipant: string | null;
  pinnedParticipants: string[];
  handRaisedParticipants: string[];

  // Media State
  isRecording: boolean;
  recordingStartTime: Date | null;
  backgroundBlurEnabled: boolean;

  // AI Assistant State
  assistantState: 'idle' | 'listening' | 'thinking' | 'speaking';
  lastVoiceCommand: string | null;

  // Connection State
  connectionIssues: Record<string, boolean>;
  networkQuality: ConnectionQuality;

  // Canvas State
  canvasPosition: { x: number; y: number };
  canvasSize: { width: number; height: number };
  isCanvasFocused: boolean;
};

type ParticipantControlsProps = {
  participant: Participant;
  isLocal: boolean;
  isModerator: boolean;
  onMute: () => void;
  onKick?: () => void;
  onPin: () => void;
  isPinned: boolean;
};

// Individual participant controls component
const ParticipantControls: React.FC<ParticipantControlsProps> = ({
  participant,
  isLocal,
  isModerator,
  onMute,
  onKick,
  onPin,
  isPinned,
}) => {
  const [showControls, setShowControls] = React.useState(false);
  const isMuted = useIsMuted(Track.Source.Microphone, participant);
  const connectionQuality = useConnectionQualityIndicator(participant);

  return (
    <div
      className="relative group touch-manipulation"
      onPointerEnter={() => setShowControls(true)}
      onPointerLeave={() => setShowControls(false)}
    >
      {/* Participant Avatar/Video */}
      <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <span className="text-white text-sm font-semibold">
          {participant.name?.charAt(0)?.toUpperCase() || '?'}
        </span>

        {/* Status indicators */}
        <div className="absolute bottom-0 right-0 flex gap-0.5">
          {isMuted && (
            <div className="w-3 h-3 bg-red-500 rounded-full flex items-center justify-center">
              <MicOff className="w-2 h-2 text-white" />
            </div>
          )}
          {connectionQuality === ConnectionQuality.Poor && (
            <div className="w-3 h-3 bg-amber-500 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-2 h-2 text-white" />
            </div>
          )}
        </div>
      </div>

      {/* Hover controls */}
      {showControls && !isLocal && (
        <div className="absolute top-0 left-full ml-2 bg-black/90 backdrop-blur-sm rounded-lg p-2 flex gap-1 z-50">
          <button
            onClick={onMute}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <Mic className="w-3 h-3 text-white" />
            ) : (
              <MicOff className="w-3 h-3 text-white" />
            )}
          </button>

          <button
            onClick={onPin}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            title={isPinned ? 'Unpin' : 'Pin participant'}
          >
            {isPinned ? (
              <Unpin className="w-3 h-3 text-white" />
            ) : (
              <Pin className="w-3 h-3 text-white" />
            )}
          </button>

          {isModerator && onKick && (
            <button
              onClick={onKick}
              className="p-1 hover:bg-red-500/50 rounded transition-colors"
              title="Remove participant"
            >
              <UserX className="w-3 h-3 text-white" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Feature-Complete LiveKit Toolbar
 *
 * A living, breathing video conferencing control center that adapts to real room state,
 * manages individual participants intelligently, and provides context-aware controls.
 * Built following custom principles for complete, connected, delightful experiences.
 */
export function LivekitToolbar({
  roomName,
  enableVoiceCommands = true,
  enableParticipantControls = true,
  enableAdaptiveUI = true,
  moderationEnabled = false,
  compactMode = false,
  showConnectionStatus = true,
  showParticipantList = true,
  features = {},
}: LivekitToolbarProps) {
  const componentId = `livekit-toolbar-${roomName || 'default'}`;

  // MOVED ALL HOOKS OUTSIDE TRY-CATCH - ALWAYS CALL HOOKS
  const roomContext = useRoomContext();
  const bus = createLiveKitBus(roomContext);

  // Always call LiveKit hooks - handle errors with conditional logic instead
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const connectionQuality = useConnectionQualityIndicator(localParticipant);

  // Media controls with real LiveKit integration - always call hooks
  const micToggle = useTrackToggle(Track.Source.Microphone);
  const cameraToggle = useTrackToggle(Track.Source.Camera);
  const screenShareToggle = useTrackToggle(Track.Source.ScreenShare);

  // Local state management
  const [state, setState] = React.useState<LivekitToolbarState>({
    isExpanded: !compactMode,
    showParticipants: showParticipantList && participants.length > 2,
    showSettings: false,
    compactMode,
    selectedParticipant: null,
    pinnedParticipants: [],
    handRaisedParticipants: [],
    isRecording: false,
    recordingStartTime: null,
    backgroundBlurEnabled: false,
    assistantState: 'idle',
    lastVoiceCommand: null,
    connectionIssues: {},
    networkQuality: connectionQuality || ConnectionQuality.Unknown,
    canvasPosition: { x: 0, y: 0 },
    canvasSize: { width: 800, height: 60 },
    isCanvasFocused: false,
  });

  // Extract values from hooks - handle potential errors with conditional logic
  const toggleMic = micToggle?.toggle || (() => { });
  const micEnabled = micToggle?.enabled || false;
  const toggleCamera = cameraToggle?.toggle || (() => { });
  const cameraEnabled = cameraToggle?.enabled || false;
  const toggleScreenShare = screenShareToggle?.toggle || (() => { });
  const screenShareEnabled = screenShareToggle?.enabled || false;

  // Real recording functionality
  const handleStartRecording = React.useCallback(async () => {
    if (!state) return;

    try {
      if (!state.isRecording) {
        // Start recording via room API
        await room?.startRecording?.();
        setState({
          ...state,
          isRecording: true,
          recordingStartTime: new Date(),
        });
      } else {
        // Stop recording
        await room?.stopRecording?.();
        setState({
          ...state,
          isRecording: false,
          recordingStartTime: null,
        });
      }
    } catch (error) {
      console.error('Recording operation failed:', error);
    }
  }, [room, state, setState]);

  // Real hand raise functionality
  const handleRaiseHand = React.useCallback(() => {
    if (!state) return;

    const isRaised = state.handRaisedParticipants.includes(localParticipant?.identity || '');

    // Send data channel message
    bus.send('hand_raise', {
      type: isRaised ? 'LOWER_HAND' : 'RAISE_HAND',
      participantId: localParticipant?.identity || '',
      timestamp: Date.now(),
    });

    setState({
      ...state,
      handRaisedParticipants: isRaised
        ? state.handRaisedParticipants.filter((id) => id !== (localParticipant?.identity || ''))
        : [...state.handRaisedParticipants, localParticipant?.identity || ''],
    });
  }, [state, setState, localParticipant?.identity, bus]);

  // Voice command integration
  React.useEffect(() => {
    const off = bus.on('voice-commands', (commandRaw) => {
      if (!enableVoiceCommands || !state) return;
      try {
        const command = commandRaw as { type: string };

        switch (command.type) {
          case 'MUTE_ALL':
            if (moderationEnabled) {
              participants.forEach((p) => {
                if (!p.isLocal) {
                  // Implement mute all participants
                  room?.localParticipant?.publishData(
                    new TextEncoder().encode(
                      JSON.stringify({
                        type: 'MUTE_REQUEST',
                        targetId: p.identity,
                      }),
                    ),
                    { reliable: true },
                  );
                }
              });
            }
            break;
          case 'TOGGLE_MIC':
            toggleMic();
            break;
          case 'TOGGLE_CAMERA':
            toggleCamera();
            break;
          case 'START_RECORDING':
            handleStartRecording();
            break;
          case 'RAISE_HAND':
            handleRaiseHand();
            break;
        }

        setState({
          ...state,
          lastVoiceCommand: command.type,
          assistantState: 'idle',
        });
      } catch (error) {
        console.error('Failed to parse voice command:', error);
      }
    });
    return off;
  }, [
    bus,
    enableVoiceCommands,
    moderationEnabled,
    participants,
    room?.localParticipant,
    setState,
    state,
    toggleMic,
    toggleCamera,
    handleStartRecording,
    handleRaiseHand,
  ]);

  // Real-time participant monitoring
  React.useEffect(() => {
    if (!state) return;

    // Update participant count and adaptive UI
    const shouldShowParticipants = enableAdaptiveUI ? participants.length > 2 : showParticipantList;

    const shouldCompact = enableAdaptiveUI
      ? participants.length > 8 || window.innerWidth < 768
      : compactMode;

    setState({
      ...state,
      showParticipants: shouldShowParticipants,
      compactMode: shouldCompact,
      networkQuality: connectionQuality,
    });
  }, [
    participants.length,
    connectionQuality,
    enableAdaptiveUI,
    showParticipantList,
    compactMode,
    setState,
    state,
  ]);

  // Canvas integration - component lives on canvas
  // This effect is disabled to prevent recursive rendering issues
  // The component should be rendered directly by the user or AI in the proper LiveKit context
  // React.useEffect(() => {
  //   window.dispatchEvent(
  //     new CustomEvent("custom:showComponent", {
  //       detail: {
  //         messageId: componentId,
  //         component: <LivekitToolbar {...{ roomName, enableVoiceCommands, enableParticipantControls, enableAdaptiveUI, moderationEnabled, autoMuteOnJoin, maxParticipants, compactMode, showConnectionStatus, showParticipantList, features }} />,
  //         position: state?.canvasPosition,
  //         size: state?.canvasSize,
  //       }
  //     })
  //   );
  // }, [componentId, state?.canvasPosition, state?.canvasSize]);

  // Participant management functions
  const handleMuteParticipant = (participantId: string) => {
    if (!moderationEnabled) return;

    bus.send('moderation', { type: 'MUTE_REQUEST', targetId: participantId });
  };

  const handlePinParticipant = (participantId: string) => {
    if (!state) return;

    const isPinned = state.pinnedParticipants.includes(participantId);

    setState({
      ...state,
      pinnedParticipants: isPinned
        ? state.pinnedParticipants.filter((id) => id !== participantId)
        : [...state.pinnedParticipants, participantId],
    });

    // Notify canvas about layout change
    window.dispatchEvent(
      new CustomEvent('custom:layoutUpdate', {
        detail: {
          pinnedParticipants: isPinned
            ? state.pinnedParticipants.filter((id) => id !== participantId)
            : [...state.pinnedParticipants, participantId],
        },
      }),
    );
  };

  const handleKickParticipant = async (participantId: string) => {
    if (!moderationEnabled) return;

    try {
      // Implement kick functionality through room API
      await room?.removeParticipant?.(participantId);
    } catch (error) {
      console.error('Failed to kick participant:', error);
    }
  };

  // Connection quality indicator
  const getConnectionIcon = (quality: ConnectionQuality) => {
    switch (quality) {
      case ConnectionQuality.Poor:
        return <SignalLow className="w-4 h-4 text-red-500" />;
      case ConnectionQuality.Good:
        return <SignalMedium className="w-4 h-4 text-yellow-500" />;
      case ConnectionQuality.Excellent:
        return <SignalHigh className="w-4 h-4 text-green-500" />;
      default:
        return <Wifi className="w-4 h-4 text-gray-500" />;
    }
  };

  // Don't render if no room connection
  if (!room || !state) {
    return (
      <div className="flex items-center justify-center p-4 bg-background border border-border rounded-xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span>
            LiveKit toolbar requires a connected LiveKit room. Please create a LivekitRoomConnector
            component first.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-lg transition-all duration-300',
        state.compactMode ? 'p-2' : 'p-3',
        state.isCanvasFocused ? 'ring-2 ring-primary' : '',
      )}
      style={{
        width: state.canvasSize.width,
        minWidth: state.compactMode ? '300px' : '400px',
      }}
    >
      {/* Main Controls Row */}
      <div className="flex items-center justify-between gap-2">
        {/* Essential Media Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMic}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200',
              micEnabled
                ? 'bg-background hover:bg-accent text-foreground'
                : 'bg-red-500 hover:bg-red-600 text-white',
            )}
          >
            {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleCamera}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200',
              cameraEnabled
                ? 'bg-background hover:bg-accent text-foreground'
                : 'bg-red-500 hover:bg-red-600 text-white',
            )}
          >
            {cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>

          {features.screenShare && (
            <button
              onClick={toggleScreenShare}
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200',
                screenShareEnabled
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-background hover:bg-accent text-foreground',
              )}
            >
              <ScreenShare className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Participant Indicators - Smart Display */}
        {state.showParticipants && enableParticipantControls && (
          <div className="flex items-center gap-1 max-w-xs overflow-x-auto">
            {participants.slice(0, state.compactMode ? 4 : 8).map((participant) => (
              <ParticipantControls
                key={participant.identity}
                participant={participant}
                isLocal={participant.isLocal}
                isModerator={moderationEnabled}
                onMute={() => handleMuteParticipant(participant.identity)}
                onKick={() => handleKickParticipant(participant.identity)}
                onPin={() => handlePinParticipant(participant.identity)}
                isPinned={state.pinnedParticipants.includes(participant.identity)}
              />
            ))}

            {participants.length > (state.compactMode ? 4 : 8) && (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground text-xs">
                +{participants.length - (state.compactMode ? 4 : 8)}
              </div>
            )}
          </div>
        )}

        {/* Smart Action Controls */}
        <div className="flex items-center gap-1">
          {/* Hand Raise - Context Aware */}
          {features.handRaise && (
            <button
              onClick={handleRaiseHand}
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200',
                state.handRaisedParticipants.includes(localParticipant?.identity || '')
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-white animate-pulse'
                  : 'bg-background hover:bg-accent text-foreground',
              )}
            >
              <Hand className="w-4 h-4" />
            </button>
          )}

          {/* Recording - Only show when relevant */}
          {features.recording && (moderationEnabled || state.isRecording) && (
            <button
              onClick={handleStartRecording}
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200',
                state.isRecording
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-background hover:bg-accent text-foreground',
              )}
            >
              {state.isRecording ? <Square className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            </button>
          )}

          {/* Connection Status - Always visible when poor */}
          {showConnectionStatus && (
            <div className="flex items-center justify-center w-9 h-9">
              {getConnectionIcon(state.networkQuality)}
            </div>
          )}

          {/* Overflow Menu - Appears when needed */}
          <button
            onClick={() => setState({ ...state, showSettings: !state.showSettings })}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-background hover:bg-accent text-foreground transition-all duration-200"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {/* Leave Call - Always accessible */}
          <button
            onClick={() => room.disconnect()}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-all duration-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expandable Settings Panel */}
      {state.showSettings && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span>Participants</span>
              <span className="text-muted-foreground">{participants.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Recording</span>
              <span
                className={cn(
                  'text-xs',
                  state.isRecording ? 'text-red-500' : 'text-muted-foreground',
                )}
              >
                {state.isRecording ? 'LIVE' : 'Off'}
              </span>
            </div>
            {state.isRecording && state.recordingStartTime && (
              <div className="col-span-2 flex items-center justify-between">
                <span>Duration</span>
                <span className="text-xs text-red-500">
                  {Math.floor((Date.now() - state.recordingStartTime.getTime()) / 1000)}s
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Voice Command Feedback */}
      {enableVoiceCommands && state.lastVoiceCommand && (
        <div className="mt-2 px-2 py-1 bg-primary/10 border border-primary/20 rounded text-xs text-primary">
          Voice command: {state.lastVoiceCommand.replace('_', ' ').toLowerCase()}
        </div>
      )}
    </div>
  );
}

export default LivekitToolbar;
