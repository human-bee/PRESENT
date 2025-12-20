'use client';

// Define interface for component size information
export interface ComponentSizeInfo {
  naturalWidth: number;
  naturalHeight: number;
  minWidth: number;
  minHeight: number;
  aspectRatio?: number; // Optional for components that need to maintain ratio
  preferredSize?: { width: number; height: number }; // For responsive defaults
  resizeMode?: 'free' | 'aspect-locked' | 'fixed'; // Control resize behavior
  sizingPolicy?: 'always_fit' | 'fit_until_user_resize' | 'scale_only'; // Auto-fit behavior for dynamic content
}

// Size metadata for each component - based on UI design and content needs
export const componentSizeInfo: Record<string, ComponentSizeInfo> = {
  WeatherForecast: {
    naturalWidth: 350,
    naturalHeight: 450, // Increased to show full weather content
    minWidth: 200,
    minHeight: 250,
    resizeMode: 'free',
    sizingPolicy: 'fit_until_user_resize',
  },
  YouTubeEmbed: {
    naturalWidth: 640,
    naturalHeight: 360,
    minWidth: 320,
    minHeight: 180,
    aspectRatio: 16 / 9,
    resizeMode: 'aspect-locked',
    sizingPolicy: 'fit_until_user_resize',
  },
  // Alias: component registry uses "YoutubeEmbed" (lowercase 't')
  YoutubeEmbed: {
    naturalWidth: 640,
    naturalHeight: 360,
    minWidth: 320,
    minHeight: 180,
    aspectRatio: 16 / 9,
    resizeMode: 'aspect-locked',
    sizingPolicy: 'fit_until_user_resize',
  },
  RetroTimer: {
    naturalWidth: 280,
    naturalHeight: 380, // Taller for full timer display with presets
    minWidth: 200,
    minHeight: 240,
    resizeMode: 'free',
    sizingPolicy: 'fit_until_user_resize',
  },
  RetroTimerEnhanced: {
    naturalWidth: 280,
    naturalHeight: 380, // Includes preset buttons and status text
    minWidth: 200,
    minHeight: 240,
    resizeMode: 'free',
    sizingPolicy: 'fit_until_user_resize', // Auto-fit to actual content
  },
  ParticipantTile: {
    naturalWidth: 320,
    naturalHeight: 240,
    minWidth: 160,
    minHeight: 120,
    aspectRatio: 4 / 3,
    resizeMode: 'aspect-locked',
    sizingPolicy: 'fit_until_user_resize',
  },
  LivekitParticipantTile: {
    naturalWidth: 320,
    naturalHeight: 240,
    minWidth: 160,
    minHeight: 120,
    aspectRatio: 4 / 3,
    resizeMode: 'aspect-locked',
    sizingPolicy: 'fit_until_user_resize',
  },
  LivekitRoomConnector: {
    naturalWidth: 400,
    naturalHeight: 300,
    minWidth: 300,
    minHeight: 200,
    resizeMode: 'free',
    sizingPolicy: 'scale_only',
  },
  LivekitScreenShareTile: {
    naturalWidth: 640,
    naturalHeight: 360,
    minWidth: 320,
    minHeight: 180,
    aspectRatio: 16 / 9,
    resizeMode: 'aspect-locked',
    sizingPolicy: 'fit_until_user_resize',
  },
  LiveCaptions: {
    naturalWidth: 500,
    naturalHeight: 400,
    minWidth: 300,
    minHeight: 250,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // Captions list grows dynamically
  },
  DocumentEditor: {
    naturalWidth: 700,
    naturalHeight: 1100,
    minWidth: 500,
    minHeight: 700,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // Document content varies significantly
  },
  LinearKanbanBoard: {
    naturalWidth: 1200, // Wider to show all columns
    naturalHeight: 600,
    minWidth: 800,
    minHeight: 400,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // Dynamic tasks/columns
  },
  ActionItemTracker: {
    naturalWidth: 500,
    naturalHeight: 600,
    minWidth: 350,
    minHeight: 400,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // List of items grows dynamically
  },
  ResearchPanel: {
    naturalWidth: 600,
    naturalHeight: 700,
    minWidth: 400,
    minHeight: 500,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // Search results vary
  },
  AIImageGenerator: {
    naturalWidth: 800,
    naturalHeight: 600,
    minWidth: 600,
    minHeight: 400,
    resizeMode: 'free',
    sizingPolicy: 'fit_until_user_resize',
  },
  OnboardingGuide: {
    naturalWidth: 500,
    naturalHeight: 600,
    minWidth: 400,
    minHeight: 500,
    resizeMode: 'free',
    sizingPolicy: 'scale_only',
  },
  ComponentToolbox: {
    naturalWidth: 300,
    naturalHeight: 400,
    minWidth: 200,
    minHeight: 300,
    resizeMode: 'free',
    sizingPolicy: 'scale_only',
  },
  ContextFeeder: {
    naturalWidth: 420,
    naturalHeight: 520,
    minWidth: 320,
    minHeight: 360,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // Context items vary dynamically
  },
  DebateScorecard: {
    naturalWidth: 1200,
    naturalHeight: 675, // 16:9 landscape layout
    minWidth: 800,
    minHeight: 450,
    aspectRatio: 16 / 9,
    resizeMode: 'free', // Allow free resize but prefer landscape
    sizingPolicy: 'always_fit', // Always adapt to dynamic content
  },
  InfographicWidget: {
    naturalWidth: 400,
    naturalHeight: 500,
    minWidth: 300,
    minHeight: 350,
    resizeMode: 'free',
    sizingPolicy: 'always_fit', // Generated images vary in size
  },
  // Default fallback for unregistered components
  Default: {
    naturalWidth: 300,
    naturalHeight: 200,
    minWidth: 100,
    minHeight: 50,
    resizeMode: 'free',
    sizingPolicy: 'fit_until_user_resize',
  },
};

// Function to get size info with fallback
export function getComponentSizeInfo(componentName: string): ComponentSizeInfo {
  return componentSizeInfo[componentName] || componentSizeInfo.Default;
}

// Helper to calculate initial size based on viewport or defaults
export function calculateInitialSize(
  componentName: string,
  viewport?: { width: number; height: number },
) {
  const info = getComponentSizeInfo(componentName);

  if (viewport) {
    // Scale to 40% of viewport or natural size, whichever is smaller
    const maxWidth = Math.min(info.naturalWidth, viewport.width * 0.4);
    const maxHeight = Math.min(info.naturalHeight, viewport.height * 0.4);

    if (info.aspectRatio) {
      const ratio = info.aspectRatio;
      return ratio > 1
        ? { w: maxWidth, h: maxWidth / ratio }
        : { w: maxHeight * ratio, h: maxHeight };
    }
    return { w: maxWidth, h: maxHeight };
  }

  return {
    w: info.naturalWidth,
    h: info.naturalHeight,
  };
}
