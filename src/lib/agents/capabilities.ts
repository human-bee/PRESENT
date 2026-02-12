import {
  type CapabilityProfile,
  getWidgetLifecycleMetadata,
  isTier1Widget,
  type WidgetGroup,
  type WidgetLifecycleOp,
  type WidgetTier,
} from './widget-lifecycle-manifest';
import {
  incrementOrchestrationCounter,
  recordOrchestrationTiming,
} from './shared/orchestration-metrics';

// Accept either browser or node LiveKit Room by using a minimal interface
export interface RoomLike {
  on: (event: string, cb: (...args: unknown[]) => void) => unknown;
  off: (event: string, cb: (...args: unknown[]) => void) => unknown;
  localParticipant?: {
    publishData: (
      data: Uint8Array,
      options?: { reliable?: boolean; topic?: string },
    ) => unknown;
  } | null;
}

export type CapabilityTool = {
  name: string;
  description: string;
  examples?: string[];
};

export type CapabilityComponent = {
  name: string;
  description: string;
  examples?: string[];
  tier?: WidgetTier;
  group?: WidgetGroup;
  lifecycleOps?: WidgetLifecycleOp[];
  critical?: boolean;
};

export interface SystemCapabilities {
  tools: CapabilityTool[];
  components?: CapabilityComponent[];
  capabilityProfile?: CapabilityProfile;
}

export type CapabilityQueryOptions = {
  profile?: CapabilityProfile | string | null;
  timeoutMs?: number;
  fallbackTimeoutMs?: number;
  fallbackToFull?: boolean;
};

export type CapabilityQueryResult = {
  capabilities: SystemCapabilities;
  capabilityProfile: CapabilityProfile;
  requestedCapabilityProfile: CapabilityProfile;
  fallbackUsed: boolean;
  source: 'remote' | 'default';
};

const LEAN_TOOL_ALLOWLIST = new Set<string>([
  'create_component',
  'update_component',
  'remove_component',
  'reserve_component',
  'resolve_component',
  'dispatch_to_conductor',
  'research_search',
  'transcript_search',
  'youtube_search',
  'mcp_tool',
  'create_infographic',
  'list_components',
  'respond_with_voice',
]);

const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_FALLBACK_TIMEOUT_MS = 2_500;

const toBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

export const normalizeCapabilityProfile = (
  profile?: CapabilityProfile | string | null,
): CapabilityProfile => {
  const normalized = typeof profile === 'string' ? profile.trim().toLowerCase() : '';
  if (normalized === 'lean_adaptive') return 'lean_adaptive';
  return 'full';
};

const withLifecycleMetadata = (component: CapabilityComponent): CapabilityComponent => {
  const metadata = getWidgetLifecycleMetadata(component.name);
  if (!metadata) return component;
  return {
    ...component,
    tier: component.tier ?? metadata.tier,
    group: component.group ?? metadata.group,
    lifecycleOps: component.lifecycleOps ?? metadata.lifecycleOps,
    critical: component.critical ?? metadata.critical,
  };
};

export const buildCapabilitiesForProfile = (
  input: SystemCapabilities,
  profile: CapabilityProfile,
): SystemCapabilities => {
  const baseTools = Array.isArray(input.tools) ? input.tools : [];
  const baseComponents = Array.isArray(input.components) ? input.components : [];
  const componentsWithMetadata = baseComponents.map(withLifecycleMetadata);

  if (profile === 'lean_adaptive') {
    const filteredComponents = componentsWithMetadata.filter((component) =>
      isTier1Widget(component.name),
    );
    const filteredTools = baseTools.filter((tool) => LEAN_TOOL_ALLOWLIST.has(tool.name));

    return {
      tools: filteredTools.length > 0 ? filteredTools : baseTools,
      components: filteredComponents.length > 0 ? filteredComponents : componentsWithMetadata,
      capabilityProfile: 'lean_adaptive',
    };
  }

  return {
    tools: baseTools,
    components: componentsWithMetadata,
    capabilityProfile: 'full',
  };
};

const defaultCustomComponentsBase: CapabilityComponent[] = [
  // Video/Media
  {
    name: 'YoutubeEmbed',
    description: 'Embed a YouTube video by ID',
    examples: ['embed youtube video', 'show youtube', 'play video'],
  },

  // Productivity
  {
    name: 'RetroTimer',
    description: 'Retro countdown timer',
    examples: ['create timer', 'set a timer', 'start countdown'],
  },
  {
    name: 'RetroTimerEnhanced',
    description: 'Enhanced timer with AI updates',
    examples: ['create a 5 minute timer', 'add timer', 'start a timer'],
  },
  {
    name: 'ActionItemTracker',
    description: 'Action item manager',
    examples: ['create action items', 'add todo list', 'track tasks', 'create task tracker'],
  },
  {
    name: 'MeetingSummaryWidget',
    description: 'Meeting summary panel',
    examples: ['create meeting summary widget', 'show meeting summary', 'add summary panel'],
  },
  {
    name: 'MemoryRecallWidget',
    description: 'Vector memory recall panel',
    examples: ['search memory', 'recall memory', 'show memory recall'],
  },
  {
    name: 'CrowdPulseWidget',
    description: 'Crowd pulse hand-count and Q&A tracker',
    examples: ['create crowd pulse widget', 'track hand count', 'show crowd q&a'],
  },
  {
    name: 'McpAppWidget',
    description: 'MCP App iframe host',
    examples: ['open MCP app', 'show MCP widget'],
  },
  {
    name: 'LinearKanbanBoard',
    description: 'Kanban board with Linear integration',
    examples: ['create kanban board', 'show kanban', 'add kanban', 'task board'],
  },

  // Documents & Research
  {
    name: 'DocumentEditor',
    description: 'Collaborative document editor',
    examples: ['create document', 'add document editor', 'create doc', 'new document'],
  },
  {
    name: 'ResearchPanel',
    description: 'Research results panel',
    examples: ['create research panel', 'show research', 'add research'],
  },
  {
    name: 'ContextFeeder',
    description: 'Upload/paste docs to inject context into stewards',
    examples: ['add context feeder', 'upload context', 'create context feeder'],
  },

  // LiveKit/Video
  {
    name: 'LivekitRoomConnector',
    description: 'Connect to LiveKit room',
    examples: ['create room connector', 'connect to room', 'add room connector'],
  },
  {
    name: 'LivekitParticipantTile',
    description: 'Participant video/audio tile',
    examples: ['create participant tile', 'add participant tile', 'show participant', 'add video tile'],
  },
  {
    name: 'LivekitScreenShareTile',
    description: 'Screen share display tile',
    examples: ['create screen share tile', 'add screen share', 'show screen share'],
  },
  {
    name: 'LiveCaptions',
    description: 'Live captions/transcription display',
    examples: ['show live captions', 'turn on captions', 'add captions', 'create captions'],
  },

  // Data & Visualization
  {
    name: 'WeatherForecast',
    description: 'Display weather forecast',
    examples: ['show weather', 'create weather widget', 'add weather'],
  },
  {
    name: 'DebateScorecard',
    description: 'Real-time debate scorecard',
    examples: ['create debate scorecard', 'start debate', 'add scorecard'],
  },
  {
    name: 'InfographicWidget',
    description: 'AI-powered infographic generator',
    examples: ['create infographic', 'generate infographic', 'visualize conversation'],
  },

  // Utility
  {
    name: 'OnboardingGuide',
    description: 'Interactive onboarding/help guide',
    examples: ['show help', 'create onboarding guide', 'how do I use this'],
  },
  {
    name: 'ComponentToolbox',
    description: 'Draggable toolbox of all components',
    examples: ['show component toolbox', 'add toolbox', 'create toolbox'],
  },
];

export const defaultCustomComponents: CapabilityComponent[] =
  defaultCustomComponentsBase.map(withLifecycleMetadata);

const defaultCapabilitiesBase: SystemCapabilities = {
  tools: [
    {
      name: 'create_component',
      description: 'Create a UI component',
      examples: ['create a timer', 'show weather'],
    },
    {
      name: 'reserve_component',
      description: 'Reserve a deterministic component ID before creation',
    },
    {
      name: 'resolve_component',
      description: 'Resolve an existing component by hint (id/intent/slot/type)',
    },
    {
      name: 'youtube_search',
      description: 'Search YouTube videos',
      examples: ['search youtube for cats'],
    },
    {
      name: 'mcp_tool',
      description: 'Call an MCP tool by name',
      examples: ['mcp weather', 'mcp searchVideos'],
    },
    {
      name: 'update_component',
      description: 'Update existing UI components',
      examples: ['update timer to 10 minutes'],
    },
    {
      name: 'remove_component',
      description: 'Remove an existing UI component',
      examples: ['remove that widget', 'delete the crowd pulse widget'],
    },
    {
      name: 'list_components',
      description: 'List all components and their IDs',
    },
    { name: 'research_search', description: 'Run a research query and populate ResearchPanel' },
    { name: 'transcript_search', description: 'Retrieve recent transcript snippets' },
    { name: 'web_search', description: 'Search the web' },
    { name: 'create_infographic', description: 'Generate an infographic' },
    {
      name: 'dispatch_to_conductor',
      description: 'Dispatch complex steward tasks (canvas/research/scorecard/etc)',
    },
    {
      name: 'promote_component_content',
      description: 'Promote a component item onto the canvas',
    },
    { name: 'respond_with_voice', description: 'Send a text response (voice disabled)' },
  ],
  components: defaultCustomComponents,
};

export const defaultCapabilities: SystemCapabilities = buildCapabilitiesForProfile(
  defaultCapabilitiesBase,
  'full',
);

const runCapabilityQuery = async (
  room: RoomLike,
  profile: CapabilityProfile,
  timeoutMs: number,
): Promise<{ capabilities: SystemCapabilities; capabilityProfile: CapabilityProfile } | null> => {
  return await new Promise((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = (
      result: { capabilities: SystemCapabilities; capabilityProfile: CapabilityProfile } | null,
    ) => {
      if (settled) return;
      settled = true;
      room.off('dataReceived', handler);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    };

    const handler = (data: unknown) => {
      const bytes = toBytes(data);
      if (!bytes) return;
      try {
        const message = JSON.parse(new TextDecoder().decode(bytes));
        if (message?.type !== 'capability_list' || !message?.capabilities) return;

        const responseProfile = normalizeCapabilityProfile(
          message?.capabilityProfile ??
            message?.capabilities?.capabilityProfile ??
            message?.requestedCapabilityProfile ??
            profile,
        );
        const profiledCapabilities = buildCapabilitiesForProfile(
          message.capabilities as SystemCapabilities,
          responseProfile,
        );

        finish({
          capabilities: profiledCapabilities,
          capabilityProfile: responseProfile,
        });
      } catch {
        // Ignore non-capability payloads.
      }
    };

    room.on('dataReceived', handler);

    try {
      const queryMessage = JSON.stringify({
        type: 'capability_query',
        capabilityProfile: profile,
        timestamp: Date.now(),
      });
      room.localParticipant?.publishData(new TextEncoder().encode(queryMessage), {
        reliable: true,
        topic: 'capability_query',
      });
    } catch {
      finish(null);
      return;
    }

    timeoutHandle = setTimeout(() => finish(null), timeoutMs);
  });
};

/** Query system capabilities via LiveKit data channel with profile fallback. */
export async function queryCapabilities(
  room: RoomLike,
  options: CapabilityQueryOptions = {},
): Promise<CapabilityQueryResult> {
  const requestedProfile = normalizeCapabilityProfile(options.profile);
  const timeoutMs = Math.max(500, Math.floor(options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS));
  const fallbackTimeoutMs = Math.max(
    500,
    Math.floor(options.fallbackTimeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS),
  );
  const fallbackToFull = options.fallbackToFull ?? true;

  incrementOrchestrationCounter('capabilityQueries');

  const primaryStart = Date.now();
  const primary = await runCapabilityQuery(room, requestedProfile, timeoutMs);
  recordOrchestrationTiming({
    stage: 'capability.query.primary',
    durationMs: Date.now() - primaryStart,
    route: requestedProfile,
  });

  if (primary) {
    return {
      capabilities: primary.capabilities,
      capabilityProfile: primary.capabilityProfile,
      requestedCapabilityProfile: requestedProfile,
      fallbackUsed: false,
      source: 'remote',
    };
  }

  if (requestedProfile === 'lean_adaptive' && fallbackToFull) {
    incrementOrchestrationCounter('capabilityFallbacks');
    const fallbackStart = Date.now();
    const fallback = await runCapabilityQuery(room, 'full', fallbackTimeoutMs);
    recordOrchestrationTiming({
      stage: 'capability.query.fallback',
      durationMs: Date.now() - fallbackStart,
      route: 'full',
    });

    if (fallback) {
      return {
        capabilities: fallback.capabilities,
        capabilityProfile: fallback.capabilityProfile,
        requestedCapabilityProfile: requestedProfile,
        fallbackUsed: true,
        source: 'remote',
      };
    }
  }

  const defaultProfile: CapabilityProfile =
    requestedProfile === 'lean_adaptive' && fallbackToFull ? 'full' : requestedProfile;
  const builtDefault = buildCapabilitiesForProfile(defaultCapabilitiesBase, defaultProfile);
  return {
    capabilities: builtDefault,
    capabilityProfile: defaultProfile,
    requestedCapabilityProfile: requestedProfile,
    fallbackUsed: requestedProfile !== defaultProfile,
    source: 'default',
  };
}
