'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { AudioTrack, useRoomContext } from '@livekit/components-react';
import { useParticipantTileAgent } from '@/hooks/use-participant-tile-agent';
import { resolveParticipantDisplayName } from '@/lib/livekit/display-names';
import { useTileOverlay } from '@/hooks/livekit/use-tile-overlay';
import { useAnchoredPanel } from '@/hooks/livekit/use-anchored-panel';
import { useParticipantTracks, ParticipantEntity } from '@/hooks/livekit/use-participant-tracks';
import { useLocalMediaControls } from '@/hooks/livekit/use-local-media-controls';
import { useLivekitLocalDevices } from '@/hooks/livekit/use-livekit-local-devices';
import { ParticipantTileOptionsPanel } from './livekit-participant-options-panel';
import { ParticipantVideoLayer } from './participant-video-layer';
import { ParticipantToolbar } from './participant-toolbar';
import { ParticipantMinimizedView } from './participant-minimized-view';
import { ParticipantNameOverlay } from './participant-name-overlay';
import { ParticipantSpeakingIndicator } from './participant-speaking-indicator';

export type LivekitParticipantTileState = {
  isMinimized: boolean;
  audioLevel: number;
  lastSpokeAt: number | null;
};

export type SingleParticipantTileProps = {
  participant: ParticipantEntity;
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
};

export function SingleParticipantTile({
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
}: SingleParticipantTileProps) {
  const room = useRoomContext();
  const { videoTrackRef, audioTrackRef, videoPublication, audioPublication } = useParticipantTracks(
    participant,
    trackPreference,
  );
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
  const { state: agentState, events } = useParticipantTileAgent({
    participantId: participant.identity,
    isLocal,
  });
  const { toggleLocalMicrophone, toggleLocalCamera } = useLocalMediaControls(
    participant,
    isLocal,
    agentState.audioMuted,
    agentState.videoMuted,
  );
  const [playbackMuted, setPlaybackMuted] = React.useState(false);
  React.useEffect(() => {
    setPlaybackMuted(false);
  }, [participant.identity]);
  const effectiveAudioMuted = isLocal
    ? agentState.audioMuted
    : playbackMuted || agentState.audioMuted;
  const {
    overlayVisible,
    hovering,
    isCoarsePointer,
    onPointerEnter,
    onPointerLeave,
  } = useTileOverlay();

  React.useEffect(() => {
    if (!isLocal) return;
    const onKey = (event: KeyboardEvent) => {
      if (!hovering && !overlayVisible) return;
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        void toggleLocalMicrophone();
      }
      if (event.key === 'v' || event.key === 'V') {
        event.preventDefault();
        void toggleLocalCamera();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLocal, hovering, overlayVisible, toggleLocalCamera, toggleLocalMicrophone]);

  const toggleRemoteAudio = React.useCallback(() => {
    setPlaybackMuted((prev) => !prev);
  }, []);
  const handleScreenShareClick = React.useCallback(async () => {
    const sharing = await events.toggleScreenShare();
    if (sharing) {
      try {
        const messageId = `screenshare-${participant.identity}-${Date.now()}`;
        const { LivekitScreenShareTile } = await import('./livekit-screenshare-tile');
        const TileComponent = LivekitScreenShareTile as unknown as React.ComponentType<Record<string, unknown>>;
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
      } catch {}
    }
  }, [events, height, participant.identity, width]);

  const {
    audioDevices,
    videoDevices,
    microphoneSelectValue,
    cameraSelectValue,
    refreshDevices,
    handleMicrophoneSelect,
    handleCameraSelect,
  } = useLivekitLocalDevices({ room, isLocal });

  const [selectedQuality, setSelectedQuality] = React.useState<'auto' | 'low' | 'high'>('auto');
  const {
    isOpen: optionsOpen,
    openPanel,
    closePanel,
    panelRef: optionsPanelRef,
    setButtonNode,
    anchor: optionsAnchor,
    panelStyle: optionsPanelStyle,
  } = useAnchoredPanel({
    isCoarsePointer,
    onOpen: () => {
      void refreshDevices();
    },
  });

  const handleOptionsButtonRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      setButtonNode(node);
    },
    [setButtonNode],
  );

  const allParticipants = React.useMemo(() => {
    const entries: { id: string; name: string }[] = [];
    if (room?.localParticipant) {
      entries.push({
        id: room.localParticipant.identity,
        name: resolveParticipantDisplayName({
          name: room.localParticipant.name,
          identity: room.localParticipant.identity,
          metadata: room.localParticipant.metadata,
        }),
      });
    }
    room?.remoteParticipants?.forEach((p) => {
      entries.push({
        id: p.identity,
        name: resolveParticipantDisplayName({
          name: p.name,
          identity: p.identity,
          metadata: p.metadata,
        }),
      });
    });
    return entries;
  }, [room?.localParticipant, room?.remoteParticipants]);

  const optionsPanel = (
    <ParticipantTileOptionsPanel
      isOpen={optionsOpen}
      anchor={optionsAnchor}
      panelRef={optionsPanelRef}
      panelStyle={optionsPanelStyle}
      isCoarsePointer={isCoarsePointer}
      onClose={closePanel}
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
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <ParticipantVideoLayer
          showVideo={showVideo}
          isMinimized={!!state?.isMinimized}
          videoTrackRef={videoTrackRef}
          videoPublication={videoPublication}
          isLocal={isLocal}
          mirrorLocal={mirrorLocal}
          fit={fit}
          isAgent={isAgent}
        />

        {showAudio && audioTrackRef && !audioPublication?.isMuted && !playbackMuted && (
          <AudioTrack trackRef={audioTrackRef} />
        )}

        <ParticipantNameOverlay
          visible={showParticipantName}
          isAgent={isAgent}
          isLocal={isLocal}
          displayName={displayName}
        />

        <ParticipantSpeakingIndicator visible={agentState.isSpeaking} />

        <ParticipantToolbar
          visible={showToolbar}
          overlayVisible={overlayVisible}
          isCoarsePointer={isCoarsePointer}
          isMinimized={!!state?.isMinimized}
          isLocal={isLocal}
          effectiveAudioMuted={effectiveAudioMuted}
          videoMuted={agentState.videoMuted}
          screenSharing={agentState.screenSharing}
          onToggleLocalMic={toggleLocalMicrophone}
          onToggleLocalCamera={toggleLocalCamera}
          onToggleRemoteAudio={toggleRemoteAudio}
          onToggleScreenShare={handleScreenShareClick}
          openOptions={openPanel}
          optionsButtonRef={handleOptionsButtonRef}
        />

        <ParticipantMinimizedView
          visible={!!state?.isMinimized}
          isAgent={isAgent}
          displayName={displayName}
          isSpeaking={agentState.isSpeaking}
        />
      </div>
      {optionsPanel}
    </>
  );
}
