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

export interface SystemCapabilities {
  tools: Array<{ name: string; description: string; examples?: string[] }>;
  decisionEngine: {
    intents: Record<string, string[]>;
    keywords: Record<string, string[]>;
  };
  components?: Array<{ name: string; description: string; examples?: string[] }>;
}

export const defaultCustomComponents: Array<{
  name: string;
  description: string;
  examples?: string[];
}> = [
    // Video/Media
    { name: 'YoutubeEmbed', description: 'Embed a YouTube video by ID', examples: ['embed youtube video', 'show youtube', 'play video'] },
    
    // Productivity
    { name: 'RetroTimer', description: 'Retro countdown timer', examples: ['create timer', 'set a timer', 'start countdown'] },
    { name: 'RetroTimerEnhanced', description: 'Enhanced timer with AI updates', examples: ['create a 5 minute timer', 'add timer', 'start a timer'] },
    { name: 'ActionItemTracker', description: 'Action item manager', examples: ['create action items', 'add todo list', 'track tasks', 'create task tracker'] },
    { name: 'LinearKanbanBoard', description: 'Kanban board with Linear integration', examples: ['create kanban board', 'show kanban', 'add kanban', 'task board'] },
    
    // Documents & Research
    { name: 'DocumentEditor', description: 'Collaborative document editor', examples: ['create document', 'add document editor', 'create doc', 'new document'] },
    { name: 'ResearchPanel', description: 'Research results panel', examples: ['create research panel', 'show research', 'add research'] },
    { name: 'ContextFeeder', description: 'Upload/paste docs to inject context into stewards', examples: ['add context feeder', 'upload context', 'create context feeder'] },
    
    // LiveKit/Video
    { name: 'LivekitRoomConnector', description: 'Connect to LiveKit room', examples: ['create room connector', 'connect to room', 'add room connector'] },
    { name: 'LivekitParticipantTile', description: 'Participant video/audio tile', examples: ['create participant tile', 'add participant tile', 'show participant', 'add video tile'] },
    { name: 'LivekitScreenShareTile', description: 'Screen share display tile', examples: ['create screen share tile', 'add screen share', 'show screen share'] },
    { name: 'LiveCaptions', description: 'Live captions/transcription display', examples: ['show live captions', 'turn on captions', 'add captions', 'create captions'] },
    
    // Data & Visualization
    { name: 'WeatherForecast', description: 'Display weather forecast', examples: ['show weather', 'create weather widget', 'add weather'] },
    { name: 'DebateScorecard', description: 'Real-time debate scorecard', examples: ['create debate scorecard', 'start debate', 'add scorecard'] },
    { name: 'InfographicWidget', description: 'AI-powered infographic generator', examples: ['create infographic', 'generate infographic', 'visualize conversation'] },
    
    // Utility
    { name: 'OnboardingGuide', description: 'Interactive onboarding/help guide', examples: ['show help', 'create onboarding guide', 'how do I use this'] },
    { name: 'ComponentToolbox', description: 'Draggable toolbox of all components', examples: ['show component toolbox', 'add toolbox', 'create toolbox'] },
  ];

export const defaultCapabilities: SystemCapabilities = {
  tools: [
    { name: 'create_component', description: 'Create a UI component', examples: ['create a timer', 'show weather'] },
    { name: 'youtube_search', description: 'Search YouTube videos', examples: ['search youtube for cats'] },
    { name: 'mcp_tool', description: 'Call an MCP tool by name', examples: ['mcp weather', 'mcp searchVideos'] },
    { name: 'update_component', description: 'Update existing UI components', examples: ['update timer to 10 minutes'] },
    { name: 'list_components', description: 'List all components and their IDs' },
    { name: 'web_search', description: 'Search the web' },
    { name: 'create_infographic', description: 'Generate an infographic' },
    { name: 'promote_component_content', description: 'Promote a component item onto the canvas' },
    { name: 'respond_with_voice', description: 'Send a text response (voice disabled)' },
    // Canvas tools
    { name: 'canvas_focus', description: 'Focus/zoom camera' },
    { name: 'canvas_zoom_all', description: 'Zoom to fit all shapes' },
    { name: 'canvas_create_note', description: 'Create a text note' },
    { name: 'canvas_pin_selected', description: 'Pin selected shapes' },
    { name: 'canvas_unpin_selected', description: 'Unpin selected shapes' },
    { name: 'canvas_analyze', description: 'Analyze canvas' },
    { name: 'canvas_lock_selected', description: 'Lock selected shapes' },
    { name: 'canvas_unlock_selected', description: 'Unlock selected shapes' },
    { name: 'canvas_arrange_grid', description: 'Arrange into a grid' },
    { name: 'canvas_create_rectangle', description: 'Create rectangle' },
    { name: 'canvas_create_ellipse', description: 'Create ellipse' },
    { name: 'canvas_align_selected', description: 'Align selected' },
    { name: 'canvas_distribute_selected', description: 'Distribute selected' },
    { name: 'canvas_draw_smiley', description: 'Draw a smiley' },
    { name: 'canvas_toggle_grid', description: 'Toggle grid' },
    { name: 'canvas_set_background', description: 'Set background' },
    { name: 'canvas_set_theme', description: 'Set theme' },
    { name: 'canvas_select', description: 'Select shapes' },
  ],
  decisionEngine: {
    intents: {
      ui_generation: ['create', 'make', 'generate', 'show', 'display', 'build', 'add'],
      youtube_search: ['youtube', 'video', 'play', 'watch', 'search youtube'],
      timer: ['timer', 'countdown', 'alarm', 'stopwatch', 'time'],
      weather: ['weather', 'forecast', 'temperature', 'climate'],
      research: ['research', 'findings', 'results', 'analysis'],
      action_items: ['todo', 'task', 'action item', 'checklist', 'action items'],
      image_generation: ['image', 'picture', 'illustration', 'generate image'],
      infographic: ['infographic', 'chart', 'visualize'],
      captions: ['captions', 'subtitles', 'transcription', 'live text'],
      canvas_control: ['zoom', 'focus', 'pan', 'center', 'pin', 'unpin', 'note', 'arrange'],
      participant: ['participant', 'participant tile', 'video tile'],
      kanban: ['kanban', 'kanban board', 'task board'],
      document: ['document', 'doc', 'editor'],
      screen_share: ['screen share', 'screenshare', 'share screen'],
      context: ['context', 'context feeder', 'upload context'],
      help: ['help', 'onboarding', 'how do I'],
    },
    keywords: {
      timer_related: ['timer', 'countdown', 'minutes', 'seconds', 'alarm'],
      youtube_related: ['youtube', 'video', 'play', 'watch', 'embed'],
      weather_related: ['weather', 'forecast', 'temperature', 'rain', 'sunny'],
      ui_related: ['create', 'make', 'show', 'display', 'component', 'add', 'tile', 'widget'],
      research_related: ['research', 'study', 'analysis', 'findings'],
      task_related: ['todo', 'task', 'action', 'checklist', 'manage', 'kanban', 'board'],
      canvas_related: ['zoom', 'focus', 'pan', 'center', 'pin', 'unpin', 'note', 'arrange', 'grid'],
      livekit_related: ['participant', 'tile', 'video', 'room', 'connector', 'screen share'],
      document_related: ['document', 'doc', 'editor', 'write'],
    },
  },
  components: defaultCustomComponents,
};

/** Query system capabilities via LiveKit data channel with fallback to defaults */
export async function queryCapabilities(room: RoomLike): Promise<SystemCapabilities> {
  return await new Promise<SystemCapabilities>((resolve) => {
    let resolved = false;
    const handler = (data: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        if (message?.type === 'capability_list' && message?.capabilities) {
          resolved = true;
          room.off('dataReceived', handler as any);
          resolve(message.capabilities as SystemCapabilities);
        }
      } catch {
        // ignore
      }
    };
    room.on('dataReceived', handler as any);

    // Send query
    try {
      const queryMessage = JSON.stringify({ type: 'capability_query', timestamp: Date.now() });
      room.localParticipant?.publishData(new TextEncoder().encode(queryMessage), {
        reliable: true,
        topic: 'capability_query',
      });
    } catch { }

    // Fallback after 5s
    setTimeout(() => {
      if (!resolved) {
        room.off('dataReceived', handler as any);
        resolve(defaultCapabilities);
      }
    }, 5000);
  });
}
