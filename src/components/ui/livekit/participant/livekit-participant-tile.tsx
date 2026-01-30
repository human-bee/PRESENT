/**
 * LivekitParticipantTile Component
 *
 * Shows video/audio for LiveKit participants in the room.
 * Can show a specific participant or all participants.
 */

'use client';

import * as React from 'react';
import { z } from 'zod';
import { AlertCircle, User, Loader2 } from 'lucide-react';
import { useCanvasLiveKit } from '../livekit-room-connector';
import { useParticipants, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { LivekitParticipantTileState, SingleParticipantTile } from './livekit-single-participant-tile';

export const livekitParticipantTileSchema = z.object({
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
  width: z.number().optional().describe('Width of the tile in pixels (default: 320)'),
  height: z.number().optional().describe('Height of the tile in pixels (default: 240)'),
  isLocal: z
    .boolean()
    .optional()
    .describe('Whether this is the local participant (affects available controls)'),
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
  demoMode: z
    .boolean()
    .optional()
    .describe('Show a simulated video feed when LiveKit is not connected (default: false)'),
  trackPreference: z
    .enum(['auto', 'camera', 'screen'])
    .optional()
    .describe('Prefer which video source when both are present (default: auto)'),
  isAgent: z.boolean().optional().describe('Whether this participant is an AI agent (shows bot icon)'),
  // Relaxed schema to avoid Zod version compatibility issues with function().args()
  onIdentityChange: z
    .any() 
    .optional()
    .describe('Callback when the participant identity changes'),
});

export type LivekitParticipantTileProps = z.infer<typeof livekitParticipantTileSchema>;

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
  demoMode = false,
  onIdentityChange,
}: LivekitParticipantTileProps) {
  const [state] = React.useState<LivekitParticipantTileState>({
    isMinimized: false,
    audioLevel: 0,
    lastSpokeAt: null,
  });

  const canvasLiveKit = useCanvasLiveKit();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  React.useEffect(() => {
    if (!canvasLiveKit) {
      console.warn(
        `[ParticipantTile-${participantIdentity || 'all'}] No canvas context found - participant tiles may not work`,
      );
    }
  }, [participantIdentity, canvasLiveKit]);

  if ((!canvasLiveKit || !canvasLiveKit.isConnected || !room) && demoMode) {
    return (
      <div
        className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-white"
        style={{ width, height, borderRadius }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.35),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(129,140,248,0.35),transparent_50%),radial-gradient(circle_at_50%_80%,rgba(16,185,129,0.2),transparent_55%)]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
          <div className="h-12 w-12 rounded-full border border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_18px_rgba(34,211,238,0.55)]" />
          <div className="text-sm font-semibold tracking-wide">Demo Video Feed</div>
          <div className="text-xs text-slate-300">
            {participantIdentity ? `Speaker: ${participantIdentity}` : 'Awaiting LiveKit room'}
          </div>
        </div>
        <div className="absolute bottom-3 left-3 rounded-full bg-cyan-400/20 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-200">
          Simulated
        </div>
      </div>
    );
  }

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

  // Robust Participant Selection Logic
  // 1. Explicit identity via prop
  // 2. "Waiting" state if explicit identity is missing
  // 3. Auto-select first REMOTE participant if no identity is set
  // 4. Fallback to LOCAL participant if no remote and no identity

  let targetIdentity = participantIdentity;
  let autoSelected = false;

  // Auto-selection logic: If no identity is assigned, pick the first remote participant
  if (!targetIdentity) {
    const firstRemote = participants.find(p => !p.isLocal);
    if (firstRemote) {
      targetIdentity = firstRemote.identity;
      autoSelected = true;
    } else if (localParticipant) {
      targetIdentity = localParticipant.identity;
      autoSelected = true;
    }
  }

  const participant = targetIdentity
    ? (localParticipant?.identity === targetIdentity ? localParticipant : null) ||
      participants.find((p) => p.identity === targetIdentity) ||
      null
    : null;

  // If we auto-selected someone, we should technically "commit" this selection to the canvas state
  // so everyone sees the same person. But strictly controlled components shouldn't side-effect update props.
  // For now, we'll just render them visually. Ideally, the user clicks "Pin" to save this state.

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
        onSelectParticipant={onIdentityChange}
        state={state}
      />
    );
  }

  // WAITING STATE: Identity is set, but participant not found in room
  if (participantIdentity && !participant) {
    return (
        <div
          className="bg-gray-50 border-2 border-gray-300 border-dashed rounded-lg p-4 flex flex-col items-center justify-center gap-2"
          style={{ width, height: Math.max(height / 2, 140), borderRadius }}
        >
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          <div className="text-center">
            <p className="font-medium text-gray-600 mb-1">Waiting for...</p>
            <p className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded">
              {participantIdentity}
            </p>
            <p className="text-[10px] text-gray-400 mt-2">Participant is not in the room yet</p>
          </div>
        </div>
    );
  }

  // EMPTY STATE: No identity set, and no participants found to auto-select
  return (
    <div
      className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex flex-col items-center justify-center gap-2"
      style={{ width, height: Math.max(height / 2, 140), borderRadius }}
    >
      <User className="w-8 h-8 text-yellow-600" />
      <div className="text-center">
        <p className="font-medium text-yellow-800 mb-1">No Participants</p>
        <p className="text-xs text-yellow-700 mb-2">
          Waiting for someone to join...
        </p>
        {localParticipant && (
           <button 
             className="text-xs text-blue-600 underline mt-1"
             onClick={() => onIdentityChange?.(localParticipant.identity)}
           >
             Show Me ({localParticipant.identity})
           </button>
        )}
      </div>
    </div>
  );
});

export default LivekitParticipantTile;
