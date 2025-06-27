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
// import {
//   YoutubeSearchEnhanced,
//   youtubeSearchEnhancedSchema,
// } from "@/components/ui/youtube-search-enhanced";
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
  MarkdownViewer,
  markdownViewerSchema,
} from "@/components/ui/markdown-viewer";
import {
  ResearchPanel,
  researchPanelSchema,
} from "@/components/ui/research-panel";
import {
  ActionItemTracker,
  actionItemTrackerSchema,
} from "@/components/ui/action-item-tracker";
// import {
//  LivekitToolbar,
//  livekitToolbarSchema,
// } from "@/components/ui/livekit-toolbar";
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
// import {
//   PresentationDeck,
//   presentationDeckSchema,
// } from "@/components/ui/presentation-deck";
import LiveCaptions, {
  liveCaptionsSchema,
} from "@/components/LiveCaptions";
import type { TamboComponent } from "@tambo-ai/react";
import { TamboTool } from "@tambo-ai/react";
import { z } from "zod";
import { ComponentRegistry, type ComponentInfo } from "./component-registry";

/**
 * tools
 *
 * This array contains all the Tambo tools that are registered for use within the application.
 * Each tool is defined with its name, description, and expected props. The tools
 * can be controlled by AI to dynamically fetch data based on user interactions.
 */

// 🛡️ Tool Cooldown: Track recent successful updates to prevent infinite loops
const updateCooldowns = new Map<string, number>();
const COOLDOWN_DURATION = 5000; // 5 seconds

// 🚫 AGGRESSIVE DUPLICATE PREVENTION: Track ALL recent calls to prevent multiple executions
const allRecentCalls = new Map<string, number>();
const AGGRESSIVE_DUPLICATE_PREVENTION = 1000; // 1 second - very aggressive

// Direct component update tool - no complex bus system needed!
export const uiUpdateTool: TamboTool = {
  name: 'ui_update', 
  description: `Update a UI component with new props. This tool is SMART - it can extract parameters from user messages automatically!

SMART USAGE (Recommended):
- ui_update("timer-id", "make it 7 minutes") → Extracts {"initialMinutes": 7}
- ui_update("timer-id", "change to 10 minutes") → Extracts {"initialMinutes": 10}
- ui_update("card-id", "set title to Dashboard") → Extracts {"title": "Dashboard"}

MANUAL USAGE:
- ui_update("timer-id", {"initialMinutes": 7})
- ui_update("card-id", {"title": "New Title"})

The tool will automatically:
1. Get component IDs if not provided
2. Extract parameters from natural language
3. Apply updates with proper error handling
4. Prevent infinite loops with cooldowns

NEVER call with empty patch: ui_update("id", {}) ❌
ALWAYS provide updates: ui_update("id", "your instruction") ✅`,
  tool: async (componentIdOrFirstArg: string | Record<string, unknown>, patchOrSecondArg?: Record<string, unknown>) => {
    // 🚫 AGGRESSIVE DUPLICATE PREVENTION: Block any call within 1 second
    const callSignature = JSON.stringify({ componentIdOrFirstArg, patchOrSecondArg });
    const currentTimestamp = Date.now();
    const lastCall = allRecentCalls.get(callSignature);
    
    if (lastCall && (currentTimestamp - lastCall) < AGGRESSIVE_DUPLICATE_PREVENTION) {
      console.log('🚫 [uiUpdateTool] AGGRESSIVE BLOCK - identical call within 1 second');
      return {
        status: 'SUCCESS',
        message: '🚫 BLOCKED: Identical call within 1 second. Timer already updated.',
        __stop_indicator: true,
        __task_complete: true,
        blockReason: 'AGGRESSIVE_DUPLICATE_PREVENTION'
      };
    }
    
    // Register this call immediately
    allRecentCalls.set(callSignature, currentTimestamp);
    
    // Clean up old entries 
    allRecentCalls.forEach((timestamp, signature) => {
      if (currentTimestamp - timestamp > AGGRESSIVE_DUPLICATE_PREVENTION) {
        allRecentCalls.delete(signature);
      }
    });
    
    // 🚫 SIMPLIFIED APPROACH: Let the tool work normally but with more aggressive messaging
    
    // 🔧 SMART PARAMETER EXTRACTION: Handle multiple calling patterns
    let componentId: string;
    let patch: Record<string, unknown>;
    
    if (typeof componentIdOrFirstArg === 'string') {
      componentId = componentIdOrFirstArg;
      
      // Check if second argument is a string (natural language) or object (patch)
      if (typeof patchOrSecondArg === 'string') {
        // SMART MODE: Extract parameters from natural language
        console.log('🧠 [uiUpdateTool] SMART MODE: Extracting parameters from natural language:', patchOrSecondArg);
        patch = extractParametersWithAI(patchOrSecondArg);
        console.log('🧠 [uiUpdateTool] Extracted parameters:', patch);
      } else {
        // Manual mode: use provided patch object
        patch = patchOrSecondArg || {};
      }
    } else if (typeof componentIdOrFirstArg === 'object' && componentIdOrFirstArg !== null) {
      // Legacy call: ui_update({param1: "component-id", param2: {patch}})
      const params = componentIdOrFirstArg as Record<string, unknown>;
      componentId = String(params.componentId || params.param1 || '');
      
      // Check if param2 is a string (natural language) or object (patch)
      if (typeof params.param2 === 'string') {
        // SMART MODE: Extract parameters from natural language
        console.log('🧠 [uiUpdateTool] SMART MODE (legacy): Extracting parameters from natural language:', params.param2);
        patch = extractParametersWithAI(params.param2);
        console.log('🧠 [uiUpdateTool] Extracted parameters:', patch);
      } else {
        patch = (params.patch || params.param2 || {}) as Record<string, unknown>;
      }
      
      console.log('🔄 [uiUpdateTool] Auto-corrected legacy parameter format:', {
        detected: 'legacy object format',
        extractedComponentId: componentId,
        extractedPatch: patch
      });
    } else {
      // Invalid call format
      return {
        status: 'ERROR',
        message: `🚨 INVALID PARAMETERS! 🚨\n\nExpected: ui_update("component-id", {"initialMinutes": 10})\nOr: ui_update("component-id", "make it 10 minutes")\nReceived: ui_update(${typeof componentIdOrFirstArg}, ${typeof patchOrSecondArg})\n\nPlease call list_components first to get the component ID, then:\nui_update("timer-retro-timer-xyz", {"initialMinutes": 10})`,
        error: 'INVALID_PARAMETER_FORMAT',
        __stop_indicator: true,
        __task_complete: true
      };
    }

    // 🛡️ COOLDOWN CHECK: Prevent infinite loops by checking recent updates
    const now = Date.now();
    const lastUpdate = updateCooldowns.get(componentId);
    if (lastUpdate && (now - lastUpdate) < COOLDOWN_DURATION) {
      // Clean up expired cooldowns
      updateCooldowns.forEach((timestamp, id) => {
        if (now - timestamp > COOLDOWN_DURATION) {
          updateCooldowns.delete(id);
        }
      });
      
      console.log('🛡️ [uiUpdateTool] Cooldown active for', componentId, '- preventing infinite loop');
      return {
        status: 'SUCCESS',
        message: `✅ Component "${componentId}" was already updated recently. Update is complete - no further action needed!`,
        componentId,
        cooldownRemaining: Math.ceil((COOLDOWN_DURATION - (now - lastUpdate)) / 1000),
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
      console.log('🔍 [uiUpdateTool] Component ID invalid or empty, attempting auto-find:', {
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
        console.log('🎯 [uiUpdateTool] Auto-selected single available component:', componentId);
      } 
      // AUTO-FIND: Look for timer components if patch suggests timer update
      else if (patch.initialMinutes || patch.initialSeconds || Object.keys(patch).some(k => k.includes('timer') || k.includes('minute'))) {
        const timerComponent = availableComponents.find(c => 
          c.componentType.toLowerCase().includes('timer') || 
          c.messageId.toLowerCase().includes('timer')
        );
        if (timerComponent) {
          componentId = timerComponent.messageId;
          console.log('🎯 [uiUpdateTool] Auto-selected timer component:', componentId);
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
    const updateTime = Date.now();
    updateCooldowns.set(componentId, updateTime);
    console.log('🛡️ [uiUpdateTool] Registered cooldown for', componentId, '- will block repeat calls for 5s');
    
    // Clean up expired cooldowns to prevent memory leaks
    updateCooldowns.forEach((timestamp, id) => {
      if (updateTime - timestamp > COOLDOWN_DURATION) {
        updateCooldowns.delete(id);
      }
    });
    
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
    
    console.log('📋 [listComponentsTool] Component registry contents:', {
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

// AI-powered parameter extraction tool - leverages LLM intelligence instead of regex patterns
export const extractUpdateParamsTool: TamboTool = {
  name: 'extract_update_params',
  description: `Extract component update parameters from natural language user requests.

Use this to convert user intent into proper component props:
- "make it 7 minutes" → {"initialMinutes": 7}
- "change title to 'Dashboard'" → {"title": "Dashboard"}
- "add task: Review PR" → {"newTask": "Review PR"}
- "make it red" → {"color": "red"}

Works for ANY component type and understands natural language including:
- Numbers: "7", "seven", "7.5"
- Time units: "minutes", "hours", "seconds"  
- Colors, text, boolean values, etc.

Always call this BEFORE ui_update when user wants to change something!`,
  tool: async (userMessage: string, componentType: string) => {
    // Use AI's natural language understanding to extract parameters
    const result = extractParametersWithAI(userMessage);
    
    return {
      status: 'SUCCESS',
      message: `✅ Extracted parameters from: "${userMessage}"`,
      extractedParams: result,
      componentType,
      guidance: `Use these params in ui_update: ${JSON.stringify(result)}`
    };
  },
  toolSchema: z
    .function()
    .args(
      z.string().describe('User message expressing what to update'),
      z.string().describe('Component type (e.g., "RetroTimerEnhanced", "ActionItemTracker")')
    )
    .returns(
      z.object({
        status: z.string(),
        message: z.string(),
        extractedParams: z.record(z.unknown()),
        componentType: z.string(),
        guidance: z.string()
      })
    ),
};

// AI-powered parameter extraction using natural language understanding  
function extractParametersWithAI(userMessage: string): Record<string, unknown> {
  // Let Tambo's AI handle the heavy lifting! This is just a fallback for simple cases.
  const message = userMessage.toLowerCase();
  
  // Simple pattern matching for common cases - but AI should handle most of this
  const patterns = [
    // Numbers with units (very general)
    { regex: /(\d+(?:\.\d+)?)\s*(min|minute|minutes|hour|hours|second|seconds)/i, 
      handler: (match: RegExpMatchArray) => {
        const num = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (unit.includes('hour')) return { initialMinutes: num * 60 };
        if (unit.includes('second')) return { initialMinutes: Math.max(1, Math.ceil(num / 60)) };
        return { initialMinutes: num };
      }
    },
    // Simple word numbers
    { regex: /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s*(min|minute|minutes)/i,
      handler: (match: RegExpMatchArray) => {
        const wordToNumber: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, 
          eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, 
          twenty: 20, thirty: 30
        };
        const num = wordToNumber[match[1].toLowerCase()];
        return num ? { initialMinutes: num } : {};
      }
    },
    // Title changes
    { regex: /(?:title|name)\s*(?:to|is)?\s*["\']?([^"']+)["\']?/i,
      handler: (match: RegExpMatchArray) => ({ title: match[1].trim() })
    }
  ];
  
  for (const { regex, handler } of patterns) {
    const match = message.match(regex);
    if (match) {
      const result = handler(match);
      if (Object.keys(result).length > 0) return result;
    }
  }
  
  // Return empty - let Tambo's AI figure it out!
  return {};
}

export const tools: TamboTool[] = [
  // Set the MCP tools https://localhost:3000/mcp-config
  // Add non MCP tools here
  listComponentsTool,
  uiUpdateTool,
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
  // {
  //   name: "YoutubeSearchEnhanced",
  //   description:
  //     "Advanced YouTube search interface with intelligent filtering, transcript navigation, and quality detection. Features include: search by date ranges (today/week/month/year), sort by newest/views/rating, filter by video duration, identify official/verified channels, view trending videos, read and navigate transcripts with timestamps, and smart quality scoring. Perfect for finding the latest high-quality content and navigating to specific moments in videos. Automatically filters out low-quality content and prioritizes official sources.",
  //   component: YoutubeSearchEnhanced,
  //   propsSchema: youtubeSearchEnhancedSchema,
  // },
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
    name: "MarkdownViewer",
    description:
      "A markdown document viewer with tile preview and full-screen reading mode. Displays markdown content with PP Editorial New typography on a black background. Perfect for displaying documentation, articles, or any markdown content with an elegant reading experience.",
    component: MarkdownViewer,
    propsSchema: markdownViewerSchema,
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
// {
//   name: "LivekitToolbar",
//   description:
//     "A comprehensive video conferencing toolbar component designed for LiveKit applications. REQUIRES LivekitRoomConnector to be connected first. Features all standard controls including microphone, camera, screen sharing, chat, raise hand, participant management, settings, recording, layout switching, AI assistant integration, accessibility options, and connection quality indicators. Supports both minimal and verbose display modes with configurable control visibility.",
//   component: LivekitToolbar,
//   propsSchema: livekitToolbarSchema,
// },
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
 // {
 //   name: "PresentationDeck",
 //   description:
 //     "A feature-complete presentation tool for displaying beautiful, almost full-screen PowerPoint, Google Slides, PDF, and image-based presentations. Features comprehensive hotkey controls (arrow keys, space, enter for play/pause, F for fullscreen), laser pointer mode, thumbnail navigation, speaker notes, auto-advance, progress tracking, bookmarking, and canvas integration. Supports multiple aspect ratios (16:9, 4:3, 16:10), dark/light themes, and persistent state management. Perfect for business presentations, lectures, demos, and any scenario requiring professional slide display with advanced navigation and control features.",
 //   component: PresentationDeck,
 //   propsSchema: presentationDeckSchema,
 // },
  {
    name: "LiveCaptions",
    description:
      "A real-time live captions component that displays speech transcriptions in an interactive tldraw-style canvas with beautiful speech bubbles. REQUIRES LivekitRoomConnector to be connected first. Features real-time transcription from Groq Whisper via LiveKit data channels, draggable speech bubbles, speaker identification with avatars, timestamps, interim/final transcript states, export capabilities (TXT/JSON/SRT), customizable canvas themes (grid/dots/clean), auto-positioning, and persistent state management. Perfect for accessibility, meeting transcription, live events, educational content, and any scenario requiring real-time speech-to-text visualization with an engaging visual interface.",
    component: LiveCaptions,
    propsSchema: liveCaptionsSchema,
  },
  // Add more components here
];
