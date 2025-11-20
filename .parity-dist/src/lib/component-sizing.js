'use client';
// Size metadata for each component - based on UI design and content needs
export const componentSizeInfo = {
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
    RetroTimer: {
        naturalWidth: 280,
        naturalHeight: 320, // Taller for full timer display
        minWidth: 200,
        minHeight: 240,
        resizeMode: 'free',
        sizingPolicy: 'scale_only',
    },
    RetroTimerEnhanced: {
        naturalWidth: 280,
        naturalHeight: 320,
        minWidth: 200,
        minHeight: 240,
        resizeMode: 'free',
        sizingPolicy: 'scale_only',
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
    DocumentEditor: {
        naturalWidth: 600,
        naturalHeight: 500,
        minWidth: 400,
        minHeight: 300,
        resizeMode: 'free',
        sizingPolicy: 'fit_until_user_resize',
    },
    LinearKanbanBoard: {
        naturalWidth: 1200, // Wider to show all columns
        naturalHeight: 600,
        minWidth: 800,
        minHeight: 400,
        resizeMode: 'free',
        sizingPolicy: 'always_fit', // dynamic content grows/shrinks with board
    },
    ActionItemTracker: {
        naturalWidth: 500,
        naturalHeight: 600,
        minWidth: 350,
        minHeight: 400,
        resizeMode: 'free',
        sizingPolicy: 'fit_until_user_resize',
    },
    ResearchPanel: {
        naturalWidth: 600,
        naturalHeight: 700,
        minWidth: 400,
        minHeight: 500,
        resizeMode: 'free',
        sizingPolicy: 'fit_until_user_resize',
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
    DebateScorecard: {
        naturalWidth: 960,
        naturalHeight: 540,
        minWidth: 720,
        minHeight: 405,
        aspectRatio: 16 / 9,
        resizeMode: 'aspect-locked',
        sizingPolicy: 'fit_until_user_resize',
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
export function getComponentSizeInfo(componentName) {
    return componentSizeInfo[componentName] || componentSizeInfo.Default;
}
// Helper to calculate initial size based on viewport or defaults
export function calculateInitialSize(componentName, viewport) {
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
//# sourceMappingURL=component-sizing.js.map