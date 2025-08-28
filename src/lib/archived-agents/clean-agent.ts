#!/usr/bin/env node
/**
 * Clean Tambo Voice Agent - Back to First Principles
 *
 * Minimal LiveKit agent that should work with automatic dispatch from LiveKit Cloud
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions } from '@livekit/agents';

console.log('🤖 Clean Tambo Voice Agent Starting...');
console.log(`🔑 LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL}`);
console.log(`🔑 API Key present: ${!!process.env.LIVEKIT_API_KEY}`);
console.log(`🔑 Secret present: ${!!process.env.LIVEKIT_API_SECRET}`);

// Define the agent entry point
const tamboAgent = defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 AGENT AUTOMATIC DISPATCH WORKING! 🎉`);
    console.log(`📍 Joining room: ${job.room.name}`);
    console.log(`👥 Participants already in room: ${job.room.remoteParticipants.size}`);

    // Connect to the room
    await job.connect();
    console.log('✅ Agent connected successfully!');

    // Send a simple message to prove the agent is working
    const welcomeMessage = {
      type: 'agent_message',
      text: '🤖 Tambo Voice Agent joined the room via automatic dispatch!',
      timestamp: Date.now(),
    };

    job.room.localParticipant?.publishData(
      new TextEncoder().encode(JSON.stringify(welcomeMessage)),
      { reliable: true },
    );

    console.log('📢 Welcome message sent!');

    // Keep the agent alive to listen for events
    job.room.on('participantConnected', (participant) => {
      console.log(`👤 New participant: ${participant.identity}`);
    });

    job.room.on('dataReceived', (data, participant) => {
      console.log(`💬 Data from ${participant?.identity}: ${new TextDecoder().decode(data)}`);
    });

    console.log('🔄 Agent is now listening for room events...');
  },
});

// Run the agent worker if this file is executed directly
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('clean-agent.ts')) {
  console.log('🚀 Starting clean agent worker...');

  cli.runApp(
    new WorkerOptions({
      agent: tamboAgent,
      // For automatic dispatch, do NOT set agent_name
      // Let LiveKit handle dispatch automatically
    }),
  );
}

export default tamboAgent;
