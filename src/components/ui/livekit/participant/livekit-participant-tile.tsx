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
        className="relative overflow-hidden border border-default bg-surface-elevated text-primary"
        style={{ width, height, borderRadius }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
          <div className="h-12 w-12 rounded-full border border-default bg-[var(--present-accent-ring)]" />
          <div className="text-sm font-semibold tracking-wide">Demo Video Feed</div>
          <div className="text-xs text-secondary">
            {participantIdentity ? `Speaker: ${participantIdentity}` : 'Awaiting LiveKit room'}
          </div>
        </div>
        <div className="absolute bottom-3 left-3 rounded-full border border-default bg-surface-secondary px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-tertiary">
          Simulated
        </div>
      </div>
    );
  }

  if (!canvasLiveKit || !canvasLiveKit.isConnected || !room) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-info-surface bg-info-surface p-4 text-info"
        style={{ width, height: Math.max(height / 2, 140), borderRadius }}
      >
        <AlertCircle className="w-8 h-8" />
        <div className="text-center">
          <p className="mb-1 font-medium">
            {!canvasLiveKit ? 'Room Connector Required' : 'Room Not Connected'}
          </p>
          <p className="mb-2 text-xs text-secondary">
            {!canvasLiveKit
              ? 'Create a LivekitRoomConnector component first'
              : `Room "${canvasLiveKit.roomName}" is not connected yet`}
          </p>
          <p className="text-xs text-secondary">
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
    const isAgentParticipant = (p: any) => {
      try {
        const kind = String(p?.kind ?? '').toLowerCase();
        if (kind === 'agent') return true;
        const identity = String(p?.identity || '').toLowerCase();
        const metadata = String(p?.metadata || '').toLowerCase();
        return (
          identity.startsWith('agent-') ||
          identity.includes('voice-agent') ||
          identity === 'voiceagent' ||
          metadata.includes('voice-agent') ||
          metadata.includes('voiceagent')
        );
      } catch {
        return false;
      }
    };

    // Prefer local self-view by default.
    if (localParticipant && !isAgentParticipant(localParticipant)) {
      targetIdentity = localParticipant.identity;
      autoSelected = true;
    } else {
      // Otherwise, prefer a non-agent remote participant.
      const firstHumanRemote = participants.find((p: any) => !p.isLocal && !isAgentParticipant(p));
      const firstRemote = firstHumanRemote ?? participants.find((p) => !p.isLocal);
      if (firstHumanRemote) {
        targetIdentity = firstHumanRemote.identity;
        autoSelected = true;
      } else if (firstRemote && !isAgentParticipant(firstRemote)) {
        targetIdentity = firstRemote.identity;
        autoSelected = true;
      } else {
        // Avoid briefly snapping to an agent tile before the local participant is ready.
        return (
          <div
            className="relative overflow-hidden rounded-lg border border-default bg-surface-elevated text-primary"
            style={{ width, height, borderRadius }}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
              <Loader2 className="h-7 w-7 animate-spin text-tertiary" />
              <div className="text-xs text-secondary">Waiting for participants…</div>
            </div>
          </div>
        );
      }
    }
    if (!targetIdentity && localParticipant) {
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
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-default border-dashed bg-surface-secondary p-4"
          style={{ width, height: Math.max(height / 2, 140), borderRadius }}
        >
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
          <div className="text-center">
            <p className="mb-1 font-medium text-secondary">Waiting for...</p>
            <p className="rounded border border-default bg-surface px-2 py-1 font-mono text-xs text-secondary">
              {participantIdentity}
            </p>
            <p className="mt-2 text-[10px] text-tertiary">Participant is not in the room yet</p>
          </div>
        </div>
    );
  }

  // EMPTY STATE: No identity set, and no participants found to auto-select
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-warning-surface bg-warning-surface p-4 text-warning"
      style={{ width, height: Math.max(height / 2, 140), borderRadius }}
    >
      <User className="w-8 h-8" />
      <div className="text-center">
        <p className="mb-1 font-medium">No Participants</p>
        <p className="mb-2 text-xs text-secondary">
          Waiting for someone to join...
        </p>
        {localParticipant && (
           <button 
             className="mt-1 text-xs font-medium text-[var(--present-accent)] underline underline-offset-4 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)] rounded"
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
