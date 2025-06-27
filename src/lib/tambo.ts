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

// Direct component update tool - no complex bus system needed!
export const uiUpdateTool: TamboTool = {
  name: 'ui_update',
  description: `⚠️  STEP 1: Call list_components first! ⚠️
  
Update an existing UI component instead of creating a new one.

STEP BY STEP:
1. Call list_components to see available components with their IDs and current props
2. Use the exact messageId from the response
3. Specify what to update in the patch object

EXAMPLES:
- To change timer to 10 minutes: componentId="retrotimer-1751017248126", patch={"initialMinutes": 10}
- To change participant name: componentId="participant-tile-456", patch={"participantIdentity": "Ben"}

This tool works DIRECTLY - no complex routing needed!`,
  tool: async (componentId: string, patch: Record<string, unknown>) => {
    // Validate componentId exists in registry
    const availableComponents = ComponentRegistry.list();
    const availableIds = availableComponents.map((c: ComponentInfo) => c.messageId);
    
    if (!componentId || !availableIds.includes(componentId)) {
      throw new Error(`Component "${componentId}" not found. Available components: ${availableIds.join(', ') || 'none'}`);
    }
    
    // Validate patch is not empty
    if (!patch || Object.keys(patch).length === 0) {
      throw new Error(`Empty patch {}. You must specify what to update. Examples: {"initialMinutes": 10} for timer, {"participantIdentity": "Ben"} for participant`);
    }
    
    // Direct update via component registry
    const result = await ComponentRegistry.update(componentId, patch);
    
    if (!result.success) {
      throw new Error(result.error || 'Update failed');
    }
    
    return { 
      status: 'SUCCESS',
      message: `Updated component ${componentId}`,
      componentId,
      patch 
    };
  },
  toolSchema: z
    .function()
    .args(
      z.string().describe('Component ID from list_components (e.g., "retrotimer-1751017248126")'),
      z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).describe('Update object: {"initialMinutes": 10} for timer')
    )
    .returns(
      z.object({
        status: z.string(),
        message: z.string(),
        componentId: z.string(),
        patch: z.record(z.unknown())
      })
    ),
};

// Direct component listing tool - no bus system needed!
export const listComponentsTool: TamboTool = {
  name: 'list_components',
  description: '🚨 ALWAYS CALL THIS FIRST before ui_update! 🚨 Lists all available UI components with their message IDs and current props.',
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
      }))
    })),
  tool: async () => {
    // Direct access to component registry
    const components = ComponentRegistry.list();
    
    return {
      status: 'SUCCESS',
      message: `Found ${components.length} components`,
      components: components.map((c: ComponentInfo) => ({
        messageId: c.messageId,
        componentType: c.componentType,
        props: c.props,
        contextKey: c.contextKey
      }))
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
