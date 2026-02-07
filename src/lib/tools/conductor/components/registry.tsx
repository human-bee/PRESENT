import { YoutubeEmbed, youtubeEmbedSchema } from "@/components/ui/youtube/youtube-embed";
import { YoutubeSearchEnhanced, youtubeSearchEnhancedSchema } from '@/components/ui/youtube/youtube-search-enhanced';
import { z } from "zod";
import { WeatherForecast, weatherForecastSchema } from '@/components/ui/integrations/weather-forecast';
import { RetroTimerRegistry, retroTimerSchema } from '@/components/ui/productivity/retro-timer-registry';
import { RetroTimerEnhanced, retroTimerEnhancedSchema } from '@/components/ui/productivity/retro-timer-enhanced';
import { DocumentEditor, documentEditorSchema } from '@/components/ui/documents/document-editor';
import { ResearchPanel, researchPanelSchema } from '@/components/ui/research/research-panel';
import { ActionItemTracker, actionItemTrackerSchema } from '@/components/ui/productivity/action-item-tracker';
import MeetingSummaryWidget, { meetingSummaryWidgetSchema } from '@/components/ui/productivity/meeting-summary-widget';
import MemoryRecallWidget, { memoryRecallWidgetSchema } from '@/components/ui/productivity/memory-recall-widget';
import CrowdPulseWidget from '@/components/ui/productivity/crowd-pulse-widget';
import { crowdPulseWidgetSchema } from '@/components/ui/productivity/crowd-pulse-schema';
import McpAppWidget, { mcpAppWidgetSchema } from '@/components/ui/mcp/mcp-app-widget';
import {
  LivekitParticipantTile,
  livekitParticipantTileSchema,
} from '@/components/ui/livekit/participant/livekit-participant-tile';
import {
  LivekitRoomConnector,
  livekitRoomConnectorSchema,
} from '@/components/ui/livekit/livekit-room-connector';
import {
  LivekitScreenShareTile,
  livekitScreenShareTileSchema,
} from '@/components/ui/livekit/livekit-screenshare-tile';

import LiveCaptions, { liveCaptionsSchema } from '@/components/LiveCaptions';
import LinearKanbanBoard, { linearKanbanSchema } from '@/components/ui/productivity/linear-kanban-board';

// ...


import { OnboardingGuide, onboardingGuideSchema } from '@/components/ui/onboarding/onboarding-guide';
import { ComponentToolbox } from '@/components/ui/shared/component-toolbox';

// Add debate scorecard @debate-scorecard.tsx
import DebateScorecard, { debateScoreCardSchema } from '@/components/ui/productivity/debate-scorecard';
import { InfographicWidget } from '@/components/InfographicWidget';

// Context feeder widget for document/text context injection
import { ContextFeeder, contextFeederSchema } from '@/components/ui/documents/context-feeder';

import { componentToolboxSchema } from "@/lib/custom";

const extendedSchema = <T extends z.AnyZodObject>(schema: T) => {
  return schema.extend({
    x: z.number().optional().describe('X position'),
    y: z.number().optional().describe('Y position'),
  });
}

const infographicWidgetSchema = z.object({
  useGrounding: z.boolean().optional().describe('Whether to enable Google Search grounding'),
  isShape: z.boolean().optional().default(true).describe('Render inside the canvas shape'),
});

// Wrapper for LivekitParticipantTile to map onIdentityChange to updateState
function LivekitParticipantTileWrapper(props: any) {
  // In CustomShapeComponent, props.state contains the component state.
  // We fallback to top-level props if state is missing (for backward compat or direct usage).
  const participantIdentity = props.state?.participantIdentity ?? props.participantIdentity;

  const handleIdentityChange = (id: string) => {
    // updateState is injected by CustomShapeComponent
    if (props.updateState) {
      props.updateState({ participantIdentity: id });
    }
  };

  return (
    <LivekitParticipantTile
      {...props}
      participantIdentity={participantIdentity}
      onIdentityChange={handleIdentityChange}
    />
  );
}

export const components: any = [
  {
    name: 'YoutubeEmbed',
    description:
      'Use this to embed a YouTube video. Requires a video ID and optional start time in seconds.',
    component: YoutubeEmbed,
    propsSchema: extendedSchema(youtubeEmbedSchema),
  },
  {
    name: 'YoutubeSearchEnhanced',
    description:
      'Search YouTube videos (YouTube Data API) with trending, filters, and optional transcripts.',
    component: YoutubeSearchEnhanced,
    propsSchema: extendedSchema(youtubeSearchEnhancedSchema),
  },
  {
    name: 'WeatherForecast',
    description:
      'Display weather forecast data with visuals. Requires JSON weather data in a specific format.',
    component: WeatherForecast,
    propsSchema: extendedSchema(weatherForecastSchema),
  },
  {
    name: 'RetroTimer',
    description:
      'A retro-styled countdown timer with preset options for 5, 10, and 20 minutes. Features start/pause and reset controls. Now with AI update capabilities!',
    component: RetroTimerRegistry,
    propsSchema: extendedSchema(retroTimerSchema),
  },
  {
    name: 'RetroTimerEnhanced',
    description:
      'An enhanced retro-styled countdown timer with AI update capabilities and new simplified component registry. Features direct AI updates, auto-registration, better state management, and preset options for 5, 10, and 20 minutes. Demonstrates the new simplified architecture without complex bus systems. Perfect for testing AI component updates!',
    component: RetroTimerEnhanced,
    propsSchema: extendedSchema(retroTimerEnhancedSchema),
  },
  {
    name: 'DocumentEditor',
    description:
      'An advanced collaborative document editor with AI-powered editing capabilities. Features real-time word-level diff tracking, beautiful visual change highlighting, persistent state management, and seamless AI update integration. Perfect for collaborative document editing, AI-assisted writing, content revision workflows, and scenarios requiring detailed change tracking and visual diff displays.',
    component: DocumentEditor,
    propsSchema: extendedSchema(documentEditorSchema),
  },
  {
    name: 'ResearchPanel',
    description:
      'A sophisticated research results display panel that shows real-time research findings from MCP tools. Features source credibility ratings, fact-checking status, filtering options, bookmarking, and beautiful card-based layout. Perfect for displaying Perplexity research results, fact-checking data, and contextual information during meetings or conversations.',
    component: ResearchPanel,
    propsSchema: extendedSchema(researchPanelSchema),
  },
  {
    name: 'ActionItemTracker',
    description:
      'A comprehensive action item management system that tracks tasks, assignments, due dates, and progress. Can be initially created by AI with action items from meetings or conversations, then allows users to dynamically add, edit, complete, and manage items. Features priority levels, status tracking, assignee management, filtering, sorting, and persistent state. Perfect for meeting follow-ups, project management, and task coordination.',
    component: ActionItemTracker,
    propsSchema: extendedSchema(actionItemTrackerSchema),
  },
  {
    name: 'MeetingSummaryWidget',
    description:
      'Meeting summary panel that renders CRM-ready summaries, highlights, decisions, and action items. Supports updates from the summary steward and optional MCP handoff to a CRM tool.',
    component: MeetingSummaryWidget,
    propsSchema: extendedSchema(meetingSummaryWidgetSchema),
  },
  {
    name: 'MemoryRecallWidget',
    description:
      'Vector memory recall panel that queries MCP memory stores (e.g. Qdrant) and lists matching context snippets.',
    component: MemoryRecallWidget,
    propsSchema: extendedSchema(memoryRecallWidgetSchema),
  },
  {
    name: 'CrowdPulseWidget',
    description:
      'Crowd pulse control room for stage demos. Tracks hand counts, live questions, scoreboards, and follow-up suggestions.',
    component: CrowdPulseWidget,
    propsSchema: extendedSchema(crowdPulseWidgetSchema),
  },
  {
    name: 'McpAppWidget',
    description:
      'Render an MCP App (ui:// resource) in a sandboxed iframe and optionally call the backing MCP tool.',
    component: McpAppWidget,
    propsSchema: extendedSchema(mcpAppWidgetSchema),
  },
  {
    name: 'LivekitRoomConnector',
    description:
      'Establishes a LiveKit room connection on the canvas. This is the FIRST component you need to create before using any other LiveKit components. It provides the necessary context for participant tiles and toolbars to function. Features room name configuration, connection status display, participant count, and invite link sharing. Once connected, you can spawn LivekitParticipantTile and LivekitToolbar components.',
    component: LivekitRoomConnector,
    propsSchema: extendedSchema(livekitRoomConnectorSchema),
  },
  {
    name: 'LivekitParticipantTile',
    description:
      'Individual participant video/audio tile with real-time LiveKit integration. REQUIRES LivekitRoomConnector to be connected first. Shows participant video feed, audio controls, connection quality, speaking indicators, and individual toolbar controls. Automatically detects local vs remote participants and AI agents (with bot icons). Features minimize/expand functionality, audio level visualization, and drag-and-drop capability on the canvas.',
    component: LivekitParticipantTileWrapper,
    propsSchema: extendedSchema(livekitParticipantTileSchema),
  },
  {
    name: 'LivekitScreenShareTile',
    description:
      "Dedicated screen share tile. Prefers the participant's screen share track and uses contain fit to avoid cropping. Includes hover overlay with stop-share for local user. Designed to spawn alongside participant tiles.",
    component: LivekitScreenShareTile,
    propsSchema: extendedSchema(livekitScreenShareTileSchema),
  },
  // Commented out for Node.js compatibility in agent worker
  // {
  //   name: "AIImageGenerator",
  //   description:
  //     "A real-time AI image generator that creates images from text prompts using Together AI's FLUX model. Features include multiple art styles (pop art, minimal, cyberpunk, etc.), generation history, canvas integration, download capability, iterative mode for consistency, and speech-to-text integration for voice-driven image generation. Perfect for creative projects, visual brainstorming, concept art generation, and real-time visual content creation. Automatically debounces prompt changes and provides visual feedback during generation. Can be controlled via microphone for hands-free operation.",
  //   component: AIImageGenerator,
  //   propsSchema: aiImageGeneratorSchema,
  // },
  {
    name: 'LiveCaptions',
    description:
      'A real-time live captions component that displays speech transcriptions in an interactive tldraw-style canvas with beautiful speech bubbles. REQUIRES LivekitRoomConnector to be connected first. Features real-time transcription from Groq Whisper via LiveKit data channels, draggable speech bubbles, speaker identification with avatars, timestamps, interim/final transcript states, export capabilities (TXT/JSON/SRT), customizable canvas themes (grid/dots/clean), auto-positioning, and persistent state management. Perfect for accessibility, meeting transcription, live events, educational content, and any scenario requiring real-time speech-to-text visualization with an engaging visual interface.',
    component: LiveCaptions,
    propsSchema: extendedSchema(liveCaptionsSchema),
  },
  {
    name: 'LinearKanbanBoard',
    description:
      'A comprehensive Linear project management kanban board with drag-and-drop functionality and MCP integration. Features multiple team support, customizable status columns (Backlog, Todo, In Progress, Delegate to Agent, Blocked, Review Required, Done), issue priority visualization with color coding, assignee management, project categorization, and pending update queue system. Supports optimistic UI updates with drag-and-drop issue movement between columns, clipboard export of pending changes, and hybrid sync workflow for reliable Linear API integration. Perfect for agile project management, sprint planning, issue tracking, and team collaboration workflows. Can be populated with real Linear data via MCP or used with demo data.',
    component: LinearKanbanBoard,
    propsSchema: extendedSchema(linearKanbanSchema),
  },
  {
    name: 'OnboardingGuide',
    description:
      "Interactive onboarding guide that teaches users how to use voice commands, create components, and navigate the canvas. Context-aware for different pages (canvas vs voice). Responds to 'show help', 'how do I', 'getting started', or 'onboarding'. Perfect for new user orientation and feature discovery.",
    component: OnboardingGuide,
    propsSchema: extendedSchema(onboardingGuideSchema),
  },
  {
    name: 'ComponentToolbox',
    description:
      'A draggable, resizable toolbox of all custom components. Drag from here to the canvas to create new components.',
    component: ComponentToolbox,
    propsSchema: extendedSchema(componentToolboxSchema),
  },
  {
    name: 'DebateScorecard',
    description:
      'Live debate scorecard with retro boxing aesthetic. Tracks strength, logic, sources, accuracy, BS meter, learning score, live fact checks, and timeline. Designed for real-time streams and educational debates.',
    component: DebateScorecard,
    propsSchema: extendedSchema(debateScoreCardSchema),
  },
  {
    name: 'InfographicWidget',
    description:
      'Generates infographics from recent conversation context (Gemini image model) and allows dragging results onto the canvas.',
    component: InfographicWidget,
    propsSchema: extendedSchema(infographicWidgetSchema),
  },
  {
    name: 'ContextFeeder',
    description:
      'Upload markdown files or paste text to add context that gets injected into all AI steward prompts. Perfect for providing reference materials, documentation, or background information to guide agent responses.',
    component: ContextFeeder,
    propsSchema: extendedSchema(contextFeederSchema),
  },
  // Add more components here
];
