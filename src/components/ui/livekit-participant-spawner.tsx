"use client";

import * as React from "react";
import { useParticipants, useLocalParticipant } from "@livekit/components-react";
import { useTamboThread } from "@tambo-ai/react";

/**
 * LivekitParticipantSpawner Component
 *
 * Automatically spawns LivekitParticipantTile components on the canvas 
 * when participants join or leave the LiveKit room.
 */
export function LivekitParticipantSpawner() {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { sendMessage } = useTamboThread();
  
  // Track which participants we've already spawned
  const spawnedParticipants = React.useRef<Set<string>>(new Set());
  
  // Handle participant changes
  React.useEffect(() => {
    const currentParticipants = new Set(participants.map(p => p.identity));
    
    // Add local participant to the set
    if (localParticipant) {
      currentParticipants.add(localParticipant.identity);
    }
    
    // Spawn tiles for new participants
    for (const identity of currentParticipants) {
      if (!spawnedParticipants.current.has(identity)) {
        spawnedParticipants.current.add(identity);
        
        // Determine if this is the local participant
        const isLocal = localParticipant?.identity === identity;
        
        // Check if this might be an agent (simple heuristic)
        const isAgent = identity.toLowerCase().includes('agent') || 
                        identity.toLowerCase().includes('bot') ||
                        identity.toLowerCase().includes('ai');
        
        // Send message to spawn participant tile
        const participantType = isLocal ? "your" : isAgent ? "AI agent" : "participant";
        const message = `A ${participantType} "${identity}" has joined. Show their video tile with LivekitParticipantTile component with participantIdentity="${identity}"${isLocal ? ', isLocal=true' : ''}${isAgent ? ', isAgent=true' : ''}.`;
        
        sendMessage(message, { autoSubmit: true });
        
        console.log(`Spawning tile for ${participantType}: ${identity}`);
      }
    }
    
    // Remove tiles for participants who left
    const leftParticipants = Array.from(spawnedParticipants.current).filter(
      identity => !currentParticipants.has(identity)
    );
    
    for (const identity of leftParticipants) {
      spawnedParticipants.current.delete(identity);
      console.log(`Participant left: ${identity}`);
      // Note: You might want to implement automatic cleanup of canvas components here
    }
    
  }, [participants, localParticipant, sendMessage]);
  
  // This component doesn't render anything visible
  return null;
}

export default LivekitParticipantSpawner; 