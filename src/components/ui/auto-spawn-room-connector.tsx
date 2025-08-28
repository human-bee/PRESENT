"use client";

/**
 * AutoSpawnRoomConnector Component
 * 
 * Automatically spawns a LiveKit room connector when the canvas loads
 * 
 * DEVELOPER NOTES:
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
	// Respect env flag to disable auto-spawn by default
	if (process.env.NEXT_PUBLIC_AUTO_SPAWN_LIVEKIT !== "true") {
		return null;
	}
	const tamboContext = useTamboThread();
	const hasSpawned = useRef(false);
	const [retryCount, setRetryCount] = useState(0);

	useEffect(() => {
		// Prevent multiple spawns
		if (hasSpawned.current) {
			return;
		}

		// If context is not ready, try again after a delay
		if (!tamboContext || !tamboContext.sendMessage) {
			if (retryCount < 5) {
				// Reduced retry limit
				const retryTimer = setTimeout(() => {
					setRetryCount((prev) => prev + 1);
				}, 2000); // Longer delay between retries
				return () => {
					clearTimeout(retryTimer);
				};
			} else {
				console.warn(
					`🚀 [AutoSpawn] Context not available after 5 retries, giving up`,
				);
			}
			return;
		}

		const { sendMessage, thread } = tamboContext;

		// Wait for canvas to be ready
		const timer = setTimeout(() => {
			try {
				// Check if we already have a room connector in the thread messages
				const hasRoomConnector = thread?.messages?.some(
					(msg) =>
						msg.role === "assistant" &&
						msg.content &&
						(msg.content.includes("LivekitRoomConnector") ||
							msg.content.includes("room connector") ||
							msg.content.includes("LiveKit room")),
				);

				if (!hasRoomConnector && !hasSpawned.current) {
					hasSpawned.current = true;

					// Send message to create room connector
					sendMessage(
						'Create a LiveKit room connector with room name "canvas-room" and show it on the canvas. Set userName to "Canvas User".',
					);
				} else if (hasRoomConnector) {
					hasSpawned.current = true;
				}
			} catch (error) {
				hasSpawned.current = false; // Reset so it can try again
			}
		}, 3000); // Longer initial delay

		return () => {
			clearTimeout(timer);
		};
	}, [tamboContext, retryCount]);

	// This component doesn't render anything
	return null;
}

export default AutoSpawnRoomConnector;
