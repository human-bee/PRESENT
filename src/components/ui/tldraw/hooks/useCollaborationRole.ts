import { useEffect, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';

/**
 * Detects the user's role from LiveKit token metadata
 * @param room - LiveKit room instance
 * @returns role string ('viewer', 'readOnly', or null)
 */
export function useCollaborationRole(room: Room | undefined): string | null {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;

    const updateRole = () => {
      const meta = room.localParticipant?.metadata;
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          if (parsed && typeof parsed.role === 'string') {
            setRole(parsed.role);
          }
        } catch {
          // ignore parse errors
        }
      }
    };

    updateRole();
    room.on(RoomEvent.LocalTrackPublished, updateRole);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, updateRole);
    };
  }, [room]);

  return role;
}
