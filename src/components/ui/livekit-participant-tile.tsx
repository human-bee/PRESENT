/**
 * LivekitParticipantTile Component
 *
 * Shows video/audio for LiveKit participants in the room.
 * Can show a specific participant or all participants.
 *
 * CONTROLS:
 * - Click the video icon to toggle video on/off
 * - Click the microphone icon to toggle audio mute/unmute
 * - Use showVideo/showAudio props to control initial visibility
 * - Local participant can control their own video/audio
 * - Remote participants' controls depend on room permissions
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { z } from 'zod';
import {
  User,
  Bot,
  AlertCircle,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  Crown,
  ScreenShare,
  MoreHorizontal,
} from 'lucide-react';
import { useCanvasLiveKit } from './livekit-room-connector';
import {
  useParticipants,
  useLocalParticipant,
  useTracks,
  useTrackToggle,
  VideoTrack,
  AudioTrack,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useParticipantTileAgent } from '@/hooks/use-participant-tile-agent';
import { resolveParticipantDisplayName } from '@/lib/livekit/display-names';
import { useLivekitLocalDevices } from '@/hooks/use-livekit-local-devices';
import { ParticipantTileOptionsPanel } from './livekit-participant-options-panel';

// Define the component props schema with Zod
export const livekitParticipantTileSchema = z.object({
  // Participant Info
  participantIdentity: z
    .string()
    .optional()
    .describe(
      'The unique identity/ID of the participant to display (optional - shows all if not specified)',
    ),
  showToolbar: z
    .boolean()
    .optional()
    .describe('Whether to show the control toolbar (default: true)'),
  showVideo: z.boolean().optional().describe('Whether to show video track (default: true)'),
  showAudio: z.boolean().optional().describe('Whether to show audio controls (default: true)'),

  // Tile Configuration
  width: z.number().optional().describe('Width of the tile in pixels (default: 320)'),
  height: z.number().optional().describe('Height of the tile in pixels (default: 240)'),
  isLocal: z
    .boolean()
    .optional()
    .describe('Whether this is the local participant (affects available controls)'),

  // Visual Style
  borderRadius: z.number().optional().describe('Border radius in pixels (default: 12)'),
  showParticipantName: z
    .boolean()
    .optional()
    .describe('Whether to show participant name overlay (default: true)'),
  mirrorLocal: z
    .boolean()
    .optional()
    .describe('Mirror local self-view horizontally (default: true)'),
  fit: z.enum(['cover', 'contain']).optional().describe('Video object-fit policy (default: cover)'),
  trackPreference: z
    .enum(['auto', 'camera', 'screen'])
    .optional()
    .describe('Prefer which video source when both are present (default: auto)'),

  // Agent Detection
  isAgent: z
    .boolean()
    .optional()
    .describe('Whether this participant is an AI agent (shows bot icon)'),
});

// Define the props type based on the Zod schema
export type LivekitParticipantTileProps = z.infer<typeof livekitParticipantTileSchema>;

// Component state type
type LivekitParticipantTileState = {
  isMinimized: boolean;
  audioLevel: number;
  lastSpokeAt: number | null;
};

/**
 * LivekitParticipantTile Component
 *
 * Shows video/audio for LiveKit participants in the room.
 * Can show a specific participant or all participants.
 */
export const LivekitParticipantTile = React.memo(function LivekitParticipantTile({
  participantIdentity,
  showToolbar = true,
  showVideo = true,
  showAudio = true,
  width = 320,
  height = 240,

  borderRadius = 12,
  showParticipantName = true,
  isAgent = false,
  mirrorLocal = true,
  fit = 'cover',
  trackPreference = 'camera',
}: LivekitParticipantTileProps) {
  // Local component state
  const [state] = React.useState<LivekitParticipantTileState>({
    isMinimized: false,
    audioLevel: 0,
    lastSpokeAt: null,
  });

  // Selected participant override (for dropdown changes)
  const [selectedParticipantId, setSelectedParticipantId] = React.useState<string | null>(null);

  // Check Canvas LiveKit context (room connector status)
  const canvasLiveKit = useCanvasLiveKit();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Only log errors, not regular state changes
  React.useEffect(() => {
    if (!canvasLiveKit) {
      console.warn(
        `[ParticipantTile-${participantIdentity || 'all'}] No canvas context found - participant tiles may not work`,
      );
    }
  }, [participantIdentity, canvasLiveKit]);

  // If no room connector or not connected, show helpful message
  if (!canvasLiveKit || !canvasLiveKit.isConnected || !room) {
    return (
      <div
        className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 flex flex-col items-center justify-center gap-3"
        style={{ width, height: Math.max(height / 2, 140), borderRadius }}
      >
        <AlertCircle className="w-8 h-8 text-blue-600" />
        <div className="text-center">
          <p className="font-medium text-blue-800 mb-1">
            {!canvasLiveKit ? 'Room Connector Required' : 'Room Not Connected'}
          </p>
          <p className="text-xs text-blue-700 mb-2">
            {!canvasLiveKit
              ? 'Create a LivekitRoomConnector component first'
              : `Room "${canvasLiveKit.roomName}" is not connected yet`}
          </p>
          <p className="text-xs text-blue-600">
            Participant tiles work only when the room is connected.
          </p>
        </div>
      </div>
    );
  }

  // Resolve active participant id → participant
  const activeParticipantId =
    selectedParticipantId || participantIdentity || localParticipant?.identity || null;
  const participant = activeParticipantId
    ? (localParticipant?.identity === activeParticipantId ? localParticipant : null) ||
    participants.find((p) => p.identity === activeParticipantId) ||
    null
    : null;

  // If specific participant requested but not found
  if (activeParticipantId && !participant) {
    return (
      <div
        className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex flex-col items-center justify-center gap-2"
        style={{ width, height: Math.max(height / 2, 140), borderRadius }}
      >
        <User className="w-8 h-8 text-yellow-600" />
        <div className="text-center">
          <p className="font-medium text-yellow-800 mb-1">Participant Not Found</p>
          <p className="text-xs text-yellow-700 mb-2">
            Looking for: &quot;{activeParticipantId}&quot;
          </p>
          <p className="text-xs text-yellow-600 mb-2">Available participants:</p>
          <div className="text-xs text-yellow-600">
            {participants.length === 0 && localParticipant && (
              <div>• {localParticipant.identity} (you)</div>
            )}
            {participants.map((p) => (
              <div key={p.sid}>• {p.identity}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Show single participant tile
  if (participant) {
    return (
      <SingleParticipantTile
        participant={participant}
        isLocal={participant === localParticipant}
        width={width}
        height={height}
        borderRadius={borderRadius}
        showToolbar={showToolbar}
        showVideo={showVideo}
        showAudio={showAudio}
        showParticipantName={showParticipantName}
        isAgent={isAgent}
        mirrorLocal={mirrorLocal}
        fit={fit}
        trackPreference={trackPreference}
        onSelectParticipant={(id) => setSelectedParticipantId(id)}
        state={state}
      />
    );
  }

  // No participant resolved
  return (
    <div
      className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex flex-col items-center justify-center gap-2"
      style={{ width, height: Math.max(height / 2, 140), borderRadius }}
    >
      <AlertCircle className="w-8 h-8 text-yellow-600" />
      <div className="text-center">
        <p className="font-medium text-yellow-800 mb-1">No participant</p>
        <p className="text-xs text-yellow-700">Use tile settings to select a participant.</p>
      </div>
    </div>
  );
});

// Single participant tile component
function SingleParticipantTile({
  participant,
  isLocal,
  width,
  height,
  borderRadius,
  showToolbar,
  showVideo,
  showAudio,
  showParticipantName,
  isAgent,
  mirrorLocal,
  fit,
  trackPreference,
  onSelectParticipant,
  state,
}: {
  participant:
  | ReturnType<typeof useParticipants>[0]
  | ReturnType<typeof useLocalParticipant>['localParticipant'];
  isLocal: boolean;
  width: number;
  height: number;
  borderRadius: number;
  showToolbar: boolean;
  showVideo: boolean;
  showAudio: boolean;
  showParticipantName: boolean;
  isAgent: boolean;
  mirrorLocal: boolean;
  fit: 'cover' | 'contain';
  trackPreference: 'auto' | 'camera' | 'screen';
  onSelectParticipant?: (id: string) => void;
  state: LivekitParticipantTileState | undefined;
}) {
  const room = useRoomContext();

  // Use LiveKit hook to get reactive track references and filter to this participant
  const trackRefs = useTracks(
    [Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare],
    {
      onlySubscribed: false,
    },
  );

  const cameraTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) => t.participant?.identity === participant.identity && t.source === Track.Source.Camera,
      ),
    [trackRefs, participant.identity],
  );
  const audioTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) =>
          t.participant?.identity === participant.identity && t.source === Track.Source.Microphone,
      ),
    [trackRefs, participant.identity],
  );
  const screenTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) =>
          t.participant?.identity === participant.identity && t.source === Track.Source.ScreenShare,
      ),
    [trackRefs, participant.identity],
  );

  const pickVideoTrack = () => {
    if (trackPreference === 'camera') return cameraTrackRef;
    if (trackPreference === 'screen') return screenTrackRef || cameraTrackRef;
    // auto: prefer screen share when present and not muted
    if (screenTrackRef && !screenTrackRef.publication?.isMuted) return screenTrackRef;
    return cameraTrackRef;
  };
  const videoTrackRef = pickVideoTrack();

  const videoPublication = videoTrackRef?.publication;
  const audioPublication = audioTrackRef?.publication;

  const participantMetadata = (participant as { metadata?: string | null })?.metadata ?? null;
  const displayName = React.useMemo(
    () =>
      resolveParticipantDisplayName({
        name: participant?.name,
        identity: participant.identity,
        metadata: participantMetadata,
      }),
    [participant?.name, participant.identity, participantMetadata],
  );

  // (Minimize handled elsewhere)

  // Background agent for state sync and control events
  const { state: agentState, events } = useParticipantTileAgent({
    participantId: participant.identity,
    isLocal,
  });

  const micToggle = useTrackToggle(Track.Source.Microphone);
  const cameraToggle = useTrackToggle(Track.Source.Camera);

  const toggleLocalMicrophone = React.useCallback(async () => {
    if (!isLocal) return;
    const nextEnabled = agentState.audioMuted;
    type LocalMicControl = {
      setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
    };
    const localControls = participant as unknown as LocalMicControl | null;
    if (localControls?.setMicrophoneEnabled) {
      try {
        await localControls.setMicrophoneEnabled(nextEnabled);
        return;
      } catch {}
    }
    const roomControls = room?.localParticipant as unknown as LocalMicControl | null;
    if (roomControls?.setMicrophoneEnabled) {
      try {
        await roomControls.setMicrophoneEnabled(nextEnabled);
        return;
      } catch {}
    }
    try {
      await micToggle?.toggle();
    } catch {}
  }, [agentState.audioMuted, isLocal, micToggle, participant, room]);

  const toggleLocalCamera = React.useCallback(async () => {
    if (!isLocal) return;
    const nextEnabled = agentState.videoMuted;
    type LocalCameraControl = {
      setCameraEnabled?: (enabled: boolean) => Promise<void>;
    };
    const localControls = participant as unknown as LocalCameraControl | null;
    if (localControls?.setCameraEnabled) {
      try {
        await localControls.setCameraEnabled(nextEnabled);
        return;
      } catch {}
    }
    const roomControls = room?.localParticipant as unknown as LocalCameraControl | null;
    if (roomControls?.setCameraEnabled) {
      try {
        await roomControls.setCameraEnabled(nextEnabled);
        return;
      } catch {}
    }
    try {
      await cameraToggle?.toggle();
    } catch {}
  }, [agentState.videoMuted, cameraToggle, isLocal, participant, room]);

  // Overlay visibility with hover timers (show after 2s, hide 1.5s after leave)
  const [overlayVisible, setOverlayVisible] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const showTimerRef = React.useRef<number | null>(null);
  const hideTimerRef = React.useRef<number | null>(null);

  // Local mute state for remote participant audio playback
  const [playbackMuted, setPlaybackMuted] = React.useState(false);
  React.useEffect(() => {
    setPlaybackMuted(false);
  }, [participant.identity]);

  const effectiveAudioMuted = isLocal
    ? agentState.audioMuted
    : playbackMuted || agentState.audioMuted;

  // Detect coarse pointer (mobile/touch) to adjust interaction model
  const [isCoarsePointer, setIsCoarsePointer] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(pointer: coarse)');
    setIsCoarsePointer(!!mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsCoarsePointer(!!e.matches);
    try {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } catch {
      // Safari < 14 fallback using legacy listener types without TS directives
      const legacy = mql as unknown as {
        addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
        removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener?.(onChange);
      return () => legacy.removeListener?.(onChange);
    }
  }, []);

  // On touch devices, keep overlay visible rather than relying on hover
  React.useEffect(() => {
    if (isCoarsePointer) setOverlayVisible(true);
  }, [isCoarsePointer]);

  const onEnter = () => {
    if (isCoarsePointer) return;
    setHovering(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!overlayVisible) {
      showTimerRef.current = window.setTimeout(() => setOverlayVisible(true), 600);
    }
  };

  const onLeave = () => {
    if (isCoarsePointer) return;
    setHovering(false);
    if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setOverlayVisible(false), 1500);
  };

  React.useEffect(() => {
    return () => {
      if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts for local user: M (mute), V (video)
  React.useEffect(() => {
    if (!isLocal) return;
    const onKey = (e: KeyboardEvent) => {
      if (!hovering && !overlayVisible) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        void toggleLocalMicrophone();
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        void toggleLocalCamera();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLocal, hovering, overlayVisible, toggleLocalCamera, toggleLocalMicrophone]);

  // Options dropdown anchored to tile controls
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  const [selectedQuality, setSelectedQuality] = React.useState<'auto' | 'low' | 'high'>('auto');
  const optionsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const optionsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [optionsAnchor, setOptionsAnchor] = React.useState<{
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  } | null>(null);
  const [optionsPanelStyle, setOptionsPanelStyle] = React.useState<React.CSSProperties | null>(null);

  const updateOptionsAnchor = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const node = optionsButtonRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setOptionsAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const handleOptionsButtonRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      optionsButtonRef.current = node;
      if (node && optionsOpen) {
        updateOptionsAnchor();
      }
    },
    [optionsOpen, updateOptionsAnchor],
  );

  const {
    audioDevices,
    videoDevices,
    microphoneSelectValue,
    cameraSelectValue,
    refreshDevices,
    handleMicrophoneSelect,
    handleCameraSelect,
  } = useLivekitLocalDevices({ room, isLocal });

  React.useEffect(() => {
    if (!optionsOpen) return;
    void refreshDevices();
  }, [optionsOpen, refreshDevices]);

  React.useEffect(() => {
    if (!optionsOpen) {
      setOptionsPanelStyle(null);
      return;
    }
    updateOptionsAnchor();
    const handleViewportChange = () => {
      updateOptionsAnchor();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [optionsOpen, updateOptionsAnchor]);

  React.useEffect(() => {
    if (!optionsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOptionsOpen(false);
        optionsButtonRef.current?.focus?.();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        (target && optionsPanelRef.current?.contains(target)) ||
        (target && optionsButtonRef.current?.contains(target))
      ) {
        return;
      }
      setOptionsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [optionsOpen]);

  React.useLayoutEffect(() => {
    if (!optionsOpen) return;
    if (typeof window === 'undefined') return;
    const anchor = optionsAnchor;
    const panel = optionsPanelRef.current;
    if (!anchor || !panel) return;
    const panelRect = panel.getBoundingClientRect();
    const verticalGap = isCoarsePointer ? 20 : 16;
    const horizontalGap = isCoarsePointer ? 16 : 12;

    let top = anchor.top - panelRect.height - verticalGap;
    if (top < 12) {
      top = Math.min(anchor.bottom + verticalGap, window.innerHeight - panelRect.height - 12);
    }
    let left = anchor.right - panelRect.width;
    if (left < 12) {
      left = 12;
    }
    const maxLeft = window.innerWidth - panelRect.width - 12;
    if (left > maxLeft) {
      left = Math.max(12, maxLeft);
    }

    setOptionsPanelStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 1000,
    });
  }, [optionsOpen, optionsAnchor, isCoarsePointer]);

  const allParticipants = React.useMemo(() => {
    const arr: { id: string; name: string }[] = [];
    if (room?.localParticipant) {
      arr.push({
        id: room.localParticipant.identity,
        name: resolveParticipantDisplayName({
          name: room.localParticipant.name,
          identity: room.localParticipant.identity,
          metadata: room.localParticipant.metadata,
        }),
      });
    }
    room?.remoteParticipants?.forEach((p) => {
      arr.push({
        id: p.identity,
        name: resolveParticipantDisplayName({
          name: p.name,
          identity: p.identity,
          metadata: p.metadata,
        }),
      });
    });
    return arr;
  }, [room?.localParticipant, room?.remoteParticipants]);

  const optionsPanel = (
    <ParticipantTileOptionsPanel
      isOpen={optionsOpen}
      anchor={optionsAnchor}
      panelRef={optionsPanelRef}
      panelStyle={optionsPanelStyle}
      isCoarsePointer={isCoarsePointer}
      onClose={() => setOptionsOpen(false)}
      onRefreshDevices={() => {
        void refreshDevices();
      }}
      participantId={participant.identity}
      allParticipants={allParticipants}
      onSelectParticipant={onSelectParticipant}
      isLocal={isLocal}
      audioDevices={audioDevices}
      videoDevices={videoDevices}
      microphoneSelectValue={microphoneSelectValue}
      cameraSelectValue={cameraSelectValue}
      onSelectMicrophone={handleMicrophoneSelect}
      onSelectCamera={handleCameraSelect}
      selectedQuality={selectedQuality}
      onSelectQuality={(quality) => {
        setSelectedQuality(quality);
        void events.setQuality(quality);
      }}
    />
  );

  return (
    <>
      <div
        className={cn(
          'relative bg-black border-2 border-gray-300 overflow-hidden transition-all duration-200 touch-manipulation',
          agentState.isSpeaking && 'border-green-400 shadow-lg shadow-green-400/25',
          state?.isMinimized && '!h-16',
        )}
        style={{
          width,
          height: state?.isMinimized ? 64 : height,
          borderRadius,
        }}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
      {/* Video Container */}
      {showVideo && !state?.isMinimized && videoTrackRef && !videoPublication?.isMuted && (
        <div
          className={cn(
            'absolute inset-0 w-full h-full',
            isLocal && mirrorLocal && '[transform:scaleX(-1)]',
          )}
          style={{ transformOrigin: 'center' }}
        >
          <VideoTrack
            trackRef={videoTrackRef}
            playsInline
            className={cn(
              'w-full h-full bg-black',
              fit === 'contain' ? 'object-contain' : 'object-cover',
            )}
          />
        </div>
      )}

      {/* Video muted/disabled placeholder */}
      {showVideo && !state?.isMinimized && videoPublication && videoPublication.isMuted && (
        <div
          className={cn(
            'absolute inset-0 bg-gray-900 flex items-center justify-center',
            isLocal && mirrorLocal && '[transform:scaleX(-1)]',
          )}
          style={{ transformOrigin: 'center' }}
        >
          <div className="text-center text-white">
            <VideoOff className="w-12 h-12 mx-auto mb-2 opacity-75" />
            <p className="text-sm opacity-75">Video disabled</p>
          </div>
        </div>
      )}

      {/* No video track placeholder */}
      {showVideo && !state?.isMinimized && !videoPublication && (
        <div
          className={cn(
            'absolute inset-0 bg-gray-800 flex items-center justify-center',
            isLocal && mirrorLocal && '[transform:scaleX(-1)]',
          )}
          style={{ transformOrigin: 'center' }}
        >
          <div className="text-center text-white">
            {isAgent ? (
              <Bot className="w-12 h-12 mx-auto mb-2 opacity-75" />
            ) : (
              <User className="w-12 h-12 mx-auto mb-2 opacity-75" />
            )}
            <p className="text-sm opacity-75">{isLocal ? 'Click camera to enable' : 'No video'}</p>
          </div>
        </div>
      )}

      {/* Audio Track */}
      {showAudio && audioTrackRef && !audioPublication?.isMuted && !playbackMuted && (
        <AudioTrack trackRef={audioTrackRef} />
      )}

      {/* Participant Name Overlay */}
      {showParticipantName && (
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          <div className="bg-black/60 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5">
            {isAgent && <Bot className="w-3.5 h-3.5 text-blue-400" />}
            {isLocal && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
            <span className="text-white text-xs font-medium truncate max-w-[120px]">
              {displayName}
            </span>
          </div>
        </div>
      )}

      {/* Speaking Indicator */}
      {agentState.isSpeaking && (
        <div className="absolute bottom-2 left-2">
          <div className="bg-green-500/80 backdrop-blur-sm rounded-full p-1.5">
            <Volume2 className="w-3 h-3 text-white animate-pulse" />
          </div>
        </div>
      )}

      {/* Hover Controls Overlay (non-blocking except controls) */}
      {showToolbar && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none select-none',
            overlayVisible ? 'opacity-100' : 'opacity-0',
            'transition-opacity duration-200',
          )}
          aria-hidden={!overlayVisible}
        >
          <div
            className="absolute bottom-2 right-2 pointer-events-auto"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <div className="bg-black/55 backdrop-blur-md rounded-lg p-1.5 flex items-center gap-1 shadow-lg">
              <button
                aria-label={
                  effectiveAudioMuted
                    ? isLocal
                      ? 'Unmute microphone'
                      : 'Unmute participant audio'
                    : isLocal
                      ? 'Mute microphone'
                      : 'Mute participant audio'
                }
                aria-keyshortcuts={isLocal ? 'M' : undefined}
                onClick={async () => {
                  if (isLocal) {
                    await toggleLocalMicrophone();
                    return;
                  }
                  setPlaybackMuted((prev) => !prev);
                }}
                className={cn(
                  'w-11 h-11 rounded-md grid place-items-center transition-colors',
                  effectiveAudioMuted
                    ? 'bg-red-500/80 text-white hover:bg-red-600/80'
                    : 'bg-white/10 text-white hover:bg-white/20',
                )}
              >
                {effectiveAudioMuted ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              <button
                aria-label={agentState.videoMuted ? 'Turn camera on' : 'Turn camera off'}
                aria-keyshortcuts="V"
                onClick={async () => {
                  await toggleLocalCamera();
                }}
                className={cn(
                  'w-11 h-11 rounded-md grid place-items-center transition-colors',
                  agentState.videoMuted
                    ? 'bg-red-500/80 text-white hover:bg-red-600/80'
                    : 'bg-white/10 text-white hover:bg-white/20',
                )}
              >
                {agentState.videoMuted ? (
                  <VideoOff className="w-4 h-4" />
                ) : (
                  <Video className="w-4 h-4" />
                )}
              </button>

              {isLocal && (
                <button
                  aria-label={agentState.screenSharing ? 'Stop screen share' : 'Start screen share'}
                  onClick={async () => {
                    const sharing = await events.toggleScreenShare();
                    if (sharing) {
                      try {
                        const messageId = `screenshare-${participant.identity}-${Date.now()}`;
                        const { LivekitScreenShareTile } = await import(
                          './livekit-screenshare-tile'
                        );
                        const TileComponent =
                          LivekitScreenShareTile as unknown as React.ComponentType<
                            Record<string, unknown>
                          >;
                        const element = React.createElement(TileComponent, {
                          __custom_message_id: messageId,
                          participantIdentity: participant.identity,
                          width,
                          height,
                          fit: 'contain',
                        });
                        window.dispatchEvent(
                          new CustomEvent('custom:showComponent', {
                            detail: { messageId, component: element },
                          }),
                        );
                      } catch { }
                    }
                  }}
                  className="w-11 h-11 rounded-md grid place-items-center bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  <ScreenShare className="w-4 h-4" />
                </button>
              )}

              <button
                aria-label="Tile options"
                onClick={() => {
                  setOptionsOpen(true);
                  updateOptionsAnchor();
                }}
                ref={handleOptionsButtonRef}
                className="w-11 h-11 rounded-md grid place-items-center bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dedicated mobile options button (always visible on touch devices) */}
      {showToolbar && isCoarsePointer && !state?.isMinimized && (
        <div className="absolute bottom-2 right-2 pointer-events-auto">
          <button
            aria-label="Tile options"
            onClick={() => {
              setOptionsOpen(true);
              updateOptionsAnchor();
            }}
            ref={handleOptionsButtonRef}
            className="w-11 h-11 rounded-full bg-black/55 text-white backdrop-blur-md grid place-items-center shadow-lg"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Minimized View */}
      {state?.isMinimized && (
        <div className="absolute inset-0 bg-gray-800 flex items-center px-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isAgent ? (
              <Bot className="w-4 h-4 text-blue-400 flex-shrink-0" />
            ) : (
              <User className="w-4 h-4 text-white flex-shrink-0" />
            )}
            <span className="text-white text-sm font-medium truncate">
              {displayName}
            </span>
            {agentState.isSpeaking && (
              <Volume2 className="w-3 h-3 text-green-400 animate-pulse flex-shrink-0" />
            )}
          </div>
        </div>
      )}

      </div>
      {optionsPanel}
    </>
  );
}

// Default export for convenience
export default LivekitParticipantTile;
