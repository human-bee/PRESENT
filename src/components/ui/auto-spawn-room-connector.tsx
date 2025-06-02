"use client";

/*
 * DEBUGGING ENHANCEMENT: Added comprehensive console logging to track auto-spawn behavior
 * Look for these log prefixes:
 * 
 * 🚀 [AutoSpawn] Component lifecycle and spawn attempts
 * ❌ [AutoSpawn] Errors during auto-spawn process
 * 🧹 [AutoSpawn] Cleanup operations
 */

import { useEffect, useRef, useState } from "react";
import { useTamboThread } from "@tambo-ai/react";

/**
 * AutoSpawnRoomConnector Component
 *
 * Automatically spawns a LiveKit room connector when the canvas loads
 */
export function AutoSpawnRoomConnector() {
  const tamboContext = useTamboThread();
  const hasSpawned = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  console.log(`🚀 [AutoSpawn] Component mounted/updated`, {
    hasSpawned: hasSpawned.current,
    retryCount,
    hasTamboContext: !!tamboContext,
    hasSendMessage: !!tamboContext?.sendMessage,
    threadId: tamboContext?.thread?.id,
    timestamp: new Date().toISOString()
  });

  useEffect(() => {
    console.log(`🚀 [AutoSpawn] Effect triggered`, {
      hasSpawned: hasSpawned.current,
      retryCount,
      hasTamboContext: !!tamboContext,
      hasSendMessage: !!tamboContext?.sendMessage,
      timestamp: new Date().toISOString()
    });

    // Prevent multiple spawns
    if (hasSpawned.current) {
      console.log(`🚀 [AutoSpawn] Already spawned, skipping`);
      return;
    }
    
    // If context is not ready, try again after a delay
    if (!tamboContext || !tamboContext.sendMessage) {
      if (retryCount < 5) { // Reduced retry limit
        console.log(`🚀 [AutoSpawn] Context not ready, scheduling retry ${retryCount + 1}/5`);
        const retryTimer = setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 2000); // Longer delay between retries
        return () => {
          console.log(`🧹 [AutoSpawn] Cleaning up retry timer`);
          clearTimeout(retryTimer);
        };
      } else {
        console.warn(`🚀 [AutoSpawn] Context not available after 5 retries, giving up`);
      }
      return;
    }

    const { sendMessage, thread } = tamboContext;
    
    console.log(`🚀 [AutoSpawn] Tambo context ready, analyzing thread`, {
      threadId: thread?.id,
      messageCount: thread?.messages?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    // Wait for canvas to be ready
    const timer = setTimeout(() => {
      try {
        console.log(`🚀 [AutoSpawn] Timer fired, checking for existing room connector`);
        
        // Check if we already have a room connector in the thread messages
        const hasRoomConnector = thread?.messages?.some(msg => 
          msg.role === 'assistant' && msg.content && (
            msg.content.includes('LivekitRoomConnector') ||
            msg.content.includes('room connector') ||
            msg.content.includes('LiveKit room')
          )
        );
        
        console.log(`🚀 [AutoSpawn] Room connector check result`, {
          hasRoomConnector,
          messageCount: thread?.messages?.length || 0,
          hasSpawnedCurrent: hasSpawned.current
        });
        
        if (!hasRoomConnector && !hasSpawned.current) {
          hasSpawned.current = true;
          console.log(`🚀 [AutoSpawn] Sending auto-spawn message`);
          
          // Send message to create room connector
          sendMessage(
            'Create a LiveKit room connector with room name "tambo-canvas-room" and show it on the canvas. Set userName to "Canvas User".'
          );
        } else if (hasRoomConnector) {
          console.log(`🚀 [AutoSpawn] Room connector already exists, skipping auto-spawn`);
          hasSpawned.current = true;
        }
      } catch (error) {
        console.error(`❌ [AutoSpawn] Error during auto-spawn:`, error);
        hasSpawned.current = false; // Reset so it can try again
      }
    }, 3000); // Longer initial delay

    return () => {
      console.log(`🧹 [AutoSpawn] Cleaning up main timer`);
      clearTimeout(timer);
    };
  }, [tamboContext, retryCount]);

  // This component doesn't render anything
  return null;
}

export default AutoSpawnRoomConnector; 