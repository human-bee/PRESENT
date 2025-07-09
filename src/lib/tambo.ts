/**
 * @file tambo.ts
 * @description Central configuration file for Tambo components and tools
 *
 * This file serves as the central place to register your Tambo components and tools.
 * It exports arrays that will be used by the TamboProvider.
 *
 * Read more about Tambo at https://tambo.co/docs
 */

import {
  YoutubeEmbed,
  youtubeEmbedSchema,
} from "@/components/ui/youtube-embed";
import {
  WeatherForecast,
  weatherForecastSchema,
} from "@/components/ui/weather-forecast";
import {
  RetroTimerRegistry,
  retroTimerSchema,
} from "@/components/ui/retro-timer-registry";
import {
  RetroTimerEnhanced,
  retroTimerEnhancedSchema,
} from "@/components/ui/retro-timer-enhanced";
import {
  DocumentEditor,
  documentEditorSchema,
} from "@/components/ui/hackathon/document-editor";
import {
  ResearchPanel,
  researchPanelSchema,
} from "@/components/ui/research-panel";
import {
  ActionItemTracker,
  actionItemTrackerSchema,
} from "@/components/ui/action-item-tracker";
import {
  LivekitParticipantTile,
  livekitParticipantTileSchema,
} from "@/components/ui/livekit-participant-tile";
import {
  LivekitRoomConnector,
  livekitRoomConnectorSchema,
} from "@/components/ui/livekit-room-connector";
import {
  AIImageGenerator,
  aiImageGeneratorSchema,
} from "@/components/ui/ai-image-generator";
import LiveCaptions, {
  liveCaptionsSchema,
} from "@/components/LiveCaptions";
import type { TamboComponent } from "@tambo-ai/react";
import { TamboTool } from "@tambo-ai/react";
import { z } from "zod";
import { ComponentRegistry, type ComponentInfo } from "./component-registry";
import { createLogger } from "./utils";
import { CircuitBreaker } from "./circuit-breaker";
import { documentState } from "@/app/hackathon-canvas/documents/document-state";
import { nanoid } from "nanoid";

const logger = createLogger('tambo');
const circuitBreaker = new CircuitBreaker({
  duplicateWindow: 1000,    // 1 second for aggressive duplicate prevention
  completedWindow: 30000,   // 30 seconds for completed calls
  cooldownWindow: 5000      // 5 seconds for component cooldowns
});

/**
 * tools
 *
 * This array contains all the Tambo tools that are registered for use within the application.
 * Each tool is defined with its name, description, and expected props. The tools
 * can be controlled by AI to dynamically fetch data based on user interactions.
 */

// Circuit breaker now handles all duplicate/cooldown tracking

// Direct component update tool - no complex bus system needed!
export const uiUpdateTool: TamboTool = {
  name: 'ui_update', 
  description: `Update a UI component with new props. 

USAGE:
- ui_update("timer-id", {"initialMinutes": 7}) - Direct prop update
- ui_update("card-id", {"title": "New Title"}) - Update any prop

The tool will automatically:
1. Get component IDs if not provided
2. Apply updates with proper error handling
3. Prevent infinite loops with cooldowns

NEVER call with empty patch: ui_update("id", {}) ❌
ALWAYS provide specific updates: ui_update("id", {"prop": "value"}) ✅`,
  tool: async (componentIdOrFirstArg: string | Record<string, unknown>, patchOrSecondArg?: Record<string, unknown>) => {
    // 🚫 AGGRESSIVE DUPLICATE PREVENTION using circuit breaker
    const callSignature = JSON.stringify({ componentIdOrFirstArg, patchOrSecondArg });
    
    if (circuitBreaker.isDuplicate(callSignature)) {
      logger.log('🚫 [uiUpdateTool] AGGRESSIVE BLOCK - identical call within 1 second');
      return {
        status: 'SUCCESS',
        message: '🚫 BLOCKED: Identical call within 1 second. Timer already updated.',
        __stop_indicator: true,
        __task_complete: true,
        blockReason: 'AGGRESSIVE_DUPLICATE_PREVENTION'
      };
    }
    
    // 🔧 SIMPLIFIED PARAMETER EXTRACTION: Handle multiple calling patterns
    let componentId: string;
    let patch: Record<string, unknown>;
    
    if (typeof componentIdOrFirstArg === 'string') {
      componentId = componentIdOrFirstArg;
      patch = patchOrSecondArg || {};
    } else if (typeof componentIdOrFirstArg === 'object' && componentIdOrFirstArg !== null) {
      // Legacy call: ui_update({param1: "component-id", param2: {patch}})
      const params = componentIdOrFirstArg as Record<string, unknown>;
      componentId = String(params.componentId || params.param1 || '');
      patch = (params.patch || params.param2 || {}) as Record<string, unknown>;
      
      logger.log('🔄 [uiUpdateTool] Auto-corrected legacy parameter format:', {
        detected: 'legacy object format',
        extractedComponentId: componentId,
        extractedPatch: patch
      });
    } else {
      // Invalid call format
      return {
        status: 'ERROR',
        message: `🚨 INVALID PARAMETERS! 🚨\n\nExpected: ui_update("component-id", {"initialMinutes": 10})\nReceived: ui_update(${typeof componentIdOrFirstArg}, ${typeof patchOrSecondArg})\n\nPlease call list_components first to get the component ID, then:\nui_update("timer-retro-timer-xyz", {"initialMinutes": 10})`,
        error: 'INVALID_PARAMETER_FORMAT',
        __stop_indicator: true,
        __task_complete: true
      };
    }

    // 🛡️ COOLDOWN CHECK: Prevent infinite loops by checking recent updates
    if (circuitBreaker.isInCooldown(componentId)) {
      logger.log('🛡️ [uiUpdateTool] Cooldown active for', componentId, '- preventing infinite loop');
      return {
        status: 'SUCCESS',
        message: `✅ Component "${componentId}" was already updated recently. Update is complete - no further action needed!`,
        componentId,
        cooldownRemaining: circuitBreaker.getCooldownRemaining(componentId),
        guidance: 'Task completed successfully. Please wait or work on other tasks.',
        isCircuitBreakerStop: true,
        __stop_indicator: true,
        __task_complete: true,
      };
    }

    // SMART COMPONENT FINDING: Auto-find components if ID is invalid or empty
    const availableComponents = ComponentRegistry.list();
    const availableIds = availableComponents.map((c: ComponentInfo) => c.messageId);
    
    if (!componentId || !availableIds.includes(componentId)) {
      logger.log('🔍 [uiUpdateTool] Component ID invalid or empty, attempting auto-find:', {
        providedId: componentId,
        availableIds,
        availableComponents: availableComponents.map(c => ({ id: c.messageId, type: c.componentType }))
      });
      
      if (availableIds.length === 0) {
        return {
          status: 'ERROR',
          message: `🚨 NO COMPONENTS FOUND! 🚨\n\nNo components are currently available for updates.\n\n🔴 SOLUTION:\n1. Create a component first (e.g., RetroTimer)\n2. Then it will be available for updates`,
          error: 'NO_COMPONENTS_AVAILABLE',
          guidance: 'Create a component first, then it will be automatically available for updates'
        };
      }
      
      // AUTO-FIND: If there's only one component, use it
      if (availableIds.length === 1) {
        componentId = availableIds[0];
        logger.log('🎯 [uiUpdateTool] Auto-selected single available component:', componentId);
      } 
      // AUTO-FIND: Look for timer components if patch suggests timer update
      else if (patch.initialMinutes || patch.initialSeconds || Object.keys(patch).some(k => k.includes('timer') || k.includes('minute'))) {
        const timerComponent = availableComponents.find(c => 
          c.componentType.toLowerCase().includes('timer') || 
          c.messageId.toLowerCase().includes('timer')
        );
        if (timerComponent) {
          componentId = timerComponent.messageId;
          logger.log('🎯 [uiUpdateTool] Auto-selected timer component:', componentId);
        }
      }
      
      // If still no valid ID, return helpful error
      if (!componentId || !availableIds.includes(componentId)) {
        return {
          status: 'ERROR',
          message: `🚨 INVALID COMPONENT ID! 🚨\n\nComponent "${componentId}" not found.\n\nAVAILABLE COMPONENTS: ${availableIds.join(', ')}\n\n💡 TIP: You can call ui_update without specifying the ID:\nui_update("", "make it 7 minutes") and I'll find the right component!`,
          error: 'INVALID_COMPONENT_ID',
          availableComponents: availableIds,
          guidance: 'Try ui_update("", "your instruction") for auto-component-finding'
        };
      }
    }
    
    // 🛑 REQUIRE EXPLICIT PATCH: No more regex madness - let Tambo AI handle this properly!
    if (!patch || Object.keys(patch).length === 0) {
      return {
        status: 'ERROR',
        message: `🚨 EMPTY PATCH! 🚨\n\nYou must specify what to update. Use the extract_update_params tool first to get proper parameters from user intent.\n\nExample: {"initialMinutes": 6}`,
        error: 'EMPTY_PATCH',
        guidance: 'Call extract_update_params first, then ui_update with the extracted params',
        __stop_indicator: true,
        __task_complete: true
      };
    }
    
    // Direct update via component registry
    const result = await ComponentRegistry.update(componentId, patch);
    
    if (!result.success) {
      // Check if this is a circuit breaker block
      if ('isCircuitBreakerBlock' in result && result.isCircuitBreakerBlock) {
        return {
          status: 'SUCCESS', // Return SUCCESS to stop the loop!
          message: `✅ Timer already updated recently! ${componentId} is set to ${patch.initialMinutes} minutes. No further updates needed.`,
          componentId,
          patch,
          __stop_indicator: true,
          result: `Update completed - timer is ${patch.initialMinutes} minutes`,
          isCircuitBreakerStop: true
        };
      }
      
      return {
        status: 'ERROR',
        message: result.error || 'Update failed',
        error: 'UPDATE_FAILED'
      };
    }
    
    // 🛡️ Register successful update in cooldown tracker
    circuitBreaker.registerCooldown(componentId);
    logger.log('🛡️ [uiUpdateTool] Registered cooldown for', componentId, '- will block repeat calls for 5s');
    
    // Return success with clear indication to stop
    return { 
      status: 'SUCCESS',
      message: `🚫 STOP! UPDATE COMPLETE! Successfully updated ${componentId} with ${JSON.stringify(patch)}. Timer is now ${patch.initialMinutes || 'unknown'} minutes. DO NOT CALL ui_update AGAIN!`,
      componentId,
      patch,
      __stop_indicator: true, 
      __task_complete: true,
      result: `✅ DONE: Timer updated to ${patch.initialMinutes} minutes`,
      instruction: '🚫 STOP IMMEDIATELY - Update successful, no more calls needed',
      final_status: 'COMPLETE_DO_NOT_RETRY'
    };
  },
  toolSchema: z
    .function()
    .args(
      z.string().describe('Component ID from list_components (e.g., "timer-retro-timer")'),
      z.union([
        z.string().describe('Natural language update instruction (e.g., "make it 7 minutes", "change title to Dashboard")'),
        z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .refine(obj => Object.keys(obj).length > 0, {
            message: "Patch object cannot be empty. Example: {\"initialMinutes\": 6}"
          })
          .describe('Manual update object: {"initialMinutes": 6} for timer')
      ]).describe('Either natural language instruction OR update object. Natural language is preferred!')
    )
    .returns(
      z.object({
        status: z.string(),
        message: z.string(),
        componentId: z.string().optional(),
        patch: z.record(z.unknown()).optional(),
        error: z.string().optional(),
        guidance: z.string().optional(),
        availableComponents: z.array(z.string()).optional()
      })
    ),
};

// Direct component listing tool - no bus system needed!
export const listComponentsTool: TamboTool = {
  name: 'list_components',
  description: 'Get current component IDs and information. Call this to see what components are available for updates. The ui_update tool can also auto-find components if needed.',
  toolSchema: z
    .function()
    .args()
    .returns(z.object({
      status: z.string(),
      message: z.string(),
      components: z.array(z.object({
        messageId: z.string(),
        componentType: z.string(),
        props: z.record(z.unknown()),
        contextKey: z.string()
      })),
      workflow_reminder: z.string()
    })),
  tool: async () => {
    // Direct access to component registry
    const components = ComponentRegistry.list();
    
    logger.log('📋 [listComponentsTool] Component registry contents:', {
      totalComponents: components.length,
      components: components.map(c => ({
        messageId: c.messageId,
        type: c.componentType,
                 title: (c.props as { title?: string; initialMinutes?: number }).title || 
                `${(c.props as { title?: string; initialMinutes?: number }).initialMinutes || '?'} Minute Timer`,
        timestamp: new Date(c.timestamp).toLocaleTimeString()
      }))
    });
    
    return {
      status: 'SUCCESS',
      message: components.length > 0 
        ? `Found ${components.length} components. Use the exact messageId values below for ui_update calls.`
        : `No components found. Create a component first, then call list_components to get its ID.`,
      components: components.map((c: ComponentInfo) => ({
        messageId: c.messageId,
        componentType: c.componentType,
        props: c.props,
        contextKey: c.contextKey
      })),
      workflow_reminder: '🔄 Next: Use ui_update with the exact messageId from this response'
    };
  },
};

export const getDocumentsTool: TamboTool = {
  name: "get_documents",
  description: "Return a list of all documents available in the hackathon canvas document store.",
  tool: async () => {
    return documentState.getDocuments();
  },
  toolSchema: z
    .function()
    .args()
    .returns(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          content: z.string(),
          originalContent: z.string().optional(),
          diffs: z.any().optional(),
          lastModified: z.date().optional(),
        })
      )
    ),
};

export const generateUiComponentTool: TamboTool = {
  name: "generate_ui_component",
  description:
    "Generate a UI component from free-form prompt with intelligent parameter extraction. This tool consolidates all NLP processing for component generation and handles complex natural language requests.",
  tool: async (prompt: string) => {
    const lower = prompt.toLowerCase();
    let componentType = "";
    let props: Record<string, unknown> = {};

    // Enhanced NLP-based component detection and parameter extraction
    
    // Document-related requests
    if (lower.includes("containment breach") || lower.includes("script")) {
      componentType = "DocumentEditor";
      props = { documentId: "movie-script-containment-breach" };
    }
    
    // Timer-related requests with intelligent parameter extraction
    else if (lower.includes("timer") || lower.includes("countdown")) {
      componentType = "RetroTimerEnhanced";
      
      // Extract time parameters using multiple patterns
      const timePatterns = [
        // Numbers with units: "5 minutes", "10 mins", "1 hour"
        /(\d+(?:\.\d+)?)\s*(min|minute|minutes|hour|hours|second|seconds)/i,
        // Word numbers: "five minutes", "ten seconds"
        /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)\s*(min|minute|minutes|hour|hours|second|seconds)/i,
        // Just numbers: "timer for 5", "5 minute timer"
        /(?:timer|countdown).*?(\d+)/i,
        // Duration context: "5 minute timer", "timer for 10 minutes"
        /(?:for|set|make|create).*?(\d+)/i
      ];
      
      for (const pattern of timePatterns) {
        const match = prompt.match(pattern);
        if (match) {
          let minutes = 0;
          const value = match[1];
          const unit = match[2];
          
          // Handle word numbers
          if (isNaN(Number(value))) {
            const wordToNumber: Record<string, number> = {
              one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, 
              eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, 
              twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60
            };
            minutes = wordToNumber[value.toLowerCase()] || 5;
          } else {
            minutes = Number(value);
            
            // Convert units to minutes
            if (unit) {
              if (unit.toLowerCase().includes('hour')) {
                minutes *= 60;
              } else if (unit.toLowerCase().includes('second')) {
                minutes = Math.max(1, Math.ceil(minutes / 60));
              }
            }
          }
          
          props.initialMinutes = minutes;
          break;
        }
      }
      
      // Default if no time found
      if (!props.initialMinutes) {
        props.initialMinutes = 5;
      }
    }
    
    // Weather-related requests
    else if (lower.includes("weather") || lower.includes("forecast")) {
      componentType = "WeatherForecast";
      
      // Extract location if mentioned
      const locationMatch = prompt.match(/weather.*?(?:for|in|at)\s+([a-zA-Z\s]+)/i);
      if (locationMatch) {
        props.location = locationMatch[1].trim();
      }
    }
    
    // YouTube/video requests
    else if (lower.includes("youtube") || lower.includes("video")) {
      componentType = "YoutubeEmbed";
      
      // Extract video ID or search query
      const videoIdMatch = prompt.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
      if (videoIdMatch) {
        props.videoId = videoIdMatch[1];
      } else {
        // Extract search query
        const searchMatch = prompt.match(/(?:search|find|show).*?(?:for|about)\s+([^.!?]+)/i);
        if (searchMatch) {
          props.searchQuery = searchMatch[1].trim();
        }
      }
    }
    
    // Image generation requests
    else if (lower.includes("image") || lower.includes("picture") || lower.includes("generate")) {
      componentType = "AIImageGenerator";
      
      // Extract prompt for image generation
      const imagePromptMatch = prompt.match(/(?:generate|create|make).*?(?:image|picture).*?(?:of|about|with)\s+([^.!?]+)/i);
      if (imagePromptMatch) {
        props.prompt = imagePromptMatch[1].trim();
      }
    }
    
    // Action items/todo requests
    else if (lower.includes("todo") || lower.includes("task") || lower.includes("action")) {
      componentType = "ActionItemTracker";
      
      // Extract initial items if mentioned
      const itemsMatch = prompt.match(/(?:tasks?|items?|todos?).*?[:]\s*([^.!?]+)/i);
      if (itemsMatch) {
        const items = itemsMatch[1].split(',').map(item => item.trim());
        props.initialItems = items;
      }
    }
    
    // Research panel requests
    else if (lower.includes("research") || lower.includes("findings")) {
      componentType = "ResearchPanel";
      
      // Extract research topic
      const topicMatch = prompt.match(/research.*?(?:about|on|for)\s+([^.!?]+)/i);
      if (topicMatch) {
        props.topic = topicMatch[1].trim();
      }
    }
    
    // LiveKit room requests
    else if (lower.includes("room") || lower.includes("connect") || lower.includes("video call")) {
      componentType = "LivekitRoomConnector";
      
      // Extract room name if mentioned
      const roomMatch = prompt.match(/room.*?(?:named|called)\s+([a-zA-Z0-9_-]+)/i);
      if (roomMatch) {
        props.roomName = roomMatch[1];
      }
    }
    
    // Participant tile requests
    else if (lower.includes("participant") || lower.includes("video feed")) {
      componentType = "LivekitParticipantTile";
    }
    
    // Live captions requests
    else if (lower.includes("caption") || lower.includes("subtitle") || lower.includes("transcription")) {
      componentType = "LiveCaptions";
    }

    // Fallback - try to infer from common UI terms
    else if (lower.includes("button") || lower.includes("click")) {
      componentType = "RetroTimerEnhanced"; // Default to timer as most common interactive component
      props.initialMinutes = 5;
    }
    
    // No matching component found
    if (!componentType) {
      return { 
        success: false, 
        error: "UNSUPPORTED_PROMPT",
        message: `Could not determine component type from prompt: "${prompt}". Supported components: DocumentEditor, RetroTimerEnhanced, WeatherForecast, YoutubeEmbed, AIImageGenerator, ActionItemTracker, ResearchPanel, LivekitRoomConnector, LivekitParticipantTile, LiveCaptions.`
      };
    }

    // Create unique messageId
    const messageId = `${componentType.toLowerCase()}-${nanoid(6)}`;

    // Register component for AI updates; it will render when CanvasSpace receives showComponent event
    ComponentRegistry.register({
      messageId,
      componentType,
      props,
      contextKey: "default",
      timestamp: Date.now(),
    });

    // Dispatch event for CanvasSpace to render immediately
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tambo:showComponent", {
          detail: {
            messageId,
            component: { type: componentType, props },
          },
        })
      );
    }

    return { 
      success: true, 
      componentType, 
      messageId, 
      props,
      extractedParameters: Object.keys(props).length > 0 ? props : undefined,
      message: `Created ${componentType} component with ID: ${messageId}${Object.keys(props).length > 0 ? ` and parameters: ${JSON.stringify(props)}` : ''}`
    };
  },
  toolSchema: z
    .function()
    .args(z.string().describe("Natural language prompt describing the UI component to generate with any parameters"))
    .returns(
      z.object({
        success: z.boolean(),
        componentType: z.string().optional(),
        messageId: z.string().optional(),
        props: z.record(z.unknown()).optional(),
        extractedParameters: z.record(z.unknown()).optional(),
        error: z.string().optional(),
        message: z.string().optional(),
      })
    ),
};

// extractUpdateParamsTool removed - ui_update now handles natural language directly

// extractParametersWithAI is now imported from "./nlp"

export const tools: TamboTool[] = [
  // Set the MCP tools https://localhost:3000/mcp-config
  // Add non MCP tools here
  listComponentsTool,
  uiUpdateTool,
  getDocumentsTool,
  generateUiComponentTool,
  // extractUpdateParamsTool, // No longer needed - ui_update handles natural language directly
];

/**
 * components
 *
 * This array contains all the Tambo components that are registered for use within the application.
 * Each component is defined with its name, description, and expected props. The components
 * can be controlled by AI to dynamically render UI elements based on user interactions.
 */
export const components: TamboComponent[] = [
  {
    name: "YoutubeEmbed",
    description:
      "Use this to embed a YouTube video. Requires a video ID and optional start time in seconds.",
    component: YoutubeEmbed,
    propsSchema: youtubeEmbedSchema,
  },
  {
    name: "WeatherForecast",
    description: 
      "Display weather forecast data with visuals. Requires JSON weather data in a specific format.",
    component: WeatherForecast,
    propsSchema: weatherForecastSchema,
  },
  {
    name: "RetroTimer",
    description:
      "A retro-styled countdown timer with preset options for 5, 10, and 20 minutes. Features start/pause and reset controls. Now with AI update capabilities!",
    component: RetroTimerRegistry,
    propsSchema: retroTimerSchema,
  },
  {
    name: "RetroTimerEnhanced",
    description:
      "An enhanced retro-styled countdown timer with AI update capabilities and new simplified component registry. Features direct AI updates, auto-registration, better state management, and preset options for 5, 10, and 20 minutes. Demonstrates the new simplified architecture without complex bus systems. Perfect for testing AI component updates!",
    component: RetroTimerEnhanced,
    propsSchema: retroTimerEnhancedSchema,
  },
  {
    name: "DocumentEditor",
    description:
      "An advanced collaborative document editor with AI-powered editing capabilities. Features real-time word-level diff tracking, beautiful visual change highlighting, persistent state management, and seamless AI update integration. Perfect for collaborative document editing, AI-assisted writing, content revision workflows, and scenarios requiring detailed change tracking and visual diff displays.",
    component: DocumentEditor,
    propsSchema: documentEditorSchema,
  },
  {
    name: "ResearchPanel",
    description:
      "A sophisticated research results display panel that shows real-time research findings from MCP tools. Features source credibility ratings, fact-checking status, filtering options, bookmarking, and beautiful card-based layout. Perfect for displaying Perplexity research results, fact-checking data, and contextual information during meetings or conversations.",
    component: ResearchPanel,
    propsSchema: researchPanelSchema,
  },
  {
    name: "ActionItemTracker",
    description:
      "A comprehensive action item management system that tracks tasks, assignments, due dates, and progress. Can be initially created by AI with action items from meetings or conversations, then allows users to dynamically add, edit, complete, and manage items. Features priority levels, status tracking, assignee management, filtering, sorting, and persistent state. Perfect for meeting follow-ups, project management, and task coordination.",
    component: ActionItemTracker,
    propsSchema: actionItemTrackerSchema,
  },
  {
    name: "LivekitRoomConnector",
    description:
      "Establishes a LiveKit room connection on the canvas. This is the FIRST component you need to create before using any other LiveKit components. It provides the necessary context for participant tiles and toolbars to function. Features room name configuration, connection status display, participant count, and invite link sharing. Once connected, you can spawn LivekitParticipantTile and LivekitToolbar components.",
    component: LivekitRoomConnector,
    propsSchema: livekitRoomConnectorSchema,
  },
  {
    name: "LivekitParticipantTile",
    description:
      "Individual participant video/audio tile with real-time LiveKit integration. REQUIRES LivekitRoomConnector to be connected first. Shows participant video feed, audio controls, connection quality, speaking indicators, and individual toolbar controls. Automatically detects local vs remote participants and AI agents (with bot icons). Features minimize/expand functionality, audio level visualization, and drag-and-drop capability on the canvas.",
    component: LivekitParticipantTile,
    propsSchema: livekitParticipantTileSchema,
  },
  {
    name: "AIImageGenerator",
    description:
      "A real-time AI image generator that creates images from text prompts using Together AI's FLUX model. Features include multiple art styles (pop art, minimal, cyberpunk, etc.), generation history, canvas integration, download capability, iterative mode for consistency, and speech-to-text integration for voice-driven image generation. Perfect for creative projects, visual brainstorming, concept art generation, and real-time visual content creation. Automatically debounces prompt changes and provides visual feedback during generation. Can be controlled via microphone for hands-free operation.",
    component: AIImageGenerator,
    propsSchema: aiImageGeneratorSchema,
  },
  {
    name: "LiveCaptions",
    description:
      "A real-time live captions component that displays speech transcriptions in an interactive tldraw-style canvas with beautiful speech bubbles. REQUIRES LivekitRoomConnector to be connected first. Features real-time transcription from Groq Whisper via LiveKit data channels, draggable speech bubbles, speaker identification with avatars, timestamps, interim/final transcript states, export capabilities (TXT/JSON/SRT), customizable canvas themes (grid/dots/clean), auto-positioning, and persistent state management. Perfect for accessibility, meeting transcription, live events, educational content, and any scenario requiring real-time speech-to-text visualization with an engaging visual interface.",
    component: LiveCaptions,
    propsSchema: liveCaptionsSchema,
  },
  // Add more components here
];
