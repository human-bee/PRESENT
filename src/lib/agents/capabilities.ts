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
    { name: 'YoutubeEmbed', description: 'Embed a YouTube video by ID', examples: ['show video', 'embed youtube'] },
    { name: 'WeatherForecast', description: 'Display weather forecast data', examples: ['show weather', "what's the weather"] },
    { name: 'RetroTimer', description: 'Retro countdown timer', examples: ['set a timer', 'start countdown'] },
    { name: 'RetroTimerEnhanced', description: 'Enhanced timer with AI updates', examples: ['advanced timer', 'smart countdown'] },
    { name: 'DocumentEditor', description: 'Collaborative editor with AI updates', examples: ['edit document', 'create doc'] },
    { name: 'ResearchPanel', description: 'Research results panel', examples: ['show research', 'display findings'] },
    { name: 'ActionItemTracker', description: 'Action item manager', examples: ['track action items', 'create todo list'] },
    { name: 'LivekitRoomConnector', description: 'Connect to LiveKit room', examples: ['connect to room'] },
    { name: 'LivekitParticipantTile', description: 'Participant video/audio tile', examples: ['show participant video'] },
    { name: 'AIImageGenerator', description: 'Real-time AI image generator', examples: ['generate an image'] },
    { name: 'LiveCaptions', description: 'Live captions component', examples: ['show live captions'] },
    { name: 'DebateScorecard', description: 'Real-time debate scorecard', examples: ['show debate scorecard'] },
    { name: 'LinearKanbanBoard', description: 'Kanban board with Linear integration', examples: ['create kanban board', 'show tasks'] },
    { name: 'InfographicWidget', description: 'AI-powered infographic generator', examples: ['create infographic', 'visualize conversation'] },
    { name: 'ContextFeeder', description: 'Upload/paste docs to inject context into stewards', examples: ['add a context feeder', 'upload context'] },
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
      ui_generation: ['create', 'make', 'generate', 'show', 'display', 'build'],
      youtube_search: ['youtube', 'video', 'play', 'watch', 'search youtube'],
      timer: ['timer', 'countdown', 'alarm', 'stopwatch', 'time'],
      weather: ['weather', 'forecast', 'temperature', 'climate'],
      research: ['research', 'findings', 'results', 'analysis'],
      action_items: ['todo', 'task', 'action item', 'checklist'],
      image_generation: ['image', 'picture', 'illustration', 'generate image'],
      infographic: ['infographic', 'chart', 'diagram', 'visualize'],
      captions: ['captions', 'subtitles', 'transcription', 'live text'],
      canvas_control: ['zoom', 'focus', 'pan', 'center', 'pin', 'unpin', 'note', 'arrange'],
    },
    keywords: {
      timer_related: ['timer', 'countdown', 'minutes', 'seconds', 'alarm'],
      youtube_related: ['youtube', 'video', 'play', 'watch', 'embed'],
      weather_related: ['weather', 'forecast', 'temperature', 'rain', 'sunny'],
      ui_related: ['create', 'make', 'show', 'display', 'component'],
      research_related: ['research', 'study', 'analysis', 'findings'],
      task_related: ['todo', 'task', 'action', 'checklist', 'manage'],
      canvas_related: ['zoom', 'focus', 'pan', 'center', 'pin', 'unpin', 'note', 'arrange', 'grid'],
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
