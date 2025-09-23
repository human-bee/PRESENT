/**
 * LivekitParticipantTile Component
 *
 * Shows video/audio for LiveKit participants in the room.
 * Can show a specific participant or all participants.
 */

'use client';

import * as React from 'react';
import { z } from 'zod';
import { AlertCircle, User } from 'lucide-react';
import { useCanvasLiveKit } from './livekit-room-connector';
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
  trackPreference: z
    .enum(['auto', 'camera', 'screen'])
    .optional()
    .describe('Prefer which video source when both are present (default: auto)'),
  isAgent: z.boolean().optional().describe('Whether this participant is an AI agent (shows bot icon)'),
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
}: LivekitParticipantTileProps) {
  const [state] = React.useState<LivekitParticipantTileState>({
    isMinimized: false,
    audioLevel: 0,
    lastSpokeAt: null,
  });
  const [selectedParticipantId, setSelectedParticipantId] = React.useState<string | null>(null);

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

  const activeParticipantId =
    selectedParticipantId || participantIdentity || localParticipant?.identity || null;
  const participant = activeParticipantId
    ? (localParticipant?.identity === activeParticipantId ? localParticipant : null) ||
      participants.find((p) => p.identity === activeParticipantId) ||
      null
    : null;

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

export default LivekitParticipantTile;
