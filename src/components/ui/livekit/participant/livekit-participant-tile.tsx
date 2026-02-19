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
  slotId: z
    .string()
    .optional()
    .describe('Stable slot identifier for this tile (defaults to component id/message id)'),
  assignmentStatus: z
    .enum(['unassigned', 'assigned'])
    .optional()
    .describe('Shared assignment status for this participant slot'),
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
  fit: z.enum(['cover', 'contain']).optional().describe('Video object-fit policy (default: contain)'),
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
  slotId,
  assignmentStatus,
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
  fit = 'contain',
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
  const resolvedSlotId = slotId?.trim() || 'slot';
  const resolvedAssignmentStatus =
    assignmentStatus ??
    (participantIdentity && participantIdentity.trim().length > 0 ? 'assigned' : 'unassigned');

  const isAgentParticipant = React.useCallback((p: any) => {
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
  }, []);

  const participantOptions = React.useMemo(() => {
    const list: Array<{ identity: string; label: string }> = [];
    if (localParticipant && !isAgentParticipant(localParticipant)) {
      list.push({
        identity: localParticipant.identity,
        label: `${localParticipant.identity} (You)`,
      });
    }
    participants
      .filter((p) => !isAgentParticipant(p))
      .sort((a, b) => String(a.identity).localeCompare(String(b.identity)))
      .forEach((p) => {
        if (!list.find((entry) => entry.identity === p.identity)) {
          list.push({ identity: p.identity, label: p.identity });
        }
      });
    return list;
  }, [isAgentParticipant, localParticipant, participants]);
  const [selectedIdentity, setSelectedIdentity] = React.useState<string>('');

  React.useEffect(() => {
    if (!participantOptions.length) {
      setSelectedIdentity('');
      return;
    }
    if (!selectedIdentity || !participantOptions.some((entry) => entry.identity === selectedIdentity)) {
      setSelectedIdentity(participantOptions[0].identity);
    }
  }, [participantOptions, selectedIdentity]);

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

  const targetIdentity = participantIdentity?.trim() || undefined;

  const participant = targetIdentity
    ? (localParticipant?.identity === targetIdentity ? localParticipant : null) ||
      participants.find((p) => p.identity === targetIdentity) ||
      null
    : null;

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

  // WAITING STATE: Identity is assigned in shared state, but participant not in room.
  if (targetIdentity && !participant) {
    return (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-default border-dashed bg-surface-secondary p-4"
          style={{ width, height: Math.max(height / 2, 140), borderRadius }}
        >
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
          <div className="text-center">
            <p className="mb-1 rounded border border-default bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-tertiary">
              {resolvedSlotId} • {resolvedAssignmentStatus}
            </p>
            <p className="mb-1 font-medium text-secondary">Waiting for...</p>
            <p className="rounded border border-default bg-surface px-2 py-1 font-mono text-xs text-secondary">
              {targetIdentity}
            </p>
            <p className="mt-2 text-[10px] text-tertiary">Participant is not in the room yet</p>
          </div>
        </div>
    );
  }

  // UNASSIGNED STATE: Slot exists, but no participant has been assigned in shared state.
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-warning-surface bg-warning-surface p-4 text-warning"
      style={{ width, height: Math.max(height / 2, 140), borderRadius }}
    >
      <User className="w-8 h-8" />
      <div className="text-center">
        <p className="mb-1 rounded border border-default bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-tertiary">
          {resolvedSlotId} • {resolvedAssignmentStatus}
        </p>
        <p className="mb-1 font-medium">Unassigned Slot</p>
        <p className="mb-2 text-xs text-secondary">
          Assign a participant to sync this tile across everyone in the room.
        </p>
        <div className="mt-2 flex flex-col items-center gap-2">
          <select
            className="w-full rounded border border-default bg-surface px-2 py-1 text-xs text-primary"
            value={selectedIdentity}
            onChange={(event) => setSelectedIdentity(event.target.value)}
          >
            {participantOptions.length === 0 ? (
              <option value="">No participants available</option>
            ) : (
              participantOptions.map((option) => (
                <option key={option.identity} value={option.identity}>
                  {option.label}
                </option>
              ))
            )}
          </select>
          <button
            className="mt-1 text-xs font-medium text-[var(--present-accent)] underline underline-offset-4 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)] rounded"
            onClick={() => {
              if (!selectedIdentity) return;
              onIdentityChange?.(selectedIdentity);
            }}
            disabled={!selectedIdentity}
            type="button"
          >
            Assign Participant
          </button>
        </div>
      </div>
    </div>
  );
});

export default LivekitParticipantTile;
