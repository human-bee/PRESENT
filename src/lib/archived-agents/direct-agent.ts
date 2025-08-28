#!/usr/bin/env node
/**
 * Direct Tambo Voice Agent - Bypasses LiveKit Cloud automatic dispatch
 *
 * This agent actively monitors for room activity and joins rooms directly
 * instead of waiting for LiveKit Cloud to dispatch it.
 */

import { config } from "dotenv";
import { join } from "path";

// Load environment variables from .env.local
config({ path: join(process.cwd(), ".env.local") });

import { Room, RoomEvent, ConnectionState } from "livekit-client";
import { AccessToken } from "livekit-server-sdk";
import { executeTool, ToolName, AVAILABLE_TOOLS } from "./livekit-agent-tools";

console.log("🚀 Starting Direct Tambo Voice Agent...");
console.log("🔧 Environment Check:");
console.log(
	`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? "✅ Present" : "❌ Missing"}`,
);
console.log(
	`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? "✅ Present" : "❌ Missing"}`,
);
console.log(
	`  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || "❌ Missing"}`,
);

const serverUrl =
	process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

if (!serverUrl || !apiKey || !apiSecret) {
	console.error("❌ Missing required environment variables!");
	process.exit(1);
}

let currentRoom: Room | null = null;
let agentIdentity: string = "";

async function createAgentToken(roomName: string): Promise<string> {
	agentIdentity = `voice-agent-${Date.now()}`;

	const token = new AccessToken(apiKey!, apiSecret!, {
		identity: agentIdentity,
		name: "Tambo Voice Agent",
		metadata: JSON.stringify({
			type: "agent",
			tools: AVAILABLE_TOOLS,
			timestamp: Date.now(),
		}),
	});

	token.addGrant({
		room: roomName,
		roomJoin: true,
		canPublish: true,
		canSubscribe: true,
		canPublishData: true,
		canUpdateOwnMetadata: true,
	});

	return await token.toJwt();
}

async function connectToRoom(roomName: string): Promise<void> {
	try {
		console.log(`🔌 [Agent] Connecting to room: ${roomName}...`);

		const token = await createAgentToken(roomName);

		currentRoom = new Room({
			adaptiveStream: true,
			dynacast: true,
			disconnectOnPageLeave: false,
		});

		// Set up room event handlers
		currentRoom.on(RoomEvent.Connected, () => {
			console.log(`✅ [Agent] Connected to room: ${roomName}`);
			console.log(`🎯 [Agent] Identity: ${agentIdentity}`);
			console.log(`👥 [Agent] Participants: ${currentRoom!.numParticipants}`);

			// Send welcome message
			setTimeout(() => {
				const welcomeData = JSON.stringify({
					type: "live_transcription",
					text: `🤖 Tambo Voice Agent joined! I have ${AVAILABLE_TOOLS.length} tools available: ${AVAILABLE_TOOLS.join(", ")}`,
					speaker: agentIdentity,
					timestamp: Date.now(),
					is_final: true,
				});

				currentRoom!.localParticipant?.publishData(
					new TextEncoder().encode(welcomeData),
					{ reliable: true, topic: "transcription" },
				);
				console.log("📤 [Agent] Welcome message sent");
			}, 2000);
		});

		currentRoom.on(RoomEvent.Disconnected, (reason) => {
			console.log(`🔌 [Agent] Disconnected from room: ${reason}`);
			currentRoom = null;
		});

		currentRoom.on(RoomEvent.ParticipantConnected, (participant) => {
			console.log(`👤 [Agent] Participant joined: ${participant.identity}`);

			const welcomeMsg = JSON.stringify({
				type: "live_transcription",
				text: `Welcome ${participant.identity}! I'm equipped with tools and ready to assist.`,
				speaker: agentIdentity,
				timestamp: Date.now(),
				is_final: true,
			});

			currentRoom!.localParticipant?.publishData(
				new TextEncoder().encode(welcomeMsg),
				{ reliable: true, topic: "transcription" },
			);
		});

		currentRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
			console.log(`👋 [Agent] Participant left: ${participant.identity}`);
		});

		currentRoom.on(
			RoomEvent.TrackSubscribed,
			(track, publication, participant) => {
				if (track.kind === "audio") {
					console.log(`🎤 [Agent] Audio track from ${participant.identity}`);

					// Simulate transcription for demo
					let count = 0;
					const interval = setInterval(() => {
						count++;

						const transcriptionData = JSON.stringify({
							type: "live_transcription",
							text: `Demo transcription ${count} from ${participant.identity} - Agent active with tools!`,
							speaker: participant.identity,
							timestamp: Date.now(),
							is_final: count % 3 === 0,
						});

						currentRoom!.localParticipant?.publishData(
							new TextEncoder().encode(transcriptionData),
							{ reliable: true, topic: "transcription" },
						);
					}, 5000);

					// Stop on participant disconnect
					currentRoom!.on(RoomEvent.ParticipantDisconnected, (p) => {
						if (p.identity === participant.identity) {
							clearInterval(interval);
						}
					});
				}
			},
		);

		currentRoom.on(RoomEvent.DataReceived, (data, participant) => {
			try {
				const message = JSON.parse(new TextDecoder().decode(data));
				console.log(
					`📨 [Agent] Data received from ${participant?.identity}:`,
					message.type,
				);

				if (
					message.type === "user_message" ||
					message.type === "chat_message"
				) {
					const responseData = JSON.stringify({
						type: "live_transcription",
						text: `I heard: "${message.content || message.text}". I can help with YouTube searches and more!`,
						speaker: agentIdentity,
						timestamp: Date.now(),
						is_final: true,
					});

					currentRoom!.localParticipant?.publishData(
						new TextEncoder().encode(responseData),
						{ reliable: true, topic: "transcription" },
					);
				}
			} catch (error) {
				console.error("❌ [Agent] Error processing data message:", error);
			}
		});

		// Connect to the room
		await currentRoom.connect(serverUrl!, token);
	} catch (error) {
		console.error("❌ [Agent] Connection error:", error);
		currentRoom = null;
	}
}

async function pollForDispatchRequests(): Promise<void> {
	const fs = await import("fs/promises");
	const path = await import("path");

	const dispatchFile = path.join(process.cwd(), ".next/agent-dispatch.json");

	try {
		const data = await fs.readFile(dispatchFile, "utf-8");
		const dispatchData = JSON.parse(data);

		if (dispatchData.status === "pending") {
			console.log("📋 [Agent] Found pending dispatch request:", {
				roomName: dispatchData.roomName,
				agentIdentity: dispatchData.agentIdentity,
				trigger: dispatchData.trigger,
			});

			// Mark as processing
			dispatchData.status = "processing";
			await fs.writeFile(dispatchFile, JSON.stringify(dispatchData, null, 2));

			// Connect to the room
			await connectToRoom(dispatchData.roomName);

			// Mark as completed
			dispatchData.status = "completed";
			await fs.writeFile(dispatchFile, JSON.stringify(dispatchData, null, 2));
		}
	} catch (error) {
		// File doesn't exist or is invalid - this is normal
	}
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
	console.log("🎬 [Agent] Starting direct room monitoring...");
	console.log("📡 [Agent] Polling for dispatch requests every 3 seconds...");

	// Poll for dispatch requests every 3 seconds
	setInterval(pollForDispatchRequests, 3000);

	// Initial poll
	pollForDispatchRequests();

	// Keep the process alive
	console.log("⏳ [Agent] Direct agent ready and waiting for room activity...");
}
