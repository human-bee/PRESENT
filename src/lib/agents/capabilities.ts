// Accept either browser or node LiveKit Room by using a minimal interface
export interface RoomLike {
  on: (event: string, cb: (...args: any[]) => void) => unknown;
  off: (event: string, cb: (...args: any[]) => void) => unknown;
  localParticipant?: {
    publishData: (
      data: Uint8Array,
      options?: { reliable?: boolean; topic?: string },
    ) => unknown;
  } | null;
}

export type CapabilityProfile = 'full' | 'lean_adaptive';
export type CapabilityGroup =
  | 'visual'
  | 'widget-lifecycle'
  | 'research'
  | 'livekit'
  | 'mcp'
  | 'canvas'
  | 'utility';
export type WidgetTier = 'tier1' | 'tier2';
export type LifecycleOp = 'create' | 'update' | 'hydrate' | 'fill' | 'edit' | 'remove' | 'recover';

export interface ToolCapability {
  name: string;
  description: string;
  examples?: string[];
  group?: CapabilityGroup;
  critical?: boolean;
}

export interface ComponentCapability {
  name: string;
  description: string;
  examples?: string[];
  group?: CapabilityGroup;
  tier?: WidgetTier;
  lifecycleOps?: LifecycleOp[];
  critical?: boolean;
}

export interface SystemCapabilities {
  tools: ToolCapability[];
  components?: ComponentCapability[];
  capabilityProfile?: CapabilityProfile;
  manifestVersion?: string;
  fetchedAt?: number;
  fallbackReason?: 'timeout' | 'error' | 'invalid_response' | 'profile_miss';
}

const TIER1_WIDGET_NAMES = new Set<string>([
  'CrowdPulseWidget',
  'RetroTimerEnhanced',
  'ActionItemTracker',
  'LinearKanbanBoard',
  'DebateScorecard',
  'ResearchPanel',
  'MeetingSummaryWidget',
  'MemoryRecallWidget',
  'InfographicWidget',
  'McpAppWidget',
]);

const DEFAULT_LIFECYCLE_OPS: LifecycleOp[] = [
  'create',
  'update',
  'hydrate',
  'fill',
  'edit',
  'remove',
  'recover',
];

const withComponentMetadata = (
  component: Omit<ComponentCapability, 'tier' | 'group' | 'lifecycleOps' | 'critical'>,
): ComponentCapability => {
  const tier: WidgetTier = TIER1_WIDGET_NAMES.has(component.name) ? 'tier1' : 'tier2';
  const lower = component.name.toLowerCase();
  const group: CapabilityGroup = lower.includes('livekit') || lower.includes('caption')
    ? 'livekit'
    : lower.includes('research') ||
        lower.includes('memory') ||
        lower.includes('summary') ||
        lower.includes('document') ||
        lower.includes('context')
      ? 'research'
      : lower.includes('mcp')
        ? 'mcp'
        : lower.includes('timer') ||
            lower.includes('kanban') ||
            lower.includes('action') ||
            lower.includes('scorecard') ||
            lower.includes('crowd') ||
            lower.includes('infographic')
          ? 'widget-lifecycle'
          : 'utility';
  return {
    ...component,
    tier,
    group,
    lifecycleOps: DEFAULT_LIFECYCLE_OPS,
    critical: tier === 'tier1',
  };
};

const ALL_COMPONENT_CAPABILITIES: ComponentCapability[] = [
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
].map(withComponentMetadata);

export const defaultCustomComponents: ComponentCapability[] = ALL_COMPONENT_CAPABILITIES;

const ALL_TOOL_CAPABILITIES: ToolCapability[] = [
  {
    name: 'create_component',
    description: 'Create a UI component',
    examples: ['create a timer', 'show weather'],
    group: 'widget-lifecycle',
    critical: true,
  },
  {
    name: 'update_component',
    description: 'Update existing UI components',
    examples: ['update timer to 10 minutes'],
    group: 'widget-lifecycle',
    critical: true,
  },
  {
    name: 'remove_component',
    description: 'Remove an existing UI component',
    examples: ['remove that widget', 'delete the crowd pulse widget'],
    group: 'widget-lifecycle',
    critical: true,
  },
  {
    name: 'reserve_component',
    description: 'Reserve deterministic ids for upcoming component creation',
    group: 'widget-lifecycle',
    critical: true,
  },
  {
    name: 'resolve_component',
    description: 'Resolve component ids using type/slot/intent hints',
    group: 'widget-lifecycle',
    critical: true,
  },
  {
    name: 'dispatch_to_conductor',
    description: 'Route complex tasks to conductor/stewards',
    group: 'visual',
    critical: true,
  },
  {
    name: 'research_search',
    description: 'Run research query and sync into ResearchPanel',
    group: 'research',
    critical: true,
  },
  {
    name: 'transcript_search',
    description: 'Search recent transcript window',
    group: 'research',
    critical: true,
  },
  {
    name: 'youtube_search',
    description: 'Search YouTube videos',
    examples: ['search youtube for cats'],
    group: 'visual',
  },
  {
    name: 'mcp_tool',
    description: 'Call an MCP tool by name',
    examples: ['mcp weather', 'mcp searchVideos'],
    group: 'mcp',
  },
  { name: 'list_components', description: 'List all components and their IDs', group: 'widget-lifecycle' },
  { name: 'web_search', description: 'Search the web', group: 'research' },
  {
    name: 'create_infographic',
    description: 'Generate an infographic',
    group: 'widget-lifecycle',
    critical: true,
  },
  {
    name: 'promote_component_content',
    description: 'Promote a component item onto the canvas',
    group: 'canvas',
  },
  { name: 'respond_with_voice', description: 'Send a text response (voice disabled)', group: 'utility' },
  { name: 'canvas_focus', description: 'Focus/zoom camera', group: 'canvas' },
  { name: 'canvas_zoom_all', description: 'Zoom to fit all shapes', group: 'canvas' },
  { name: 'canvas_create_note', description: 'Create a text note', group: 'canvas' },
  { name: 'canvas_pin_selected', description: 'Pin selected shapes', group: 'canvas' },
  { name: 'canvas_unpin_selected', description: 'Unpin selected shapes', group: 'canvas' },
  { name: 'canvas_analyze', description: 'Analyze canvas', group: 'canvas' },
  { name: 'canvas_lock_selected', description: 'Lock selected shapes', group: 'canvas' },
  { name: 'canvas_unlock_selected', description: 'Unlock selected shapes', group: 'canvas' },
  { name: 'canvas_arrange_grid', description: 'Arrange into a grid', group: 'canvas' },
  { name: 'canvas_create_rectangle', description: 'Create rectangle', group: 'canvas' },
  { name: 'canvas_create_ellipse', description: 'Create ellipse', group: 'canvas' },
  { name: 'canvas_align_selected', description: 'Align selected', group: 'canvas' },
  { name: 'canvas_distribute_selected', description: 'Distribute selected', group: 'canvas' },
  { name: 'canvas_draw_smiley', description: 'Draw a smiley', group: 'canvas' },
  { name: 'canvas_toggle_grid', description: 'Toggle grid', group: 'canvas' },
  { name: 'canvas_set_background', description: 'Set background', group: 'canvas' },
  { name: 'canvas_set_theme', description: 'Set theme', group: 'canvas' },
  { name: 'canvas_select', description: 'Select shapes', group: 'canvas' },
];

const LEAN_TOOL_NAMES = new Set<string>([
  'dispatch_to_conductor',
  'create_component',
  'update_component',
  'remove_component',
  'reserve_component',
  'resolve_component',
  'research_search',
  'transcript_search',
  'create_infographic',
  'youtube_search',
  'mcp_tool',
]);

const LEAN_COMPONENT_NAMES = new Set<string>([
  ...Array.from(TIER1_WIDGET_NAMES),
  'OnboardingGuide',
  'ComponentToolbox',
  'WeatherForecast',
  'YoutubeEmbed',
  'ContextFeeder',
  'LivekitRoomConnector',
  'LivekitParticipantTile',
  'LivekitScreenShareTile',
  'LiveCaptions',
]);

const quickManifestHash = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const withManifest = (capabilities: SystemCapabilities): SystemCapabilities => {
  const source = [
    capabilities.capabilityProfile || 'full',
    capabilities.tools.map((tool) => tool.name).join('|'),
    (capabilities.components || []).map((component) => component.name).join('|'),
  ].join('::');
  return {
    ...capabilities,
    manifestVersion: quickManifestHash(source),
    fetchedAt: Date.now(),
  };
};

const mergeTools = (
  defaults: ToolCapability[],
  incoming?: ToolCapability[],
): ToolCapability[] => {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return defaults;
  }
  const map = new Map<string, ToolCapability>();
  defaults.forEach((tool) => map.set(tool.name, tool));
  for (const tool of incoming) {
    if (!tool?.name) continue;
    const existing = map.get(tool.name);
    map.set(tool.name, {
      ...(existing || {}),
      ...tool,
      name: tool.name,
      description: tool.description || existing?.description || `${tool.name} tool`,
    });
  }
  return Array.from(map.values());
};

const mergeComponents = (
  defaults: ComponentCapability[],
  incoming?: ComponentCapability[],
): ComponentCapability[] => {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return defaults;
  }
  const map = new Map<string, ComponentCapability>();
  defaults.forEach((component) => map.set(component.name, component));
  for (const component of incoming) {
    if (!component?.name) continue;
    const existing = map.get(component.name);
    map.set(component.name, {
      ...withComponentMetadata({
        name: component.name,
        description: component.description || existing?.description || `${component.name} component`,
        examples: component.examples || existing?.examples || [],
      }),
      ...(existing || {}),
      ...component,
    });
  }
  return Array.from(map.values());
};

export const resolveCapabilityProfile = (value?: string | null): CapabilityProfile => {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'lean' || normalized === 'lean_adaptive' || normalized === 'adaptive') {
    return 'lean_adaptive';
  }
  return 'full';
};

export const buildCapabilitiesForProfile = (
  profile: CapabilityProfile,
  incoming?: Partial<SystemCapabilities>,
): SystemCapabilities => {
  const mergedTools = mergeTools(ALL_TOOL_CAPABILITIES, incoming?.tools as ToolCapability[] | undefined);
  const mergedComponents = mergeComponents(
    ALL_COMPONENT_CAPABILITIES,
    incoming?.components as ComponentCapability[] | undefined,
  );
  const tools = profile === 'lean_adaptive'
    ? mergedTools.filter((tool) => LEAN_TOOL_NAMES.has(tool.name))
    : mergedTools;
  const components = profile === 'lean_adaptive'
    ? mergedComponents.filter((component) => LEAN_COMPONENT_NAMES.has(component.name))
    : mergedComponents;

  return withManifest({
    tools,
    components,
    capabilityProfile: profile,
    fallbackReason: incoming?.fallbackReason,
  });
};

export const defaultCapabilities: SystemCapabilities = buildCapabilitiesForProfile('full');
export const defaultLeanCapabilities: SystemCapabilities = buildCapabilitiesForProfile('lean_adaptive');

interface QueryCapabilitiesOptions {
  profile?: CapabilityProfile;
  timeoutMs?: number;
}

/** Query system capabilities via LiveKit data channel with fallback to defaults */
export async function queryCapabilities(
  room: RoomLike,
  options: QueryCapabilitiesOptions = {},
): Promise<SystemCapabilities> {
  const profile = options.profile || 'full';
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 3000;

  return await new Promise<SystemCapabilities>((resolve) => {
    let resolved = false;
    const handler = (data: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        if (message?.type === 'capability_list' && message?.capabilities) {
          const responseProfile = resolveCapabilityProfile(
            message?.capabilities?.capabilityProfile || message?.capabilityProfile || profile,
          );
          const merged = buildCapabilitiesForProfile(
            responseProfile,
            message.capabilities as Partial<SystemCapabilities>,
          );
          if (profile === 'lean_adaptive' && merged.tools.length < 6) {
            resolved = true;
            room.off('dataReceived', handler as any);
            resolve({
              ...defaultCapabilities,
              fallbackReason: 'profile_miss',
              fetchedAt: Date.now(),
            });
            return;
          }
          resolved = true;
          room.off('dataReceived', handler as any);
          resolve(merged);
        }
      } catch {
        // ignore
      }
    };
    room.on('dataReceived', handler as any);

    // Send query
    try {
      const queryMessage = JSON.stringify({
        type: 'capability_query',
        timestamp: Date.now(),
        capabilityProfile: profile,
      });
      room.localParticipant?.publishData(new TextEncoder().encode(queryMessage), {
        reliable: true,
        topic: 'capability_query',
      });
    } catch {
      resolve({
        ...defaultCapabilities,
        fallbackReason: 'error',
        fetchedAt: Date.now(),
      });
      return;
    }

    // Fallback after timeout. For lean profile we fail open into full profile for parity.
    setTimeout(() => {
      if (!resolved) {
        room.off('dataReceived', handler as any);
        resolve({
          ...defaultCapabilities,
          fallbackReason: 'timeout',
          fetchedAt: Date.now(),
        });
      }
    }, timeoutMs);
  });
}
