import {
  DEFAULT_WIDGET_LIFECYCLE_OPS,
  WIDGET_LIFECYCLE_MANIFEST,
  getWidgetLifecycleMetadata,
  isTier1Widget,
} from './widget-lifecycle-manifest';

const REQUIRED_TIER1_WIDGETS = [
  'RetroTimerEnhanced',
  'ActionItemTracker',
  'LinearKanbanBoard',
  'CrowdPulseWidget',
  'ResearchPanel',
  'MeetingSummaryWidget',
  'MemoryRecallWidget',
  'InfographicWidget',
  'McpAppWidget',
  'LivekitRoomConnector',
  'LivekitParticipantTile',
  'LivekitScreenShareTile',
];

describe('widget lifecycle manifest', () => {
  it('includes full lifecycle coverage for all Tier-1 widgets', () => {
    for (const widgetName of REQUIRED_TIER1_WIDGETS) {
      const metadata = getWidgetLifecycleMetadata(widgetName);
      expect(metadata).toBeDefined();
      expect(metadata?.tier).toBe('tier1');
      expect(metadata?.critical).toBe(true);
      expect(metadata?.lifecycleOps).toEqual(DEFAULT_WIDGET_LIFECYCLE_OPS);
    }
  });

  it('marks known Tier-1 widgets as Tier-1 and non-listed widgets as non-Tier-1', () => {
    expect(isTier1Widget('CrowdPulseWidget')).toBe(true);
    expect(isTier1Widget('ResearchPanel')).toBe(true);
    expect(isTier1Widget('OnboardingGuide')).toBe(false);
    expect(isTier1Widget('UnknownWidget')).toBe(false);
  });

  it('retains group metadata for routing specialists', () => {
    expect(WIDGET_LIFECYCLE_MANIFEST.CrowdPulseWidget?.group).toBe('productivity');
    expect(WIDGET_LIFECYCLE_MANIFEST.ResearchPanel?.group).toBe('research');
    expect(WIDGET_LIFECYCLE_MANIFEST.McpAppWidget?.group).toBe('integration');
  });
});

