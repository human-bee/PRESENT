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
 * Helper function to get available update properties for different component types
 */
function getAvailableUpdatesForComponent(componentType: string): string[] {
  const type = componentType.toLowerCase();
  
  if (type.includes('timer')) {
    return ['initialMinutes', 'initialSeconds', 'title', 'autoStart'];
  } else if (type.includes('participant')) {
    return ['participantIdentity', 'displayName', 'enableVideo', 'enableAudio'];
  } else if (type.includes('search')) {
    return ['query', 'maxResults', 'sortBy'];
  } else if (type.includes('chart') || type.includes('graph')) {
    return ['data', 'chartType', 'title', 'colorScheme'];
  } else {
    return ['title', 'description', 'isVisible', 'size'];
  }
}

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

// Direct component update tool - no complex bus system needed!
export const uiUpdateTool: TamboTool = {
  name: 'ui_update',
  description: `🚨 CRITICAL: ALWAYS INCLUDE THE PATCH! 🚨

Step 1: Call list_components FIRST
Step 2: Use the EXACT messageId from response  
Step 3: Include SPECIFIC patch values!

FOR TIMER UPDATES - MATCH USER'S EXACT REQUEST:
- User: "6 minutes" → ui_update("timer-id", {"initialMinutes": 6})
- User: "10 minutes" → ui_update("timer-id", {"initialMinutes": 10})
- User: "15 minutes" → ui_update("timer-id", {"initialMinutes": 15})

❌ NEVER: ui_update("timer-id", {})
✅ ALWAYS: ui_update("timer-id", {"initialMinutes": 6})

IMPORTANT: Extract the exact number the user said!
- "make it 6 minutes" = 6
- "change to 7 minutes" = 7  
- "update to 8 minutes" = 8

The patch MUST contain the specific update!

🛑 STOP AFTER SUCCESS! When you get "TASK COMPLETE" - DO NOT call ui_update again!`,
  tool: async (componentIdOrFirstArg: string | Record<string, unknown>, patchOrSecondArg?: Record<string, unknown>) => {
    // 🔧 SMART PARAMETER DETECTION: Handle both proper and legacy calling patterns
    let componentId: string;
    let patch: Record<string, unknown>;
    
    if (typeof componentIdOrFirstArg === 'string') {
      // Proper call: ui_update("component-id", {patch})
      componentId = componentIdOrFirstArg;
      patch = patchOrSecondArg || {};
    } else if (typeof componentIdOrFirstArg === 'object' && componentIdOrFirstArg !== null) {
      // Legacy call: ui_update({param1: "component-id", param2: {patch}})
      const params = componentIdOrFirstArg as Record<string, unknown>;
      componentId = String(params.componentId || params.param1 || '');
      patch = (params.patch || params.param2 || {}) as Record<string, unknown>;
      
      // Special: Check if there's a userContext parameter for better inference
      if (params.userContext && typeof params.userContext === 'string') {
        (window as { lastUserMessage?: string }).lastUserMessage = params.userContext;
        console.log('💬 [uiUpdateTool] Received user context:', params.userContext);
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
        message: `🚨 INVALID PARAMETERS! 🚨

Expected: ui_update("component-id", {"initialMinutes": 10})
Received: ui_update(${typeof componentIdOrFirstArg}, ${typeof patchOrSecondArg})

Please call list_components first to get the component ID, then:
ui_update("timer-retro-timer-xyz", {"initialMinutes": 10})`,
        error: 'INVALID_PARAMETER_FORMAT'
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
        status: 'ALREADY_COMPLETE',
        message: `✅ Component "${componentId}" was already updated recently. Update is complete - no further action needed!`,
        componentId,
        cooldownRemaining: Math.ceil((COOLDOWN_DURATION - (now - lastUpdate)) / 1000),
        guidance: 'Task completed successfully. Please wait or work on other tasks.'
      };
    }

    // Validate componentId exists in registry
    const availableComponents = ComponentRegistry.list();
    const availableIds = availableComponents.map((c: ComponentInfo) => c.messageId);
    
    if (!componentId || !availableIds.includes(componentId)) {
      const errorMsg = availableIds.length > 0 
        ? `🚨 INVALID COMPONENT ID! 🚨

Component "${componentId}" not found. 

AVAILABLE COMPONENTS: ${availableIds.join(', ')}

🔴 YOU MUST:
1. Call list_components FIRST
2. Use the exact messageId from the response
3. Never use old/cached IDs!

Current available IDs: ${availableIds.join(', ')}`
        : `🚨 NO COMPONENTS FOUND! 🚨

Component "${componentId}" not found because no components are currently available.

🔴 SOLUTION:
1. Create a component first (e.g., RetroTimer)
2. Then call list_components to get its ID
3. Then call ui_update with that ID`;
      
      return {
        status: 'ERROR',
        message: errorMsg,
        error: 'INVALID_COMPONENT_ID',
        availableComponents: availableIds,
        guidance: 'Call list_components first to get valid component IDs'
      };
    }
    
    // 🧠 INTELLIGENT PATCH INFERENCE: Try to understand what the user wanted
    if (!patch || Object.keys(patch).length === 0) {
      console.log('🔍 [uiUpdateTool] Empty patch detected, attempting intelligent inference...');
      
      // Get component info to understand what we're working with
      const component = availableComponents.find(c => c.messageId === componentId);
      if (component) {
        console.log('📊 [uiUpdateTool] Component found:', {
          type: component.componentType,
          currentProps: component.props
        });
        
        // Try to infer patch based on component type and recent context
        let inferredPatch: Record<string, unknown> = {};
        
                 if (component.componentType.toLowerCase().includes('timer')) {
           // Enhanced timer duration inference - check multiple sources
           console.log('🔍 [uiUpdateTool] Looking for timer duration in context...');
           
           // Source 1: Check document title and any global context
           let contextString = typeof window !== 'undefined' ? 
             (document.title + ' ' + ((window as { lastUserMessage?: string }).lastUserMessage || '')) : '';
           
           // Source 1.5: Try to get the most recent user message from Tambo context
           try {
             // Look for recent user messages in the DOM or other accessible context
             const messageElements = document.querySelectorAll('[data-message-type="user"]');
             if (messageElements.length > 0) {
               const lastUserElement = messageElements[messageElements.length - 1];
               const lastUserText = lastUserElement.textContent || '';
               contextString += ' ' + lastUserText;
               console.log('📝 [uiUpdateTool] Found recent user message:', lastUserText);
             }
             
             // Also check for any visible text that might contain the user's request
             const visibleText = document.body.innerText || '';
             if (visibleText.includes('6 minutes')) {
               contextString += ' 6 minutes';
               console.log('📝 [uiUpdateTool] Found "6 minutes" in page text');
             }
           } catch {
             // Ignore errors accessing DOM
           }
           
           // Source 2: More comprehensive duration patterns
           const durationPatterns = [
             /(\d+)\s*(min|minute|minutes)/gi,
             /(\d+)\s*(hour|hours)/gi,
             /to\s+(\d+)/gi, // "to 6", "to 10"
             /make.*?(\d+)/gi, // "make it 6"
             /update.*?(\d+)/gi, // "update to 6"
             /change.*?(\d+)/gi, // "change to 6"
           ];
           
           let foundDuration: number | null = null;
           let foundUnit = 'minutes';
           
           // Debug: Show what we're searching in
           console.log('🔎 [uiUpdateTool] Searching for duration in:', contextString.substring(0, 200) + '...');
           
           // Try each pattern
           for (const pattern of durationPatterns) {
             const matches = Array.from(contextString.matchAll(pattern));
             console.log(`🔍 [uiUpdateTool] Pattern ${pattern} found ${matches.length} matches`);
             
             for (const match of matches) {
               const num = parseInt(match[1]);
               console.log(`🔢 [uiUpdateTool] Extracted number: ${num} from match: "${match[0]}"`);
               
               if (!isNaN(num) && num > 0 && num <= 120) { // Reasonable timer range
                 foundDuration = num;
                 foundUnit = match[2]?.toLowerCase() || 'minutes';
                 console.log(`✨ [uiUpdateTool] Found duration: ${num} ${foundUnit} via pattern: ${pattern}`);
                 break;
               }
             }
             if (foundDuration) break;
           }
           
           // Apply the found duration
           if (foundDuration) {
             if (foundUnit.startsWith('hour')) {
               inferredPatch = { initialMinutes: foundDuration * 60 };
               console.log(`✨ [uiUpdateTool] Inferred: ${foundDuration} hours = ${foundDuration * 60} minutes`);
             } else {
               inferredPatch = { initialMinutes: foundDuration };
               console.log(`✨ [uiUpdateTool] Inferred: ${foundDuration} minutes`);
             }
           } else {
             // Fallback: Common timer durations
             const currentMinutes = component.props.initialMinutes;
             console.log(`🤔 [uiUpdateTool] No duration found. Current: ${currentMinutes} minutes`);
             
             // If current is 5, try 10. If current is 10, try 5. Otherwise default to 10.
             if (currentMinutes === 5) {
               inferredPatch = { initialMinutes: 10 };
               console.log('✨ [uiUpdateTool] Smart fallback: 5→10 minutes');
             } else if (currentMinutes === 10) {
               inferredPatch = { initialMinutes: 5 };
               console.log('✨ [uiUpdateTool] Smart fallback: 10→5 minutes');
             } else {
               inferredPatch = { initialMinutes: 10 };
               console.log('✨ [uiUpdateTool] Smart fallback: defaulting to 10 minutes');
             }
           }
         }
        
        // If we successfully inferred a patch, use it!
        if (Object.keys(inferredPatch).length > 0) {
          patch = inferredPatch;
          console.log('🎯 [uiUpdateTool] Applied inferred patch:', patch);
        } else {
          // Still couldn't infer - provide helpful error
          return {
            status: 'ERROR',
            message: `🚨 EMPTY PATCH ERROR! 🚨

You called ui_update with an empty patch for component: ${component.componentType}

🔴 REQUIRED: You MUST specify what to update!

For ${component.componentType} components, try:
${component.componentType.toLowerCase().includes('timer') ? 
  '{"initialMinutes": 10}  ← To change to 10 minutes\n{"initialMinutes": 15}  ← To change to 15 minutes' :
  '{"title": "New Title"}  ← To change the title\n{"query": "new search"}  ← To update search query'
}

Current component props: ${JSON.stringify(component.props, null, 2)}

❌ DO NOT send empty patches: {}
✅ DO send specific updates with the exact property names above`,
            error: 'EMPTY_PATCH',
            guidance: `Specify the exact properties to update for ${component.componentType}`,
            componentInfo: {
              type: component.componentType,
              currentProps: component.props,
              availableUpdates: getAvailableUpdatesForComponent(component.componentType)
            }
          };
        }
      } else {
        return {
          status: 'ERROR',
          message: `🚨 EMPTY PATCH ERROR! 🚨

You called ui_update with an empty patch {}. 

🔴 REQUIRED: You MUST specify what to update!

❌ DO NOT send empty patches: {}
✅ DO send specific updates: {"initialMinutes": 10}`,
          error: 'EMPTY_PATCH',
          guidance: 'Use specific property updates like {"initialMinutes": 10}'
        };
      }
    }
    
    // Direct update via component registry
    const result = await ComponentRegistry.update(componentId, patch);
    
    if (!result.success) {
      // Check if this is a circuit breaker block
      if ((result as any).isCircuitBreakerBlock) {
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
      message: `✅ TASK COMPLETE! Successfully updated ${componentId} with ${JSON.stringify(patch)}. Timer is now ${patch.initialMinutes || 'unknown'} minutes. NO FURTHER ACTION NEEDED.`,
      componentId,
      patch,
      __stop_indicator: true, 
      __task_complete: true,
      result: `✅ DONE: Timer updated to ${patch.initialMinutes} minutes`,
      instruction: 'STOP - Update successful, task complete'
    };
  },
  toolSchema: z
    .function()
    .args(
      z.string().describe('Component ID from list_components (e.g., "timer-retro-timer")'),
      z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).describe('Update object: {"initialMinutes": 6} for timer. If user says "6 minutes", use {"initialMinutes": 6}')
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
  description: '🔴 MANDATORY FIRST STEP! 🔴 Call this BEFORE any ui_update! Gets current component IDs - NEVER use old cached IDs!',
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

export const tools: TamboTool[] = [
  // Set the MCP tools https://localhost:3000/mcp-config
  // Add non MCP tools here
  listComponentsTool,
  uiUpdateTool,
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
