jest.mock('@/lib/agents/shared/supabase-context', () => ({
  broadcastToolCall: jest.fn(),
  commitTimelineDocument: jest.fn(),
  getTimelineDocument: jest.fn(),
}));

jest.mock('@/lib/agents/subagents/timeline-steward-fast', () => ({
  runTimelineStewardFast: jest.fn(),
}));

jest.mock('@/lib/agents/subagents/timeline-turn-resolver', () => ({
  resolveTimelineTurn: jest.fn(),
}));

import { buildTimelineWidgetPatch } from '@/lib/agents/timeline-task-runner';

describe('buildTimelineWidgetPatch', () => {
  it('publishes timeline sizing hints for the MCP widget host', () => {
    const patch = buildTimelineWidgetPatch({
      room: 'canvas-room',
      componentId: 'timeline-widget-1',
      document: {
        componentId: 'timeline-widget-1',
        title: 'Launch Roadmap',
        subtitle: 'Ship the release.',
        horizonLabel: 'Sprint 1',
        lanes: [
          { id: 'lane-product', name: 'Product', kind: 'team', order: 0 },
          { id: 'lane-engineering', name: 'Engineering', kind: 'team', order: 1 },
        ],
        items: [
          { id: 'item-1', laneId: 'lane-product', title: 'Approve brief', type: 'milestone', status: 'planned', order: 0 },
          { id: 'item-2', laneId: 'lane-engineering', title: 'Cut master', type: 'task', status: 'in_progress', order: 1 },
        ],
        dependencies: [
          { id: 'dep-1', fromItemId: 'item-1', toItemId: 'item-2', kind: 'dependency' },
        ],
        events: [],
        sync: { status: 'live', pendingExports: [] },
        version: 3,
        lastUpdated: Date.now(),
      },
    });

    expect(patch.preferredWidth).toEqual(expect.any(Number));
    expect(patch.preferredHeight).toEqual(expect.any(Number));
    expect(patch.minWidth).toEqual(expect.any(Number));
    expect(patch.minHeight).toEqual(expect.any(Number));
    expect(patch.autoFitWidth).toBe(false);
    expect(patch.autoFitHeight).toBe(true);
    expect(patch.sizingPolicyOverride).toBe('always_fit');
  });
});
