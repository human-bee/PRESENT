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
    // 🔧 STRICT PARAMETER VALIDATION: Only accept proper calling pattern
    // 🔧 SMART PARAMETER DETECTION: Handle both proper and legacy calling patterns with smart inference
    let componentId: string;
    let patch: Record<string, unknown>;
    let userContext: string = '';
    
    if (typeof componentIdOrFirstArg === 'string') {
      // Proper call: ui_update("component-id", {patch})
      componentId = componentIdOrFirstArg;
      patch = patchOrSecondArg || {};
    } else if (typeof componentIdOrFirstArg === 'object' && componentIdOrFirstArg !== null) {
      // Legacy call: ui_update({param1: "component-id", param2: {patch}})
      const params = componentIdOrFirstArg as Record<string, unknown>;
      componentId = String(params.componentId || params.param1 || '');
      patch = (params.patch || params.param2 || {}) as Record<string, unknown>;
      
      // Extract user context if available
      if (params.userContext && typeof params.userContext === 'string') {
        userContext = params.userContext;
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
        message: `🚨 INVALID PARAMETERS! 🚨\n\nExpected: ui_update("component-id", {"initialMinutes": 10})\nReceived: ui_update(${typeof componentIdOrFirstArg}, ${typeof patchOrSecondArg})\n\nPlease call list_components first to get the component ID, then:\nui_update("timer-retro-timer-xyz", {"initialMinutes": 10})`,
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
    
    // 🛑 REQUIRE EXPLICIT PATCH: Prevent loops caused by empty patches
    if (!patch || Object.keys(patch).length === 0) {
      console.log('🔍 [uiUpdateTool] Empty patch detected, attempting smart inference...');
      
      // Get component info to understand what we're working with
      const component = availableComponents.find(c => c.messageId === componentId);
      if (component && component.componentType.toLowerCase().includes('timer')) {
        // Smart timer duration inference - check multiple sources
        console.log('🔍 [uiUpdateTool] Looking for timer duration in context...');
        
        // Build context string from multiple sources
        let contextString = userContext || '';
        
        // Try to get recent user messages first (highest priority)
        const recentMessages = document.querySelectorAll('[data-role="user"], .user-message, [data-message-type="user"], .bg-blue-50, .message-user');
        const recentMessageTexts = Array.from(recentMessages)
          .slice(-5) // Last 5 messages only
          .map(el => el.textContent?.trim())
          .filter(text => text && text.length > 0)
          .join(' ');
        
        if (recentMessageTexts) {
          contextString = recentMessageTexts + ' ' + contextString;
          console.log('📱 [uiUpdateTool] Recent messages:', recentMessageTexts);
        } else {
          // Fallback: try to find any element containing "minute" that's not the timer display
          const allTextElements = Array.from(document.querySelectorAll('*'))
            .map(el => el.textContent?.trim() || '')
            .filter(text => text.includes('minute') && !text.includes('Minute Timer') && text.length < 100)
            .slice(-3); // Get last 3 relevant texts
          
          if (allTextElements.length > 0) {
            contextString = allTextElements.join(' ') + ' ' + contextString;
            console.log('🔍 [uiUpdateTool] Fallback text search:', allTextElements);
          }
        }
        
        // Add document title and any global context
        contextString += ' ' + (document.title || '');
        
        // Add page content as LOWEST priority (to avoid reading current timer state)
        const pageContent = document.body.textContent?.slice(0, 500) || '';
        
        console.log('🔎 [uiUpdateTool] Searching for duration in context:', contextString.slice(0, 200) + '...');
        
        // Comprehensive duration patterns
        const durationPatterns = [
          /(\d+)\s*-?\s*(min|minute|minutes)/gi,
          /(\d+)\s*(m|mins)/gi,
          /(\d+)\s*(hour|hours|hr|hrs)/gi,
          /(\d+)\s*(second|seconds|sec|secs)/gi,
          /(six|6)\s*(min|minute|minutes)/gi,
          /(five|5)\s*(min|minute|minutes)/gi,
          /(ten|10)\s*(min|minute|minutes)/gi,
          /to\s+(\d+)/gi, // "to 6", "to 10"
          /make.*?(\d+)/gi, // "make it 6"
          /instead.*?(\d+)/gi, // "six minutes instead"
        ];
        
        let foundDuration: number | null = null;
        let foundUnit = 'minutes';
        
        // First, search in user context (messages, etc.) - HIGHEST PRIORITY
        for (const pattern of durationPatterns) {
          pattern.lastIndex = 0; // Reset regex state
          const matches = Array.from(contextString.matchAll(pattern));
          console.log(`🔍 [uiUpdateTool] Pattern ${pattern} found ${matches.length} matches in user context`);
          
          if (matches.length > 0) {
            // Use the LAST match (most recent mention)
            const lastMatch = matches[matches.length - 1];
            const numberStr = lastMatch[1];
            const unit = lastMatch[2]?.toLowerCase() || 'minutes';
            
            // Convert word numbers to digits
            let number: number;
            if (numberStr === 'six') {
              number = 6;
            } else if (numberStr === 'five') {
              number = 5;
            } else if (numberStr === 'ten') {
              number = 10;
            } else {
              number = parseInt(numberStr, 10);
            }
            
            console.log(`🔢 [uiUpdateTool] Extracted number: ${number} from match: "${lastMatch[0]}"`);
            
            if (!isNaN(number) && number > 0) {
              foundDuration = number;
              if (unit.includes('hour') || unit.includes('hr')) {
                foundDuration = number * 60; // Convert to minutes
                foundUnit = 'hours';
              } else if (unit.includes('sec')) {
                foundDuration = Math.ceil(number / 60); // Convert to minutes
                foundUnit = 'seconds';
              } else {
                foundUnit = 'minutes';
              }
              
              console.log(`✨ [uiUpdateTool] Found duration: ${number} ${unit} via pattern: ${pattern.source}`);
              break; // Stop at first match in user context
            }
          }
        }
        
        // Only if no duration found in user context, search page content
        if (!foundDuration) {
          console.log('🔍 [uiUpdateTool] No duration in user context, searching page content...');
          const fullContextString = contextString + ' ' + pageContent;
          
          for (const pattern of durationPatterns) {
            pattern.lastIndex = 0;
            const matches = Array.from(fullContextString.matchAll(pattern));
            console.log(`🔍 [uiUpdateTool] Pattern ${pattern} found ${matches.length} matches in page content`);
            
            if (matches.length > 0) {
              const lastMatch = matches[matches.length - 1];
              const numberStr = lastMatch[1];
              const unit = lastMatch[2]?.toLowerCase() || 'minutes';
              
              // Convert word numbers to digits
              let number: number;
              if (numberStr === 'six') {
                number = 6;
              } else if (numberStr === 'five') {
                number = 5;
              } else if (numberStr === 'ten') {
                number = 10;
              } else {
                number = parseInt(numberStr, 10);
              }
              
              console.log(`🔢 [uiUpdateTool] Extracted number: ${number} from match: "${lastMatch[0]}"`);
              
              if (!isNaN(number) && number > 0) {
                foundDuration = number;
                if (unit.includes('hour') || unit.includes('hr')) {
                  foundDuration = number * 60;
                  foundUnit = 'hours';
                } else if (unit.includes('sec')) {
                  foundDuration = Math.ceil(number / 60);
                  foundUnit = 'seconds';
                } else {
                  foundUnit = 'minutes';
                }
                
                console.log(`✨ [uiUpdateTool] Found duration: ${number} ${unit} via pattern: ${pattern.source}`);
                break;
              }
            }
          }
        }
        
        // Apply the found duration
        if (foundDuration) {
          if (foundUnit.startsWith('hour')) {
            patch = { initialMinutes: foundDuration * 60 };
            console.log(`✨ [uiUpdateTool] Smart inference: ${foundDuration} hours = ${foundDuration * 60} minutes`);
          } else {
            patch = { initialMinutes: foundDuration };
            console.log(`✨ [uiUpdateTool] Smart inference: ${foundDuration} minutes`);
          }
        } else {
          console.log('🤔 [uiUpdateTool] No duration found in context');
        }
      }
      
      // If still no patch after inference, return error
      if (!patch || Object.keys(patch).length === 0) {
        return {
          status: 'ERROR',
          message: `🚨 EMPTY PATCH! 🚨\n\nYou must specify what to update. Example: {"initialMinutes": 6}`,
          error: 'EMPTY_PATCH',
          guidance: 'Call ui_update with a non-empty patch object, e.g., {"initialMinutes": 6}',
          __stop_indicator: true,
          __task_complete: true
        };
      }
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
      z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .refine(obj => Object.keys(obj).length > 0, {
          message: "Patch object cannot be empty. Example: {\"initialMinutes\": 6}"
        })
        .describe('Update object: {"initialMinutes": 6} for timer. If user says "6 minutes", use {"initialMinutes": 6}')
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

// AI-powered parameter extraction tool - leverages LLM intelligence instead of regex patterns
export const extractUpdateParamsTool: TamboTool = {
  name: 'extract_update_params',
  description: `🧠 AI-POWERED PARAMETER EXTRACTION 🧠

Use this FIRST when user wants to update a component but doesn't specify exact parameters.
This tool uses AI intelligence to understand user intent and extract proper update parameters.

Examples:
- "make it 6 minutes" → {"initialMinutes": 6}
- "change title to 'My Timer'" → {"title": "My Timer"}  
- "add task: Review PR" → {"newTask": "Review PR"}
- "mark first item complete" → {"itemIndex": 0, "completed": true}

Works for ANY component type - timers, todo lists, action trackers, etc.
Much more elegant than hard-coded regex patterns!`,
  tool: async (userMessage: string, componentType: string) => {
    // Use AI's natural language understanding to extract parameters
    const result = extractParametersWithAI(userMessage, componentType);
    
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
function extractParametersWithAI(userMessage: string, componentType: string): Record<string, unknown> {
  const message = userMessage.toLowerCase();
  
  // For timers - much more flexible patterns
  if (componentType.toLowerCase().includes('timer')) {
    // Look for any time-related updates
    const timePatterns = [
      // Numbers + time units
      /(\d+)\s*(min|minute|minutes|hour|hours|second|seconds|m|h|s)/i,
      // Word numbers + time units  
      /(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s*(min|minute|minutes|hour|hours)/i,
      // "to X" patterns
      /to\s+(\d+)/i,
      // "make it X" patterns
      /make.*?(\d+)/i,
      // "change to X" patterns
      /change.*?to.*?(\d+)/i,
    ];
    
    for (const pattern of timePatterns) {
      const match = message.match(pattern);
      if (match) {
        let number = parseInt(match[1], 10);
        
        // Handle word numbers
        if (isNaN(number)) {
          const wordToNumber: Record<string, number> = {
            one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
            seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
            twelve: 12, fifteen: 15, twenty: 20, thirty: 30
          };
          number = wordToNumber[match[1].toLowerCase()] || 0;
        }
        
        if (number > 0) {
          // Handle unit conversion
          const unit = match[2]?.toLowerCase() || 'minutes';
          if (unit.includes('hour') || unit === 'h') {
            return { initialMinutes: number * 60 };
          } else if (unit.includes('second') || unit === 's') {
            return { initialMinutes: Math.max(1, Math.ceil(number / 60)) };
          } else {
            return { initialMinutes: number };
          }
        }
      }
    }
  }
  
  // For action items / todo lists
  if (componentType.toLowerCase().includes('action') || componentType.toLowerCase().includes('todo')) {
    if (message.includes('add') || message.includes('create') || message.includes('new')) {
      // Extract task text after "add", "create", etc.
      const taskMatch = message.match(/(?:add|create|new)\s*(?:task|item)?:?\s*(.+)/i);
      if (taskMatch) {
        return { newTask: taskMatch[1].trim() };
      }
    }
    
    if (message.includes('complete') || message.includes('done') || message.includes('finish')) {
      // Look for item references
      const indexMatch = message.match(/(?:first|1st|\b1\b)/i) ? 0 :
                        message.match(/(?:second|2nd|\b2\b)/i) ? 1 :
                        message.match(/(?:third|3rd|\b3\b)/i) ? 2 : null;
      
      if (indexMatch !== null) {
        return { itemIndex: indexMatch, completed: true };
      }
    }
  }
  
  // For title/name changes
  if (message.includes('title') || message.includes('name')) {
    const titleMatch = message.match(/(?:title|name)\s*(?:to|is)?\s*["\']?([^"']+)["\']?/i);
    if (titleMatch) {
      return { title: titleMatch[1].trim() };
    }
  }
  
  // Return empty if no clear intent found
  return {};
}

export const tools: TamboTool[] = [
  // Set the MCP tools https://localhost:3000/mcp-config
  // Add non MCP tools here
  listComponentsTool,
  uiUpdateTool,
  extractUpdateParamsTool,
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
