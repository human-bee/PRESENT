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
import { Track, Room, RoomEvent } from 'livekit-client';
import { useParticipantTileAgent } from '@/hooks/use-participant-tile-agent';

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
  const [audioDevices, setAudioDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [activeMicrophoneId, setActiveMicrophoneId] = React.useState<string | null>(null);
  const [activeCameraId, setActiveCameraId] = React.useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = React.useState<'auto' | 'low' | 'high'>('auto');
  const optionsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const optionsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const handleOptionsButtonRef = React.useCallback((node: HTMLButtonElement | null) => {
    optionsButtonRef.current = node;
  }, []);

  type StoredDeviceInfo = {
    deviceId: string;
    label?: string | null;
    groupId?: string | null;
  };

  const getStoredDevice = React.useCallback(
    (kind: 'audioinput' | 'videoinput'): StoredDeviceInfo | null => {
      if (typeof window === 'undefined') return null;
      const key = `livekit:lastDevice:${kind}`;
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredDeviceInfo;
          if (parsed && typeof parsed.deviceId === 'string' && parsed.deviceId.length > 0) {
            return parsed;
          }
        }
      } catch {}
      try {
        const legacyKey = kind === 'audioinput' ? 'livekit:lastMicId' : 'livekit:lastCamId';
        const legacyId = window.localStorage.getItem(legacyKey);
        if (legacyId) {
          return { deviceId: legacyId };
        }
      } catch {}
      return null;
    },
    [],
  );

  const persistStoredDevice = React.useCallback(
    (kind: 'audioinput' | 'videoinput', info: StoredDeviceInfo) => {
      if (typeof window === 'undefined' || !info.deviceId) return;
      try {
        const payload: StoredDeviceInfo = {
          deviceId: info.deviceId,
          label: info.label ?? '',
          groupId: info.groupId ?? '',
        };
        window.localStorage.setItem(`livekit:lastDevice:${kind}`, JSON.stringify(payload));
        const legacyKey = kind === 'audioinput' ? 'livekit:lastMicId' : 'livekit:lastCamId';
        window.localStorage.setItem(legacyKey, info.deviceId);
      } catch {}
    },
    [],
  );

  const matchStoredDevice = React.useCallback(
    (devices: MediaDeviceInfo[], stored: StoredDeviceInfo | null) => {
      if (!stored) return undefined;
      const byId = devices.find((device) => device.deviceId === stored.deviceId);
      if (byId) return byId;
      if (stored.groupId) {
        const byGroup = devices.find(
          (device) => device.groupId && device.groupId === stored.groupId,
        );
        if (byGroup) return byGroup;
      }
      if (stored.label) {
        const labelLower = stored.label.toLowerCase();
        const byLabel = devices.find(
          (device) => device.label && device.label.toLowerCase() === labelLower,
        );
        if (byLabel) return byLabel;
      }
      return undefined;
    },
    [],
  );

  const room = useRoomContext();

  const updateActiveDevicesFromRoom = React.useCallback(() => {
    if (!isLocal) return;
    const mic = room?.getActiveDevice?.('audioinput');
    const cam = room?.getActiveDevice?.('videoinput');
    if (mic) setActiveMicrophoneId(mic);
    if (cam) setActiveCameraId(cam);
  }, [isLocal, room]);

  const refreshDevices = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const [audioInputs, videoInputs] = await Promise.all([
        Room.getLocalDevices('audioinput', true),
        Room.getLocalDevices('videoinput', true),
      ]);
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      updateActiveDevicesFromRoom();
      return;
    } catch {}
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      if (!list) return;
      const audioInputs = list.filter((device) => device.kind === 'audioinput');
      const videoInputs = list.filter((device) => device.kind === 'videoinput');
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      updateActiveDevicesFromRoom();
    } catch {}
  }, [updateActiveDevicesFromRoom]);

  const switchLocalDevice = React.useCallback(
    async (kind: 'audioinput' | 'videoinput', deviceId: string) => {
      if (!isLocal || !room) return;
      try {
        type DeviceSwitchRoom = {
          switchActiveDevice?: (
            kind: 'audioinput' | 'videoinput',
            deviceId: string,
            exact?: boolean,
          ) => Promise<boolean> | Promise<void>;
          localParticipant?: {
            setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
            setCameraEnabled?: (enabled: boolean) => Promise<void>;
          };
        };
        const deviceRoom = room as unknown as DeviceSwitchRoom;
        await deviceRoom.switchActiveDevice?.(kind, deviceId, true);
        if (kind === 'audioinput') {
          await deviceRoom.localParticipant?.setMicrophoneEnabled?.(true);
        } else {
          await deviceRoom.localParticipant?.setCameraEnabled?.(true);
        }
      } catch {}
    },
    [isLocal, room],
  );

  React.useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  React.useEffect(() => {
    if (!optionsOpen) return;
    void refreshDevices();
  }, [optionsOpen, refreshDevices]);

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

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    const handler = () => {
      void refreshDevices();
    };
    try {
      navigator.mediaDevices.addEventListener('devicechange', handler);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handler);
      };
    } catch {
      const mediaDevices = navigator.mediaDevices as unknown as {
        ondevicechange: null | (() => void);
      };
      const previous = mediaDevices.ondevicechange;
      mediaDevices.ondevicechange = handler;
      return () => {
        if (mediaDevices.ondevicechange === handler) {
          mediaDevices.ondevicechange = previous ?? null;
        }
      };
    }
  }, [refreshDevices]);

  React.useEffect(() => {
    if (!room) return;
    const handleMediaDevicesChanged = () => {
      void refreshDevices();
    };
    // @ts-expect-error runtime event ensured by LiveKit typings
    room.on(RoomEvent.MediaDevicesChanged, handleMediaDevicesChanged);
    return () => {
      // @ts-expect-error runtime event ensured by LiveKit typings
      room.off(RoomEvent.MediaDevicesChanged, handleMediaDevicesChanged);
    };
  }, [room, refreshDevices]);

  // Auto-select last used microphone/camera for the local participant
  React.useEffect(() => {
    if (!isLocal || !room) return;
    try {
      type DeviceSwitchRoom = {
        switchActiveDevice?: (
          kind: 'audioinput' | 'videoinput',
          deviceId: string,
          exact?: boolean,
        ) => Promise<boolean> | Promise<void>;
        localParticipant?: {
          setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
          setCameraEnabled?: (enabled: boolean) => Promise<void>;
        };
        state?: string;
      };
      const deviceRoom = room as unknown as DeviceSwitchRoom;
      const restore = async () => {
        try {
          const isConnected = (deviceRoom.state as unknown as string) === 'connected';
          if (!isConnected) return;
          const [audioInputs, videoInputs] = await Promise.all([
            Room.getLocalDevices('audioinput', true),
            Room.getLocalDevices('videoinput', true),
          ]);
          setAudioDevices(audioInputs);
          setVideoDevices(videoInputs);
          const storedMic = matchStoredDevice(audioInputs, getStoredDevice('audioinput'));
          const storedCam = matchStoredDevice(videoInputs, getStoredDevice('videoinput'));
          if (storedMic) {
            await switchLocalDevice('audioinput', storedMic.deviceId);
            setActiveMicrophoneId(storedMic.deviceId);
            persistStoredDevice('audioinput', storedMic);
          }
          if (storedCam) {
            await switchLocalDevice('videoinput', storedCam.deviceId);
            setActiveCameraId(storedCam.deviceId);
            persistStoredDevice('videoinput', storedCam);
          }
        } catch {}
      };
      const timeout = window.setTimeout(() => {
        void restore();
      }, 220);
      return () => window.clearTimeout(timeout);
    } catch {}
  }, [getStoredDevice, isLocal, matchStoredDevice, persistStoredDevice, room, switchLocalDevice]);

  React.useEffect(() => {
    if (!isLocal || !room) return;
    const onActiveDeviceChanged = (kind: 'audioinput' | 'videoinput', deviceId?: string) => {
      if (!deviceId) return;
      if (kind === 'audioinput') {
        setActiveMicrophoneId(deviceId);
        const selected = audioDevices.find((device) => device.deviceId === deviceId);
        persistStoredDevice('audioinput', {
          deviceId,
          label: selected?.label ?? '',
          groupId: selected?.groupId ?? '',
        });
      }
      if (kind === 'videoinput') {
        setActiveCameraId(deviceId);
        const selected = videoDevices.find((device) => device.deviceId === deviceId);
        persistStoredDevice('videoinput', {
          deviceId,
          label: selected?.label ?? '',
          groupId: selected?.groupId ?? '',
        });
      }
    };
    // @ts-expect-error runtime event ensured by LiveKit typings
    room.on(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged);
    return () => {
      // @ts-expect-error runtime event ensured by LiveKit typings
      room.off(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged);
    };
  }, [audioDevices, isLocal, persistStoredDevice, room, videoDevices]);

  const allParticipants = React.useMemo(() => {
    const arr = [] as { id: string; name: string }[];
    if (room?.localParticipant)
      arr.push({
        id: room.localParticipant.identity,
        name: room.localParticipant.name || room.localParticipant.identity,
      });
    room?.remoteParticipants?.forEach((p) =>
      arr.push({ id: p.identity, name: p.name || p.identity }),
    );
    return arr;
  }, [room?.localParticipant, room?.remoteParticipants]);

  const microphoneSelectValue =
    activeMicrophoneId && audioDevices.some((device) => device.deviceId === activeMicrophoneId)
      ? activeMicrophoneId
      : '';
  const cameraSelectValue =
    activeCameraId && videoDevices.some((device) => device.deviceId === activeCameraId)
      ? activeCameraId
      : '';

  return (
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
              {participant.name || participant.identity}
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
                onClick={() => setOptionsOpen(true)}
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
            onClick={() => setOptionsOpen(true)}
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
              {participant.name || participant.identity}
            </span>
            {agentState.isSpeaking && (
              <Volume2 className="w-3 h-3 text-green-400 animate-pulse flex-shrink-0" />
            )}
          </div>
        </div>
      )}

      {/* Tile options dropdown */}
      {optionsOpen && (
        <div
          ref={optionsPanelRef}
          className={cn(
            'absolute right-2 z-[60] w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-white/10 bg-zinc-900/95 p-3 text-white shadow-xl backdrop-blur-md',
            isCoarsePointer ? 'bottom-20' : 'bottom-16',
          )}
          role="dialog"
          aria-modal="false"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Tile Options</div>
            <button
              aria-label="Close tile options"
              onClick={() => setOptionsOpen(false)}
              className="rounded-full px-2 py-1 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          {isLocal && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/70">Devices</div>
                <button
                  className="rounded px-2 py-1 text-xs transition hover:bg-white/20 bg-white/10"
                  onClick={() => {
                    void refreshDevices();
                  }}
                >
                  Refresh
                </button>
              </div>
              <div>
                <div className="mb-1 text-xs text-white/70">Participant</div>
                <select
                  className="w-full rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  value={participant.identity}
                  onChange={(event) => {
                    try {
                      onSelectParticipant?.(event.target.value);
                    } catch {}
                  }}
                >
                  {allParticipants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-white/70">Microphone</div>
                <select
                  className="w-full rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  value={microphoneSelectValue}
                  onChange={async (event) => {
                    const nextDeviceId = event.target.value;
                    setActiveMicrophoneId(nextDeviceId);
                    try {
                      await switchLocalDevice('audioinput', nextDeviceId);
                      const selectedDevice = audioDevices.find(
                        (device) => device.deviceId === nextDeviceId,
                      );
                      persistStoredDevice('audioinput', {
                        deviceId: nextDeviceId,
                        label: selectedDevice?.label ?? '',
                        groupId: selectedDevice?.groupId ?? '',
                      });
                    } catch {}
                  }}
                >
                  <option value="" disabled>
                    {audioDevices.length ? 'Select a microphone' : 'No microphones found'}
                  </option>
                  {audioDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || 'Microphone'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-white/70">Camera</div>
                <select
                  className="w-full rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  value={cameraSelectValue}
                  onChange={async (event) => {
                    const nextDeviceId = event.target.value;
                    setActiveCameraId(nextDeviceId);
                    try {
                      await switchLocalDevice('videoinput', nextDeviceId);
                      const selectedDevice = videoDevices.find(
                        (device) => device.deviceId === nextDeviceId,
                      );
                      persistStoredDevice('videoinput', {
                        deviceId: nextDeviceId,
                        label: selectedDevice?.label ?? '',
                        groupId: selectedDevice?.groupId ?? '',
                      });
                    } catch {}
                  }}
                >
                  <option value="" disabled>
                    {videoDevices.length ? 'Select a camera' : 'No cameras found'}
                  </option>
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || 'Camera'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-white/70">Stream Quality</div>
                <div className="flex gap-2">
                  {(['auto', 'low', 'high'] as const).map((quality) => (
                    <button
                      key={quality}
                      className={cn(
                        'rounded px-2 py-1 text-xs transition-colors',
                        selectedQuality === quality
                          ? 'bg-white/20 text-white'
                          : 'bg-white/10 text-white hover:bg-white/20',
                      )}
                      onClick={() => {
                        setSelectedQuality(quality);
                        events.setQuality(quality);
                      }}
                    >
                      {quality}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              className="rounded bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('tldraw:pin', {
                    detail: { participantId: participant.identity },
                  }),
                );
                setOptionsOpen(false);
              }}
            >
              Pin
            </button>
            <button
              className="rounded bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('tldraw:pinOnTop', {
                    detail: { participantId: participant.identity },
                  }),
                );
                setOptionsOpen(false);
              }}
            >
              Pin on top
            </button>
            <button
              className="rounded bg-white/20 px-3 py-1.5 text-sm transition hover:bg-white/30"
              onClick={() => setOptionsOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Default export for convenience
export default LivekitParticipantTile;
