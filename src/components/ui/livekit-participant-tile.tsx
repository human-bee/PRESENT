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

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";
import {
  User,
  Bot,
  AlertCircle,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  Crown,
} from "lucide-react";
import { useCanvasLiveKit } from "./livekit-room-connector";
import { 
  useParticipants,
  useLocalParticipant,
  useTracks,
  VideoTrack,
  AudioTrack,
  useRoomContext
} from "@livekit/components-react";
import { Track } from "livekit-client";

// Define the component props schema with Zod
export const livekitParticipantTileSchema = z.object({
  // Participant Info
  participantIdentity: z.string().optional().describe("The unique identity/ID of the participant to display (optional - shows all if not specified)"),
  showToolbar: z.boolean().optional().describe("Whether to show the control toolbar (default: true)"),
  showVideo: z.boolean().optional().describe("Whether to show video track (default: true)"),
  showAudio: z.boolean().optional().describe("Whether to show audio controls (default: true)"),
  
  // Tile Configuration
  width: z.number().optional().describe("Width of the tile in pixels (default: 320)"),
  height: z.number().optional().describe("Height of the tile in pixels (default: 240)"),
  isLocal: z.boolean().optional().describe("Whether this is the local participant (affects available controls)"),
  
  // Visual Style
  borderRadius: z.number().optional().describe("Border radius in pixels (default: 12)"),
  showParticipantName: z.boolean().optional().describe("Whether to show participant name overlay (default: true)"),
  
  // Agent Detection
  isAgent: z.boolean().optional().describe("Whether this participant is an AI agent (shows bot icon)"),
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
export function LivekitParticipantTile({
  participantIdentity,
  showToolbar = true,
  showVideo = true,
  showAudio = true,
  width = 320,
  height = 240,

  borderRadius = 12,
  showParticipantName = true,
  isAgent = false,
}: LivekitParticipantTileProps) {
  // Initialize Tambo component state
  const [state, setState] = useTamboComponentState<LivekitParticipantTileState>(
    `livekit-participant-${participantIdentity || 'all'}`,
    {
      isMinimized: false,
      audioLevel: 0,
      lastSpokeAt: null,
    }
  );

  // Check Canvas LiveKit context (room connector status)
  const canvasLiveKit = useCanvasLiveKit();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  
  // Only log errors, not regular state changes
  React.useEffect(() => {
    if (!canvasLiveKit) {
      console.warn(`[ParticipantTile-${participantIdentity || 'all'}] No canvas context found - participant tiles may not work`);
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
            {!canvasLiveKit ? "Room Connector Required" : "Room Not Connected"}
          </p>
          <p className="text-xs text-blue-700 mb-2">
            {!canvasLiveKit 
              ? "Create a LivekitRoomConnector component first" 
              : `Room "${canvasLiveKit.roomName}" is not connected yet`
            }
          </p>
          <p className="text-xs text-blue-600">
            Participant tiles work only when the room is connected.
          </p>
        </div>
      </div>
    );
  }

  // If specific participant requested, find them
  const participant = participantIdentity 
    ? participants.find(p => p.identity === participantIdentity) || 
      (localParticipant?.identity === participantIdentity ? localParticipant : null)
    : null;

  // If specific participant requested but not found
  if (participantIdentity && !participant) {
    return (
      <div 
        className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex flex-col items-center justify-center gap-2"
        style={{ width, height: Math.max(height / 2, 140), borderRadius }}
      >
        <User className="w-8 h-8 text-yellow-600" />
        <div className="text-center">
          <p className="font-medium text-yellow-800 mb-1">Participant Not Found</p>
          <p className="text-xs text-yellow-700 mb-2">
            Looking for: &quot;{participantIdentity}&quot;
          </p>
          <p className="text-xs text-yellow-600 mb-2">
            Available participants:
          </p>
          <div className="text-xs text-yellow-600">
            {participants.length === 0 && localParticipant && (
              <div>• {localParticipant.identity} (you)</div>
            )}
            {participants.map(p => (
              <div key={p.sid}>• {p.identity}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Show single participant tile
  if (participant) {
    return <SingleParticipantTile 
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
      state={state}
      setState={setState}
    />;
  }

  // Show all participants grid
  const allParticipantsRaw = localParticipant 
    ? [localParticipant, ...participants]
    : participants;

  // Deduplicate participants by SID to prevent key errors
  const uniqueParticipants = Array.from(new Map(allParticipantsRaw.map(p => [p.sid, p])).values());

  return (
    <div className="grid grid-cols-2 gap-2" style={{ width: width * 2 + 8 }}>
      {uniqueParticipants.map(p => (
        <SingleParticipantTile
          key={p.sid}
          participant={p}
          isLocal={p === localParticipant}
          width={width}
          height={height}
          borderRadius={borderRadius}
          showToolbar={showToolbar}
          showVideo={showVideo}
          showAudio={showAudio}
          showParticipantName={showParticipantName}
          isAgent={!!(p.metadata?.includes('agent') || p.name?.toLowerCase().includes('agent'))}
          state={state}
          setState={setState}
        />
      ))}
    </div>
  );
}

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
  state,
  setState,
}: {
  participant: ReturnType<typeof useParticipants>[0] | ReturnType<typeof useLocalParticipant>['localParticipant'];
  isLocal: boolean;
  width: number;
  height: number;
  borderRadius: number;
  showToolbar: boolean;
  showVideo: boolean;
  showAudio: boolean;
  showParticipantName: boolean;
  isAgent: boolean;
  state: LivekitParticipantTileState | undefined;
  setState: (state: LivekitParticipantTileState) => void;
}) {
  // Get video and audio tracks
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true, participant },
      { source: Track.Source.Microphone, withPlaceholder: true, participant },
    ]
  );
  
  const videoTrack = tracks.find(track => track.source === Track.Source.Camera);
  const audioTrack = tracks.find(track => track.source === Track.Source.Microphone);
  
  // Debug logging for video track status
  React.useEffect(() => {
    console.log(`[ParticipantTile] ${participant?.identity || 'unknown'} - Video track:`, {
      hasVideoTrack: !!videoTrack,
      isVideoEnabled: videoTrack?.publication?.isEnabled,
      isVideoMuted: videoTrack?.publication?.isMuted,
      trackState: videoTrack?.publication?.track?.readyState,
      participantType: isLocal ? 'local' : 'remote'
    });
  }, [videoTrack, isLocal, participant?.identity]);

  // Handle minimize toggle
  const handleMinimizeToggle = () => {
    if (!state) return;
    setState({ ...state, isMinimized: !state.isMinimized });
  };

  return (
    <div
      className={cn(
        "relative bg-black border-2 border-gray-300 overflow-hidden transition-all duration-200",
        participant.isSpeaking && "border-green-400 shadow-lg shadow-green-400/25",
        state?.isMinimized && "!h-16"
      )}
      style={{ 
        width, 
        height: state?.isMinimized ? 64 : height, 
        borderRadius 
      }}
    >
      {/* Video Container */}
      {showVideo && !state?.isMinimized && videoTrack && !videoTrack.publication?.isMuted && (
        <VideoTrack 
          trackRef={videoTrack} 
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Video muted/disabled placeholder */}
      {showVideo && !state?.isMinimized && videoTrack && videoTrack.publication?.isMuted && (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
          <div className="text-center text-white">
            <VideoOff className="w-12 h-12 mx-auto mb-2 opacity-75" />
            <p className="text-sm opacity-75">Video disabled</p>
          </div>
        </div>
      )}

      {/* No video track placeholder */}
      {showVideo && !state?.isMinimized && !videoTrack && (
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <div className="text-center text-white">
            {isAgent ? (
              <Bot className="w-12 h-12 mx-auto mb-2 opacity-75" />
            ) : (
              <User className="w-12 h-12 mx-auto mb-2 opacity-75" />
            )}
            <p className="text-sm opacity-75">
              {isLocal ? "Click camera to enable" : "No video"}
            </p>
          </div>
        </div>
      )}

      {/* Audio Track */}
      {showAudio && audioTrack && (
        <AudioTrack trackRef={audioTrack} />
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
      {participant.isSpeaking && (
        <div className="absolute bottom-2 left-2">
          <div className="bg-green-500/80 backdrop-blur-sm rounded-full p-1.5">
            <Volume2 className="w-3 h-3 text-white animate-pulse" />
          </div>
        </div>
      )}

      {/* Control Toolbar */}
      {showToolbar && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          {/* Minimize/Expand Toggle */}
          <button
            onClick={handleMinimizeToggle}
            className="bg-black/60 backdrop-blur-sm rounded-md p-1.5 text-white hover:bg-black/80 transition-colors"
          >
            {state?.isMinimized ? (
              <Video className="w-3 h-3" />
            ) : (
              <User className="w-3 h-3" />
            )}
          </button>

          {/* Mute indicators */}
          {isLocal && (
            <>
              {audioTrack?.publication?.isMuted && (
                <div className="bg-red-500/80 backdrop-blur-sm rounded-md p-1.5">
                  <MicOff className="w-3 h-3 text-white" />
                </div>
              )}
              {videoTrack?.publication?.isMuted && (
                <div className="bg-red-500/80 backdrop-blur-sm rounded-md p-1.5">
                  <VideoOff className="w-3 h-3 text-white" />
                </div>
              )}
            </>
          )}
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
            {participant.isSpeaking && (
              <Volume2 className="w-3 h-3 text-green-400 animate-pulse flex-shrink-0" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Default export for convenience
export default LivekitParticipantTile; 