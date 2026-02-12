export type CapabilityProfile = 'full' | 'lean_adaptive';

export type WidgetTier = 'tier1' | 'tier2';
export type WidgetGroup =
  | 'productivity'
  | 'research'
  | 'integration'
  | 'documents'
  | 'media'
  | 'utility'
  | 'other';
export type WidgetLifecycleOp =
  | 'create'
  | 'resolve'
  | 'hydrate'
  | 'fill'
  | 'edit'
  | 'update'
  | 'remove'
  | 'recover';

export type WidgetLifecycleMetadata = {
  tier: WidgetTier;
  group: WidgetGroup;
  lifecycleOps: WidgetLifecycleOp[];
  critical: boolean;
};

export const DEFAULT_WIDGET_LIFECYCLE_OPS: WidgetLifecycleOp[] = [
  'create',
  'resolve',
  'hydrate',
  'fill',
  'edit',
  'update',
  'remove',
  'recover',
];

const tier1Ops = DEFAULT_WIDGET_LIFECYCLE_OPS;
const tier2Ops: WidgetLifecycleOp[] = ['create', 'resolve', 'hydrate', 'update', 'remove'];

const mapWithDefaultOps = (
  map: Record<string, Omit<WidgetLifecycleMetadata, 'lifecycleOps'> & { lifecycleOps?: WidgetLifecycleOp[] }>,
): Record<string, WidgetLifecycleMetadata> =>
  Object.fromEntries(
    Object.entries(map).map(([name, value]) => [
      name,
      {
        tier: value.tier,
        group: value.group,
        critical: value.critical,
        lifecycleOps: value.lifecycleOps ?? (value.tier === 'tier1' ? tier1Ops : tier2Ops),
      },
    ]),
  );

export const WIDGET_LIFECYCLE_MANIFEST: Record<string, WidgetLifecycleMetadata> =
  mapWithDefaultOps({
    // Productivity (Tier 1)
    RetroTimerEnhanced: { tier: 'tier1', group: 'productivity', critical: true },
    ActionItemTracker: { tier: 'tier1', group: 'productivity', critical: true },
    LinearKanbanBoard: { tier: 'tier1', group: 'productivity', critical: true },
    CrowdPulseWidget: { tier: 'tier1', group: 'productivity', critical: true },

    // Research (Tier 1)
    ResearchPanel: { tier: 'tier1', group: 'research', critical: true },
    MeetingSummaryWidget: { tier: 'tier1', group: 'research', critical: true },
    MemoryRecallWidget: { tier: 'tier1', group: 'research', critical: true },
    InfographicWidget: { tier: 'tier1', group: 'research', critical: true },

    // Integration (Tier 1)
    McpAppWidget: { tier: 'tier1', group: 'integration', critical: true },
    LivekitRoomConnector: { tier: 'tier1', group: 'integration', critical: true },
    LivekitParticipantTile: { tier: 'tier1', group: 'integration', critical: true },
    LivekitScreenShareTile: { tier: 'tier1', group: 'integration', critical: true },

    // Tier 2
    YoutubeEmbed: { tier: 'tier2', group: 'media', critical: false },
    YoutubeSearchEnhanced: { tier: 'tier2', group: 'media', critical: false },
    WeatherForecast: { tier: 'tier2', group: 'other', critical: false },
    RetroTimer: { tier: 'tier2', group: 'productivity', critical: false },
    DocumentEditor: { tier: 'tier2', group: 'documents', critical: false },
    LiveCaptions: { tier: 'tier2', group: 'integration', critical: false },
    OnboardingGuide: { tier: 'tier2', group: 'utility', critical: false },
    ComponentToolbox: { tier: 'tier2', group: 'utility', critical: false },
    DebateScorecard: { tier: 'tier2', group: 'research', critical: false },
    ContextFeeder: { tier: 'tier2', group: 'documents', critical: false },
  });

const normalizeName = (name: string) => name.trim();

export const getWidgetLifecycleMetadata = (
  componentName: string | null | undefined,
): WidgetLifecycleMetadata | undefined => {
  if (typeof componentName !== 'string') return undefined;
  const normalized = normalizeName(componentName);
  if (!normalized) return undefined;
  return WIDGET_LIFECYCLE_MANIFEST[normalized];
};

export const isTier1Widget = (componentName: string | null | undefined): boolean =>
  getWidgetLifecycleMetadata(componentName)?.tier === 'tier1';

