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
  ];

export const defaultCapabilities: SystemCapabilities = {
  tools: [
    { name: 'create_component', description: 'Create a UI component', examples: ['create a timer', 'show kanban board'] },
    { name: 'update_component', description: 'Update component via instruction delegation', examples: ['move task to done', 'set timer to 5 minutes'] },
    { name: 'dispatch_to_conductor', description: 'Route to domain steward (canvas, flowchart, scorecard)', examples: ['draw a shape', 'create flowchart'] },
    { name: 'youtube_search', description: 'Search YouTube videos', examples: ['search youtube for cats'] },
    { name: 'web_search', description: 'Search the web', examples: ['search for latest news'] },
    { name: 'list_components', description: 'List all active components and their IDs' },
    { name: 'promote_component_content', description: 'Promote widget content onto the canvas' },
  ],
  decisionEngine: {
    intents: {
      canvas_drawing: ['draw', 'sketch', 'shape', 'rectangle', 'circle', 'arrow', 'line', 'sticky', 'note'],
      canvas_layout: ['align', 'arrange', 'grid', 'distribute', 'group', 'zoom', 'focus', 'pan', 'center'],
      canvas_style: ['color', 'fill', 'stroke', 'font', 'style', 'theme', 'background'],
      component_creation: ['create', 'make', 'generate', 'show', 'display', 'build', 'add'],
      component_update: ['update', 'change', 'modify', 'set', 'move', 'pause', 'start', 'stop'],
      youtube_search: ['youtube', 'video', 'play', 'watch', 'search youtube'],
      web_search: ['search', 'find', 'look up', 'research'],
      debate_scoring: ['debate', 'scorecard', 'fact check', 'argument', 'claim'],
    },
    keywords: {
      timer_related: ['timer', 'countdown', 'minutes', 'seconds', 'alarm', 'stopwatch'],
      kanban_related: ['kanban', 'board', 'task', 'issue', 'linear', 'project'],
      infographic_related: ['infographic', 'visualize', 'chart', 'diagram', 'summary'],
      research_related: ['research', 'study', 'analysis', 'findings', 'results'],
      captions_related: ['captions', 'subtitles', 'transcription', 'live text'],
      youtube_related: ['youtube', 'video', 'embed', 'watch'],
      canvas_related: ['draw', 'shape', 'rectangle', 'circle', 'arrow', 'align', 'arrange', 'grid', 'zoom', 'focus'],
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
