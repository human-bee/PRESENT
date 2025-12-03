/**
 * Widget Capability Manifest
 * 
 * Documents what each widget can do, used for:
 * 1. Voice agent instruction generation
 * 2. User help text
 * 3. Steward understanding of widget capabilities
 */

export interface WidgetCapability {
  /** Component type name (must match componentType in ComponentRegistry) */
  componentType: string;
  /** Human-readable description */
  description: string;
  /** List of capabilities the widget supports */
  canDo: string[];
  /** Keywords that trigger this widget */
  triggerKeywords: string[];
  /** Example voice commands */
  exampleCommands: string[];
  /** Whether the widget supports instruction delegation */
  supportsInstructionDelegation: boolean;
  /** API steward endpoint if widget uses server-side reasoning */
  stewardEndpoint?: string;
}

export const widgetCapabilities: Record<string, WidgetCapability> = {
  RetroTimerEnhanced: {
    componentType: 'RetroTimerEnhanced',
    description: 'Countdown timer with voice control',
    canDo: [
      'start timer',
      'pause timer',
      'reset timer',
      'add time',
      'set duration',
    ],
    triggerKeywords: ['timer', 'countdown', 'stopwatch', 'minutes', 'seconds', 'alarm'],
    exampleCommands: [
      'start a 5 minute timer',
      'pause the timer',
      'add 2 more minutes',
      'reset the timer',
      'set timer to 10 minutes',
    ],
    supportsInstructionDelegation: true,
  },

  LinearKanbanBoard: {
    componentType: 'LinearKanbanBoard',
    description: 'Kanban board with Linear integration for task management',
    canDo: [
      'move issues between statuses',
      'create new issues',
      'assign users to issues',
      'search issues',
      'filter by status',
    ],
    triggerKeywords: ['kanban', 'board', 'task', 'issue', 'linear', 'project', 'ticket'],
    exampleCommands: [
      'show my linear tasks',
      'move Fix Bug to Done',
      'create a new issue for login feature',
      'assign the ticket to Alice',
    ],
    supportsInstructionDelegation: true,
    stewardEndpoint: '/api/ai/linear-steward',
  },

  InfographicWidget: {
    componentType: 'InfographicWidget',
    description: 'AI-powered infographic generator from conversation context',
    canDo: [
      'generate infographic',
      'visualize discussion',
      'create chart summary',
      'regenerate with new context',
    ],
    triggerKeywords: ['infographic', 'visualize', 'chart', 'diagram', 'summary', 'visual'],
    exampleCommands: [
      'create an infographic',
      'visualize our discussion',
      'generate a new infographic',
      'make a chart summary',
    ],
    supportsInstructionDelegation: true,
  },

  ResearchPanel: {
    componentType: 'ResearchPanel',
    description: 'Research results display with credibility filtering',
    canDo: [
      'display search results',
      'filter by credibility',
      'bookmark results',
      'change topic',
      'toggle live mode',
    ],
    triggerKeywords: ['research', 'search', 'find', 'look up', 'results', 'findings'],
    exampleCommands: [
      'show research panel',
      'search for climate change',
      'find information about AI',
      'show 5 results',
    ],
    supportsInstructionDelegation: true,
  },

  DebateScorecard: {
    componentType: 'DebateScorecard',
    description: 'Real-time debate tracking and scoring',
    canDo: [
      'track arguments',
      'score claims',
      'fact check statements',
      'display debate timeline',
    ],
    triggerKeywords: ['debate', 'scorecard', 'argument', 'claim', 'fact check', 'score'],
    exampleCommands: [
      'start debate tracking',
      'fact check that claim',
      'show the scorecard',
      'add a new argument',
    ],
    supportsInstructionDelegation: true,
    stewardEndpoint: 'dispatch_to_conductor:scorecard.*',
  },

  LiveCaptions: {
    componentType: 'LiveCaptions',
    description: 'Live transcription and captions display',
    canDo: [
      'show live captions',
      'display transcription',
    ],
    triggerKeywords: ['captions', 'subtitles', 'transcription', 'live text'],
    exampleCommands: [
      'turn on captions',
      'show live captions',
      'enable transcription',
    ],
    supportsInstructionDelegation: false,
  },

  YoutubeEmbed: {
    componentType: 'YoutubeEmbed',
    description: 'Embedded YouTube video player',
    canDo: [
      'embed video',
      'play video',
    ],
    triggerKeywords: ['youtube', 'video', 'embed', 'watch', 'play'],
    exampleCommands: [
      'embed a youtube video',
      'play this video',
      'show youtube video',
    ],
    supportsInstructionDelegation: false,
  },

  WeatherForecast: {
    componentType: 'WeatherForecast',
    description: 'Weather forecast display',
    canDo: [
      'show current weather',
      'display forecast',
      'change location',
    ],
    triggerKeywords: ['weather', 'forecast', 'temperature', 'climate', 'rain', 'sunny'],
    exampleCommands: [
      'show the weather',
      'what is the forecast',
      'weather in San Francisco',
    ],
    supportsInstructionDelegation: true,
  },

  AIImageGenerator: {
    componentType: 'AIImageGenerator',
    description: 'AI-powered image generation',
    canDo: [
      'generate image',
      'create illustration',
      'regenerate with new prompt',
    ],
    triggerKeywords: ['image', 'picture', 'illustration', 'generate image', 'ai image'],
    exampleCommands: [
      'generate an image of a sunset',
      'create a picture of a cat',
      'make an illustration',
    ],
    supportsInstructionDelegation: true,
  },

  DocumentEditor: {
    componentType: 'DocumentEditor',
    description: 'Collaborative document editor',
    canDo: [
      'edit document',
      'update content',
      'collaborative editing',
    ],
    triggerKeywords: ['document', 'editor', 'doc', 'write', 'edit'],
    exampleCommands: [
      'create a document',
      'edit the document',
      'update the content',
    ],
    supportsInstructionDelegation: true,
  },

  ActionItemTracker: {
    componentType: 'ActionItemTracker',
    description: 'Action item and todo list manager',
    canDo: [
      'track action items',
      'create todos',
      'mark complete',
      'assign items',
    ],
    triggerKeywords: ['action item', 'todo', 'task', 'checklist', 'action'],
    exampleCommands: [
      'create a todo list',
      'add action item',
      'track action items',
    ],
    supportsInstructionDelegation: true,
  },
};

/**
 * Get widget capability by component type
 */
export function getWidgetCapability(componentType: string): WidgetCapability | undefined {
  return widgetCapabilities[componentType];
}

/**
 * Get all widgets that support instruction delegation
 */
export function getInstructionDelegationWidgets(): WidgetCapability[] {
  return Object.values(widgetCapabilities).filter(w => w.supportsInstructionDelegation);
}

/**
 * Find matching widget by keyword
 */
export function findWidgetByKeyword(keyword: string): WidgetCapability | undefined {
  const lower = keyword.toLowerCase();
  return Object.values(widgetCapabilities).find(w => 
    w.triggerKeywords.some(k => lower.includes(k) || k.includes(lower))
  );
}

/**
 * Generate component type hint text for voice agent instructions
 */
export function generateComponentHints(): string {
  return Object.values(widgetCapabilities)
    .map(w => `- "${w.triggerKeywords.slice(0, 3).join('", "')}" -> ${w.componentType}`)
    .join('\n');
}
