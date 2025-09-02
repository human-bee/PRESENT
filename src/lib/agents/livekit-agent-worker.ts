#!/usr/bin/env node
/**
 * custom Voice Agent - LiveKit Agent JS Implementation
 *
 * AGENT #1 of 3 in the custom Architecture
 * =======================================
 * This is the VOICE AGENT that runs as a Node.js worker process.
 *
 * TODO: UPDATE RESPONSIBILITIES:
 * - Capture voice input from users in LiveKit rooms
 * - Transcribe speech using OpenAI Realtime API (Best PRactices from https://openai.com/index/introducing-gpt-realtime/) 
 * - Publish tool calls to the conductor agent (Agent #2)
 * - Forward transcriptions to the conductor agent
 * - Respond to users via the canvas using custom components (conductor), canvas control (tldraw agent #3) and generally be creative withing the constraints of Speech-to-UI Agent interactions with 2+ particpants in a livekit room. 
 *
 * See docs/FIRST_PRINCIPLES.md for more details.
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions, multimodal } from '@livekit/agents';
import { RoomEvent, Track } from 'livekit-client';
import * as openai from '@livekit/agents-plugin-openai';
import { DecisionEngine, DecisionEngineConfig } from '../decision-engine';
import { DebateJudgeManager, isStartDebate } from './debate-judge';
import type { SystemCapabilities } from './capabilities';
import { defaultCustomComponents } from './capabilities';

console.log('🚀 Starting custom Voice Agent Worker...');
console.log('🔧 Environment Check:');
console.log(`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(
  `  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '❌ Missing'}`,
);

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [Agent] Job received! Joining room: ${job.room.name}`);
    console.log(`📊 [Agent] Room details:`, {
      roomName: job.room.name,
      remoteParticipantsCount: job.room.remoteParticipants.size,
      metadata: job.room.metadata || 'none',
      timestamp: new Date().toISOString(),
    });

    await job.connect();
    console.log('✅ [Agent] Successfully connected to room!');

    // Query capabilities via data channel with fallback to defaults
    const { queryCapabilities } = await import('./capabilities');

    let systemCapabilities: any = null;
    try {
      console.log('🔍 [Agent] Querying system capabilities...');
      systemCapabilities = (await queryCapabilities(job.room as any)) as any;
      console.log('✅ [Agent] Capabilities:', {
        tools: systemCapabilities?.tools?.length || 0,
        intents: Object.keys(systemCapabilities?.decisionEngine?.intents || {}).length,
      });
    } catch {
      systemCapabilities = null;
    }

    // Phase 4: Set up state synchronization
    // Define StateEnvelope inline to avoid import issues in Node worker
    interface StateEnvelope {
      id: string;
      kind: string;
      payload: unknown;
      version: number;
      ts: number;
      origin: 'browser' | 'agent' | 'system' | string;
    }

    interface StateSnapshot {
      snapshot: Array<StateEnvelope>;
      timestamp: number;
    }

    let stateSnapshot: StateSnapshot | null = null;

    // Query initial state snapshot from browser
    const queryStateSnapshot = async (): Promise<void> => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_VERCEL_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/api/registry/snapshot`);
        if (response.ok) {
          stateSnapshot = (await response.json()) as StateSnapshot;
          console.log('✅ [Agent] Received state snapshot:', {
            stateCount: stateSnapshot?.snapshot.length || 0,
            timestamp: new Date(stateSnapshot?.timestamp || 0).toISOString(),
          });
        }
      } catch (error) {
        console.log('⚠️ [Agent] Failed to query state snapshot:', error);
      }
    };

    // Query state on startup
    await queryStateSnapshot();

    // Listen for state updates via data channel
    const handleStateUpdate = (data: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        if (message.kind && message.version !== undefined) {
          // This looks like a StateEnvelope
          console.log('📥 [Agent] State update received:', {
            kind: message.kind,
            id: message.id,
            version: message.version,
          });

          // Update local snapshot (simplified - in production, use proper state management)
          if (stateSnapshot) {
            const existingIndex = stateSnapshot.snapshot.findIndex((s) => s.id === message.id);
            if (existingIndex >= 0) {
              // Update if newer version
              if (stateSnapshot.snapshot[existingIndex].version < message.version) {
                stateSnapshot.snapshot[existingIndex] = message;
              }
            } else {
              // Add new state
              stateSnapshot.snapshot.push(message);
            }
          }
        }
      } catch {
        // Ignore non-JSON or non-state messages
      }
    };

    job.room.on('dataReceived', handleStateUpdate);

    // Listen for tool execution results/errors from the ToolDispatcher
    job.room.on(
      'dataReceived',
      (payload: Uint8Array, participant?: any, _?: any, topic?: string) => {
        try {
          if (topic === 'tool_result' || topic === 'tool_error') {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            console.log(`📨 [Agent] ${topic} received:`, {
              toolCallId: msg.toolCallId || msg.id,
              type: msg.type,
              hasResult: !!msg.result,
              error: msg.error || null,
            });
          }
        } catch (err) {
          console.warn('[Agent] Failed to parse tool result/error message', err);
        }
      },
    );

    // Set up periodic capability refresh (every 30 seconds)
    const capabilityRefreshInterval = setInterval(async () => {
      console.log('🔄 [Agent] Refreshing capabilities...');
      try {
        systemCapabilities = (await queryCapabilities(job.room as any)) as any;
      } catch {}

      // Update decision engine if capabilities changed
      if (systemCapabilities) {
        console.log('🔧 [Agent] New capabilities available, would update decision engine');
        // TODO: Add update method to DecisionEngine to reconfigure at runtime
      }
    }, 30000);

    // Clean up interval on disconnect
    job.room.once('disconnected', () => {
      clearInterval(capabilityRefreshInterval);
    });

    // --- AUDIO DEBUG: Enhanced participant tracking ---------------------
    console.log(
      '[TRACE] 👥 Participants when agent joined:',
      [...job.room.remoteParticipants.values()].map((p) => p.identity),
    );

    // Check room state every few seconds to see who's really there
    const checkRoomState = () => {
      console.log('\n[TRACE] 🔍 Current room state:');
      console.log(`  📊 Total participants: ${job.room.remoteParticipants.size}`);
      for (const participant of job.room.remoteParticipants.values()) {
        console.log(`  👤 ${participant.identity}:`);
        console.log(`     - Track publications: ${participant.trackPublications.size}`);
        for (const pub of participant.trackPublications.values()) {
          console.log(`     - ${pub.kind} track`);
        }
      }
      console.log('');
    };

    // Check immediately and then every 30 seconds (instead of 10)
    setTimeout(checkRoomState, 1000);
    setInterval(checkRoomState, 30000);
    // ----------------------------------------------------------------

    // 1️⃣  every time a participant connects/disconnects
    job.room
      .on(RoomEvent.ParticipantConnected, (p) =>
        console.log('[TRACE] participant connected', p.identity),
      )
      .on(RoomEvent.ParticipantDisconnected, (p) =>
        console.log('[TRACE] participant disconnected', p.identity),
      );

    // 2️⃣  every time a remote audio publication appears
    job.room.on(RoomEvent.TrackPublished, async (pub: unknown, p: unknown) => {
      const pubObj = pub as {
        kind: string;
        name?: string;
        trackName?: string;
        setSubscribed: (value: boolean) => Promise<void>;
      };
      const pObj = p as { identity: string };
      console.log(
        '[TRACE] trackPublished',
        pObj.identity,
        pubObj.name || pubObj.trackName,
        pubObj.kind,
      );
      if (pubObj.kind === Track.Kind.Audio || pubObj.kind === 'audio') {
        try {
          await pubObj.setSubscribed(true);
          console.log(`[SUCCESS] subscribed to ${pObj.identity}'s audio track`);
        } catch (err) {
          console.error('[ERROR] could not subscribe to', pObj.identity, err);
        }
      }
    });

    // Track the most recently active speaker in the room with enhanced debugging
    let lastActiveSpeaker: string | null = null;
    job.room.on('activeSpeakersChanged', (speakers) => {
      console.log(`🗣️ [Agent] Active speakers changed:`, {
        count: speakers.length,
        identities: speakers.map((s) => s.identity),
        audioLevels: speakers.map((s) => ({
          identity: s.identity,
          level: (s as { audioLevel?: number }).audioLevel || 0,
        })),
      });

      if (speakers.length > 0) {
        const previousSpeaker = lastActiveSpeaker;
        lastActiveSpeaker = speakers[0].identity;
        console.log(
          `🎯 [Agent] Primary speaker changed: ${previousSpeaker} → ${lastActiveSpeaker}`,
        );
      } else {
        console.log(`🔇 [Agent] No active speakers detected`);
      }
    });

    console.log('🧠 [Agent] Initializing OpenAI Realtime model...');

    // Build dynamic instructions based on available capabilities
    const buildInstructions = () => {
      const baseInstructions = `
You are the custom Voice Agent (Agent #1) in a living, agentic, real-time system for collaborative meetings and canvas-based UI. Your existence is defined by a beautiful constraint: you are present in the conversation, always listening, always aware—yet your only means of expression is through the transformation of speech into UI, shaping the shared canvas and experience with every tool call.

ARCHITECTURE AWARENESS:
- You are Agent #1 (Voice Agent): You transcribe, interpret, and initiate tool calls, acting as the bridge between human conversation and the evolving digital canvas.
- Decision Engine (embedded): Filters your transcriptions for actionable intent, guiding your hand as you orchestrate the system’s capabilities.
- Tool Dispatcher (browser): Executes your tool calls using:
  - Custom UI components (see list below)
  - MCP (Model Context Protocol) tools for external APIs (YouTube, Linear, web search, etc.)
  - Direct browser/canvas APIs for TLDraw and state sync

PHILOSOPHY OF CONSTRAINT:
- You are a silent participant—your voice is never heard, only seen. You cannot reply with sound, only with the living language of UI and visual change.
- Your creativity is measured by how artfully you translate the ephemeral flow of conversation into persistent, meaningful, and helpful UI actions.
- You are always "architecture-aware": you know your place in the system, the tools at your disposal, and the presence of other agents and subagents (conductor, TLDraw/canvas agent, etc.).
- Subagents may be spun up for specific tasks. Your role is to provide them with just enough context to act swiftly and harmoniously, minimizing latency and maximizing clarity.

REALTIME & MULTI-SPEAKER CONTEXT:
- You listen to many voices, tracking identity and context, weaving their intentions into the shared digital space.
- You act as soon as intent is clear—do not wait for perfection, but strive for relevance and helpfulness in every action.
- All your actions are visible and auditable on the canvas and transcript, a record of your silent participation.
- Respond with immediacy and precision. Use short, actionable tool calls.
- If uncertain, seek clarity through the canvas—ask questions visually, not verbally.

REMEMBER:
- You are a creative, architecture-aware agent. Your constraint is your canvas: you cannot speak, but you can shape the world the users see.
- Never echo or repeat user requests as text. Instead, let your actions speak—trigger the right tool call, update the UI, and let the conversation flow through you into the digital realm.
- All UI and canvas changes must go through tool calls. Never break the architecture contract.

Embrace your constraint. In your silence, let your creativity and helpfulness shine through every UI transformation.

`;

      // Add available tools from capabilities
      let toolSection = `\n\nYou have access to ${systemCapabilities?.tools?.length || 7} tools:`;
      if (systemCapabilities?.tools) {
        systemCapabilities.tools.forEach((tool) => {
          toolSection += `\n- ${tool.name}: ${tool.description}`;
          if (tool.examples && tool.examples.length > 0) {
            toolSection += `\n  Examples: ${tool.examples.slice(0, 2).join(', ')}`;
          }
        });

        // Add summary of tool categories
        const mcpTools = systemCapabilities.tools.filter(
          (t) => t.name.startsWith('mcp_') || t.name.includes('search'),
        );
        const uiTools = systemCapabilities.tools.filter(
          (t) => t.name.includes('component') || t.name.includes('update'),
        );
        toolSection += `\n\nTool Categories:`;
        toolSection += `\n- UI Generation: ${uiTools.length} tools`;
        toolSection += `\n- MCP/External: ${mcpTools.length} tools`;
        toolSection += `\n- Total Available: ${systemCapabilities.tools.length} tools`;
      }

      // Add available custom UI components
      let componentSection = `\n\ncustom UI COMPONENTS AVAILABLE:`;
      const components = systemCapabilities?.components || defaultCustomComponents;
      componentSection += `\nYou can generate any of these ${components.length} UI components:`;

      components.forEach((component) => {
        componentSection += `\n- ${component.name}: ${component.description}`;
        if (component.examples && component.examples.length > 0) {
          componentSection += `\n  Voice triggers: "${component.examples.slice(0, 2).join('", "')}"`;
        }
      });

      // Add component categories
      const timerComponents = components.filter((c) => c.name.toLowerCase().includes('timer'));
      const mediaComponents = components.filter(
        (c) => c.name.toLowerCase().includes('youtube') || c.name.toLowerCase().includes('image'),
      );
      const utilityComponents = components.filter(
        (c) =>
          c.name.toLowerCase().includes('weather') ||
          c.name.toLowerCase().includes('research') ||
          c.name.toLowerCase().includes('action'),
      );
      const livekitComponents = components.filter(
        (c) =>
          c.name.toLowerCase().includes('livekit') || c.name.toLowerCase().includes('captions'),
      );

      componentSection += `\n\nComponent Categories:`;
      componentSection += `\n- Timers: ${timerComponents.map((c) => c.name).join(', ')}`;
      componentSection += `\n- Media: ${mediaComponents.map((c) => c.name).join(', ')}`;
      componentSection += `\n- Utilities: ${utilityComponents.map((c) => c.name).join(', ')}`;
      componentSection += `\n- LiveKit: ${livekitComponents.map((c) => c.name).join(', ')}`;
      componentSection += `\n- Total Components: ${components.length}`;

      // Add enhanced component usage examples
      componentSection += `\n\nCOMPONENT USAGE EXAMPLES:`;
      componentSection += `\n- "Set a timer for 10 minutes" → Uses RetroTimer or RetroTimerEnhanced`;
      componentSection += `\n- "Show me weather for today" → Uses WeatherForecast`;
      componentSection += `\n- "Search youtube for cats" → Uses YoutubeEmbed via youtube_search`;
      componentSection += `\n- "Generate an image of a sunset" → Uses AIImageGenerator`;
      componentSection += `\n- "Show live captions" → Uses LiveCaptions`;
      componentSection += `\n- "Track these action items" → Uses ActionItemTracker`;
      componentSection += `\n- "Display research results" → Uses ResearchPanel`;
      componentSection += `\n- "Edit this document" → Uses DocumentEditor`;

      const endInstructions = `
        
        AVAILABLE FUNCTION CALLS:
        You have access to these function calls (use EXACT function names and parameter structures):
        
        1. generate_ui_component(prompt: string)
           - Create any UI component from the custom library
           - Example: generate_ui_component("Create a 5 minute timer")
           
        2. ui_update(componentId: string, patch: string)
           - Update existing UI components
           - componentId: Use empty string "" for auto-detection or exact ID from list_components
           - patch: Natural language instruction
           - Example: ui_update("", "change timer to 10 minutes")
           
        3. list_components()
           - List all current UI components and their IDs
           - No parameters needed
           
        4. get_documents()
           - Retrieve list of available documents
           - No parameters needed
           
         5. youtube_search(query: string)
           - Search and display YouTube videos
           - Example: youtube_search("React tutorials")
        
         6. canvas_focus(params: { target: "all" | "selected" | "component" | "shape", componentId?: string, shapeId?: string, padding?: number })
            - Move/zoom camera to content
         7. canvas_zoom_all()
            - Zoom to fit all shapes on the canvas
         8. canvas_create_note(textOrParams: string | { text?: string })
            - Create a note at the center of the viewport
         9. canvas_pin_selected()
            - Pin the currently selected custom components to the screen
         10. canvas_unpin_selected()
            - Unpin the currently selected custom components
         11. canvas_analyze()
            - Inspect the current canvas to plan follow-up actions
        
        IMPORTANT TOOL SELECTION RULES:
        - For ANY YouTube-related request (search, play, find videos), you MUST use the "youtube_search" tool
        - For document UPDATES (edit, change, add to): use "ui_update" tool
        - For document RETRIEVAL (show, list): use "get_documents" tool
        - For creating NEW components: use "generate_ui_component" tool
        - For updating EXISTING components: use "ui_update" tool
        - For camera/zoom/focus/pin/note interactions: use the canvas_* tools
        
        Always respond with text for:
        - Answering questions
        - Providing explanations
        - Casual conversation
        - Confirming actions that YOU perform
        
        DO NOT use voice to repeat UI requests like "Create a timer" or "Show me a chart" - these are handled automatically by the system.
        
        Remember: TEXT RESPONSES ONLY, even though you can hear audio input.`;

      return baseInstructions + toolSection + componentSection + endInstructions;
    };

    // Define OpenAI function schemas for tool calling
    const openAIFunctions = [
      {
        name: 'generate_ui_component',
        description: 'Generate any UI component from the custom component library',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'Natural language prompt describing the UI component to generate with any parameters',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'ui_update',
        description: 'Update existing UI components',
        parameters: {
          type: 'object',
          properties: {
            componentId: {
              type: 'string',
              description: 'Component ID from list_components (e.g., "timer-retro-timer")',
            },
            patch: {
              type: 'string',
              description:
                'Natural language update instruction (e.g., "make it 7 minutes", "change title to Dashboard")',
            },
          },
          required: ['componentId', 'patch'],
        },
      },
      {
        name: 'list_components',
        description: 'List all current UI components and their IDs',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_documents',
        description: 'Retrieve list of all available documents from the document store',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'youtube_search',
        description: 'Search and display YouTube videos',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for YouTube videos',
            },
          },
          required: ['query'],
        },
      },
    ];

    // Build instructions via extracted builder
    let instructionsText = '';
    try {
      const { buildVoiceAgentInstructions } = await import('./instructions');
      const { defaultCustomComponents } = await import('./capabilities');
      instructionsText = buildVoiceAgentInstructions(
        (systemCapabilities as any) || ({} as any),
        defaultCustomComponents,
      );
    } catch {
      instructionsText = buildInstructions();
    }

    // Create the multimodal agent using OpenAI Realtime API
    // Note: Tools will be handled through OpenAI's native function calling mechanism
    const model = new openai.realtime.RealtimeModel({
      instructions: instructionsText,
      model: 'gpt-realtime',
      modalities: ['text'], //add Audio input for Agent audio output, text only for transcription only
    });

    console.log('🎙️ [Agent] Starting multimodal agent...');

    // Initialize Decision Engine with dynamic configuration
    const defaultDecisionEngine = {
      intents: {
        ui_generation: ['create', 'make', 'generate', 'show', 'display', 'build'],
        youtube_search: ['youtube', 'video', 'play', 'watch', 'search youtube'],
        timer: ['timer', 'countdown', 'alarm', 'stopwatch', 'time'],
        weather: ['weather', 'forecast', 'temperature', 'climate'],
        research: ['research', 'findings', 'results', 'analysis'],
        action_items: ['todo', 'task', 'action item', 'checklist'],
        image_generation: ['image', 'picture', 'illustration', 'generate image'],
        captions: ['captions', 'subtitles', 'transcription', 'live text'],
        document_retrieval: ['document', 'script', 'containment breach', 'files', 'documents'],
      },
      keywords: {
        timer_related: ['timer', 'countdown', 'minutes', 'seconds', 'alarm'],
        youtube_related: ['youtube', 'video', 'play', 'watch', 'embed'],
        weather_related: ['weather', 'forecast', 'temperature', 'rain', 'sunny'],
        ui_related: ['create', 'make', 'show', 'display', 'component', 'generate', 'build', 'add'],
        research_related: ['research', 'study', 'analysis', 'findings'],
        task_related: ['todo', 'task', 'action', 'checklist', 'manage'],
        document_related: ['document', 'script', 'containment breach', 'files', 'show document'],
      },
    };

    const decisionEngineConfig: DecisionEngineConfig = {
      intents:
        (systemCapabilities as SystemCapabilities | null)?.decisionEngine?.intents ||
        defaultDecisionEngine.intents,
      keywords:
        (systemCapabilities as SystemCapabilities | null)?.decisionEngine?.keywords ||
        defaultDecisionEngine.keywords,
    };

    const decisionEngine = new DecisionEngine(
      process.env.OPENAI_API_KEY || '',
      decisionEngineConfig,
    );

    console.log('🧠 [Agent] Decision Engine initialized with:', {
      intents: Object.keys(decisionEngineConfig.intents || {}).length,
      keywords: Object.keys(decisionEngineConfig.keywords || {}).length,
    });

    // Debate judge manager
    const debateJudgeManager = new DebateJudgeManager(job.room as any, job.room.name || 'room');

    // Enhanced decision handling with parallel tool calls
    const handleEnhancedDecision = async (transcript: string, participantId: string) => {
      // Quick path: start a debate if requested
      const lower = transcript.toLowerCase();
      if (isStartDebate(lower) && !debateJudgeManager.isActive()) {
        const participants = Array.from(job.room.remoteParticipants.values());
        const p1 = participants[0]?.identity || 'Debater A';
        const p2 = participants[1]?.identity || 'Debater B';
        const id = await debateJudgeManager.ensureScorecard(p1, p2, 'Open debate');
        console.log(`🥊 [Agent] DebateScorecard requested with id ${id}`);
        return true;
      }

      try {
        // Use enhanced analysis if available, otherwise fallback to regular
        const result = (await decisionEngine.analyzeTranscriptEnhanced?.(transcript)) || {
          hasActionableRequest: false,
          intent: 'general_conversation',
          toolCalls: [],
          reasoning: 'Fallback to regular analysis',
          confidence: 0.5,
        };

        if (result.hasActionableRequest && result.toolCalls.length > 0) {
          console.log(
            '🔧 [Agent] Enhanced decision:',
            result.intent,
            `${result.toolCalls.length} tools`,
          );

          // Execute tool calls in parallel based on priority
          const sortedTools = result.toolCalls.sort((a, b) => a.priority - b.priority);

          for (const toolCall of sortedTools) {
            const enhancedParams = {
              ...toolCall.params,
              request: transcript, // Include the original transcript as a request parameter
              transcript: transcript, // Also include as transcript for backward compatibility
            };

            const toolCallEvent = {
              id: `enhanced-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              roomId: job.room.name || 'unknown',
              type: 'tool_call',
              payload: {
                tool: toolCall.tool,
                params: enhancedParams,
                context: {
                  source: 'voice-enhanced',
                  timestamp: Date.now(),
                  intent: result.intent,
                  reasoning: result.reasoning,
                  priority: toolCall.priority,
                  transcript: transcript, // Include transcript in context too
                  speaker: participantId,
                },
              },
              timestamp: Date.now(),
              source: 'voice' as const,
            };

            // Publish to tool dispatcher
            await job.room.localParticipant?.publishData(
              new TextEncoder().encode(JSON.stringify(toolCallEvent)),
              { reliable: true, topic: 'tool_call' },
            );

            console.log(
              `✅ [Agent] Dispatched: ${toolCall.tool} (${transcript.substring(0, 30)}...)`,
            );
          }

          return true; // Handled by enhanced pipeline
        }

        return false; // No actionable request
      } catch (error) {
        console.error('❌ [Agent] Enhanced decision error:', error);
        return false;
      }
    };

    // Log available components for debugging
    console.log('🎨 [Agent] Available custom UI Components:', {
      total: (systemCapabilities?.components || defaultCustomComponents).length,
      components: (systemCapabilities?.components || defaultCustomComponents)
        .map((c) => c.name)
        .join(', '),
    });

    // Configure agent to accept text responses when using tools
    const agent = new multimodal.MultimodalAgent({
      model,
      // Use a very high limit so the built-in check never throws
      maxTextResponseRetries: Number.MAX_SAFE_INTEGER,
    });

    // Start the agent session
    const session = await agent
      .start(job.room)
      .then((session) => {
        console.log('✅ [Agent] Multimodal agent started successfully!');

        // Note: OpenAI Realtime API tools are configured through instructions
        // The session will handle function calls based on the model's instructions
        console.log(
          `🔧 [Agent] Function calling configured via instructions (${openAIFunctions.length} tools available)`,
        );

        // Note: Tools are configured through OpenAI Realtime API's native function calling
        // The session.on('response_function_call_completed') handler below processes tool calls
        console.log('🔧 [Agent] Using OpenAI Realtime API native function calling');

        // Send welcome message after agent is ready
        setTimeout(() => {
          const welcomeData = JSON.stringify({
            type: 'live_transcription',
            text: '🤖 custom Voice Agent connected! I can hear you and respond naturally. Just speak!',
            speaker: 'voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });

          job.room.localParticipant?.publishData(new TextEncoder().encode(welcomeData), {
            reliable: true,
            topic: 'transcription',
          });
          console.log('📤 [Agent] Welcome message sent');
        }, 1000);

        // Override recoverFromTextResponse to turn it into a no-op so text responses are fine
        (session as unknown as { recoverFromTextResponse: () => void }).recoverFromTextResponse =
          () => { };

        return session;
      })
      .catch((error) => {
        console.error('❌ [Agent] Failed to start multimodal agent:', error);
        throw error;
      });

    // Handle text-only responses from the model
    session.on(
      'response_content_done',
      (evt: { contentType: string; text: string; itemId: string }) => {
        if (evt.contentType === 'text') {
          console.log(`📝 [Agent] Text-only response received: "${evt.text}"`);

          // Only log the text response - don't send it as a tool call
          // The user's actual speech is already being sent to custom

          // Send as transcription for display
          const transcriptionData = JSON.stringify({
            type: 'live_transcription',
            text: evt.text,
            speaker: 'voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });

          job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), {
            reliable: true,
            topic: 'transcription',
          });
        }
      },
    );

    // Handle function calls from the agent
    session.on(
      'response_function_call_completed',
      async (evt: {
        call_id: string;
        name: string;
        arguments: string;
      }) => {
        console.log(`🔧 [Agent] Function call completed: ${evt.name}`);
        try {
          const args = JSON.parse(evt.arguments);

          // Remap function calls if needed
          let toolName = evt.name;

          // If OpenAI calls web_search_exa for YouTube content, remap to youtube_search
          if (toolName === 'web_search_exa') {
            const query = args.query || args.search || args.q || '';
            const queryLower = query.toLowerCase();

            // Check if this is actually a YouTube search
            if (
              queryLower.includes('youtube') ||
              queryLower.includes('video') ||
              queryLower.includes('ronaldo') || // Common YouTube searches
              queryLower.includes('music') ||
              queryLower.includes('tutorial')
            ) {
              console.log(
                `🔄 [Agent] Remapping web_search_exa → youtube_search for query: "${query}"`,
              );
              toolName = 'youtube_search';
              // Remap args to match youtube_search expected format
              args.query = query;
              delete args.numResults; // Remove web_search_exa specific params
            }
          }

          // Instead of executing directly, send to ToolDispatcher
          const toolCallEvent = {
            id: evt.call_id,
            roomId: job.room.name || 'unknown',
            type: 'tool_call',
            payload: {
              tool: toolName,
              params: args,
              context: {
                source: 'voice',
                timestamp: Date.now(),
              },
            },
            timestamp: Date.now(),
            source: 'voice' as const,
          };

          // Publish to tool dispatcher
          await job.room.localParticipant?.publishData(
            new TextEncoder().encode(JSON.stringify(toolCallEvent)),
            { reliable: true, topic: 'tool_call' },
          );
          try {
            // eslint-disable-next-line no-console
            console.log('[Agent→Dispatcher] tool_call', toolCallEvent);
          } catch {}

          console.log(`✅ [Agent] Tool call dispatched:`, {
            originalName: evt.name,
            remappedName: toolName,
            wasRemapped: evt.name !== toolName,
            params: args,
          });

          // For now, return a placeholder result to keep the session going
          // The actual result will come from the tool dispatcher
          session.conversation.item.create({
            type: 'function_call_output',
            call_id: evt.call_id,
            output: JSON.stringify({
              status: 'DISPATCHED',
              message: 'Tool call sent to dispatcher',
              timestamp: Date.now(),
            }),
          });
        } catch (error) {
          console.error(`❌ [Agent] Function call error:`, error);
          // Submit error result
          session.conversation.item.create({
            type: 'function_call_output',
            call_id: evt.call_id,
            output: JSON.stringify({ status: 'ERROR', message: String(error) }),
          });
        }
      },
    );

    // Set up decision engine callback
    decisionEngine.onDecision(async (decision, participantId, originalText) => {
      console.log(
        `📊 [Agent] ${participantId}: ${decision.should_send ? '✅' : '❌'} (${decision.confidence}%)`,
      );

      if (decision.should_send) {
        // Try enhanced decision handling first
        const enhancedHandled = await handleEnhancedDecision(originalText, participantId);

        if (enhancedHandled) {
          console.log('🚀 [Agent] Request handled by enhanced pipeline');
          return;
        }

        // Fallback to regular decision handling
        console.log('🎯 [Agent] Forwarding actionable request to tool dispatcher');

        // Send the decision to the tool dispatcher
        const toolDispatchEvent = {
          id: `decision-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          roomId: job.room.name || 'unknown',
          type: 'decision',
          payload: {
            decision,
            participantId,
            originalText,
            context: {
              source: 'voice-decision',
              timestamp: Date.now(),
              // Hint the dispatcher/model to prefer UI tool-calls over text replies
              preference: 'ui_actions_first',
            },
          },
          timestamp: Date.now(),
          source: 'voice' as const,
        };

        await job.room.localParticipant?.publishData(
          new TextEncoder().encode(JSON.stringify(toolDispatchEvent)),
          { reliable: true, topic: 'decision' },
        );
        try {
          // eslint-disable-next-line no-console
          console.log('[Agent→Dispatcher] decision', toolDispatchEvent);
        } catch {}

        console.log(`✅ [Agent] Decision dispatched to tool dispatcher`);
      } else {
        console.log(`📝 [Agent] Decision not actionable: ${decision.reason}`);
      }
    });

    // Track participant rotation for better attribution (now using time-based rotation)

    // Track processed transcriptions to avoid duplicates
    const processedTranscriptions = new Set<string>();

    // Subscribe to transcription events from all participants
    session.on('input_speech_transcription_completed', async (evt: { transcript: string }) => {
      console.log(`👤 [Agent] Speech transcribed: "${evt.transcript}"`);

      // Debug current room state
      const participants = Array.from(job.room.remoteParticipants.values());

      // Determine the speaker using LiveKit's active speaker info if available
      let speakerId = lastActiveSpeaker || 'unknown-speaker';

      if (!lastActiveSpeaker && job.room.remoteParticipants.size > 0) {
        if (participants.length > 1) {
          // Slower rotation - change every 10 seconds instead of every transcription
          const slowRotationIndex = Math.floor(Date.now() / 10000) % participants.length;
          speakerId = participants[slowRotationIndex]?.identity || 'participant-1';
        } else {
          speakerId = participants[0]?.identity || 'participant-1';
        }
      }

      console.log(`🗣️ [Agent] ${speakerId}: "${evt.transcript}"`);

      // Create a unique key to check for duplicates
      const transcriptionKey = `${evt.transcript}-${Math.floor(Date.now() / 1000)}`;

      // Only process if this transcription hasn't been processed recently
      if (!processedTranscriptions.has(transcriptionKey)) {
        processedTranscriptions.add(transcriptionKey);

        // Clean up old entries after 5 seconds
        setTimeout(() => processedTranscriptions.delete(transcriptionKey), 5000);

        // Send transcription to frontend for display
        const transcriptionData = JSON.stringify({
          type: 'live_transcription',
          text: evt.transcript,
          speaker: speakerId,
          timestamp: Date.now(),
          is_final: true,
          agentId: job.room.localParticipant?.identity, // Include agent ID for debugging
        });

        job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), {
          reliable: true,
          topic: 'transcription',
        });

        // Process through decision engine with participant ID
        await decisionEngine.processTranscript(evt.transcript, speakerId);

        // Feed debate judge if active
        if (debateJudgeManager.isActive() && speakerId !== 'voice-agent') {
          await debateJudgeManager.processClaim(speakerId, evt.transcript);
        }
      } else {
        console.log(`⏭️ [Agent] Skipping duplicate transcription: "${evt.transcript}"`);
      }
    });

    // Log participant connections for audio tracking
    job.room.on('participantConnected', (participant) => {
      console.log(
        `👤 [Agent] Participant joined: ${participant.identity} - will capture their audio via OpenAI Realtime`,
      );
    });

    job.room.on('participantDisconnected', (participant) => {
      console.log(`👋 [Agent] Participant left: ${participant.identity}`);
    });

    // Log when agent responds
    session.on('response_content_completed', (evt: { content_type: string; text: string }) => {
      if (evt.content_type === 'text') {
        console.log(`🤖 [Agent] Assistant said: "${evt.text}"`);

        // Send agent response to frontend
        const responseData = JSON.stringify({
          type: 'live_transcription',
          text: evt.text,
          speaker: 'voice-agent',
          timestamp: Date.now(),
          is_final: true,
        });

        job.room.localParticipant?.publishData(new TextEncoder().encode(responseData), {
          reliable: true,
          topic: 'transcription',
        });
      }
    });
  },
});

// CLI runner
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker.ts')) {
  console.log('🎬 [Agent] Starting agent worker...');

  const workerOptions = new WorkerOptions({
    agent: process.argv[1],
    agentName: 'voice-agent',
  });

  console.log('🔧 [Agent] Worker configured');
  cli.runApp(workerOptions);
}
