import { createDefaultTimelineDocument } from '@/lib/agents/timeline-schema';
import { resolveTimelineTurn } from './timeline-turn-resolver';

const buildDocument = () => {
  const now = 1_700_000_000_000;
  return {
    ...createDefaultTimelineDocument('timeline-widget-proof'),
    title: 'Platform Launch Timeline',
    subtitle: 'Roadmap',
    horizonLabel: 'Now',
    items: [
      {
        id: 'item-brief',
        laneId: 'lane-product',
        title: 'Finalize launch brief',
        type: 'milestone' as const,
        status: 'in_progress' as const,
        owner: 'Product',
        summary: 'Lock launch brief.',
        notes: 'Initial notes',
        tags: ['launch'],
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'item-realtime',
        laneId: 'lane-engineering',
        title: 'Ship realtime webhook ingest',
        type: 'task' as const,
        status: 'planned' as const,
        owner: 'Platform',
        summary: 'Normalize external events.',
        notes: '',
        tags: ['realtime'],
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'item-rights-social',
        laneId: 'lane-go-to-market',
        title: 'Talent Rights Clearance',
        type: 'task' as const,
        status: 'planned' as const,
        owner: 'Legal',
        summary: 'Clear usage rights for social derivatives.',
        notes: '',
        tags: ['rights'],
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    dependencies: [],
    events: [],
    sync: { status: 'live' as const, pendingExports: [] },
  };
};

describe('resolveTimelineTurn', () => {
  it('updates item status through a compact deterministic turn', async () => {
    const document = buildDocument();
    const result = await resolveTimelineTurn({
      instruction: 'mark ship realtime webhook ingest blocked',
      document,
      now: 1_700_000_000_111,
    });

    expect(result.mode).toBe('patch');
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upsert_item',
          item: expect.objectContaining({
            id: 'item-realtime',
            status: 'blocked',
          }),
        }),
      ]),
    );
  });

  it('moves an item between lanes via unique lane alias match', async () => {
    const document = buildDocument();
    const result = await resolveTimelineTurn({
      instruction: 'move ship realtime webhook ingest to gtm',
      document,
      now: 1_700_000_000_222,
    });

    expect(result.mode).toBe('patch');
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upsert_item',
          item: expect.objectContaining({
            id: 'item-realtime',
            laneId: 'lane-go-to-market',
          }),
        }),
      ]),
    );
  });

  it('adds a dependency and blockedBy linkage for compact dependency turns', async () => {
    const document = buildDocument();
    const result = await resolveTimelineTurn({
      instruction: 'ship realtime webhook ingest depends on finalize launch brief',
      document,
      now: 1_700_000_000_333,
    });

    expect(result.mode).toBe('patch');
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'set_dependency',
          dependency: expect.objectContaining({
            fromItemId: 'item-brief',
            toItemId: 'item-realtime',
            kind: 'depends_on',
          }),
        }),
        expect.objectContaining({
          type: 'upsert_item',
          item: expect.objectContaining({
            id: 'item-realtime',
            blockedBy: expect.arrayContaining(['item-brief']),
          }),
        }),
      ]),
    );
  });

  it('marks blocked-by targets as blocked for deterministic blocker phrasing', async () => {
    const document = buildDocument();
    const result = await resolveTimelineTurn({
      instruction: 'ship realtime webhook ingest is blocked by finalize launch brief',
      document,
      now: 1_700_000_000_334,
    });

    expect(result.mode).toBe('patch');
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'set_dependency',
          dependency: expect.objectContaining({
            fromItemId: 'item-brief',
            toItemId: 'item-realtime',
            kind: 'blocks',
          }),
        }),
        expect.objectContaining({
          type: 'upsert_item',
          item: expect.objectContaining({
            id: 'item-realtime',
            status: 'blocked',
            blockedBy: expect.arrayContaining(['item-brief']),
          }),
        }),
      ]),
    );
  });

  it('adds a blocker item into the requested lane through a compact add-item turn', async () => {
    const document = buildDocument();
    const result = await resolveTimelineTurn({
      instruction: 'add blocker talent rights clearance to product lane',
      document,
      now: 1_700_000_000_444,
    });

    expect(result.mode).toBe('patch');
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upsert_item',
          item: expect.objectContaining({
            id: 'item-lane-product-talent-rights-clearance',
            laneId: 'lane-product',
            title: 'Talent Rights Clearance',
            type: 'blocker',
            status: 'blocked',
          }),
        }),
      ]),
    );
  });

  it('falls back to plan mode when no deterministic pattern matches', async () => {
    const document = buildDocument();
    const result = await resolveTimelineTurn({
      instruction: 'turn this into a cross-functional roadmap for the next launch',
      document,
    });

    expect(result.mode).toBe('plan');
    expect(result.ops).toEqual([]);
    expect(result.fallbackContextBundle).toContain('Turn Resolution Fallback');
    expect(result.fallbackContextBundle).toContain('Items:');
  });
});
