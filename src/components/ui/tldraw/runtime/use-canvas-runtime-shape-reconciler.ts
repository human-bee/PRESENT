'use client';

import { useEffect } from 'react';
import { createShapeId, type Editor } from '@tldraw/tldraw';
import type {
  CanvasNodeLayoutHint,
  CanvasSessionNode,
  CanvasSessionSnapshot,
} from '@present/contracts';
import type { RuntimeCardShape, RuntimeWidgetShape } from './runtime-shape-utils';

type RuntimeShape = RuntimeCardShape | RuntimeWidgetShape;

type RuntimeShapeCreate = {
  id: RuntimeShape['id'];
  type: RuntimeShape['type'];
  x: number;
  y: number;
  rotation: number;
  props: RuntimeShape['props'];
};

type RuntimeShapeUpdate = {
  id: RuntimeShape['id'];
  type: RuntimeShape['type'];
  props: Partial<RuntimeShape['props']>;
};

type RuntimeShapeOperations = {
  create: RuntimeShapeCreate[];
  update: RuntimeShapeUpdate[];
  delete: string[];
};

type ZoneLayout = {
  x: number;
  y: number;
  gapX: number;
  gapY: number;
  columns: number;
};

const zoneLayouts: Record<CanvasNodeLayoutHint['zone'], ZoneLayout> = {
  top_strip: { x: -860, y: -700, gapX: 260, gapY: 170, columns: 4 },
  left_rail: { x: -920, y: -420, gapX: 0, gapY: 196, columns: 1 },
  center_stack: { x: -300, y: -300, gapX: 420, gapY: 280, columns: 2 },
  right_stack: { x: 620, y: -260, gapX: 0, gapY: 216, columns: 1 },
  bottom_strip: { x: -720, y: 420, gapX: 380, gapY: 180, columns: 3 },
};

const runtimeShapeFamilies = new Set<RuntimeShape['type']>(['runtime_card', 'runtime_widget']);

export const getRuntimeShapeId = (nodeId: string) => createShapeId(`runtime-${nodeId}`);

const getRuntimeShapeType = (node: CanvasSessionNode): RuntimeShape['type'] =>
  node.kind === 'widget-frame' ? 'runtime_widget' : 'runtime_card';

const getNodeCardTitle = (node: Exclude<CanvasSessionNode, { kind: 'widget-frame' }>) => {
  switch (node.kind) {
    case 'agent-seat':
      return node.label;
    case 'media-tile':
      return String(node.metadata['label'] ?? node.participantIdentity);
    case 'run-lane':
    case 'artifact-card':
    case 'approval-chip':
    case 'trace-rail':
      return node.title;
  }
};

const getNodeCardSubtitle = (node: Exclude<CanvasSessionNode, { kind: 'widget-frame' }>) => {
  switch (node.kind) {
    case 'agent-seat':
      return String(node.metadata['presenceState'] ?? node.state);
    case 'media-tile':
      return node.media.screen ? 'screen' : node.media.video ? 'video' : node.media.audio ? 'audio' : 'connected';
    case 'run-lane':
      return node.status;
    case 'artifact-card':
      return String(node.metadata['kind'] ?? node.mimeType);
    case 'approval-chip':
      return String(node.metadata['kind'] ?? node.state);
    case 'trace-rail':
      return node.latestEventType ?? 'trace';
  }
};

const getNodeCardDetail = (node: Exclude<CanvasSessionNode, { kind: 'widget-frame' }>) => {
  switch (node.kind) {
    case 'agent-seat':
      return node.participantIdentity ?? 'room participant';
    case 'media-tile':
      return node.participantIdentity;
    case 'run-lane':
      return typeof node.metadata['taskType'] === 'string' ? node.metadata['taskType'] : undefined;
    case 'artifact-card':
      return (
        (typeof node.metadata['filePath'] === 'string' && node.metadata['filePath']) ||
        (typeof node.metadata['preview'] === 'string' && node.metadata['preview']) ||
        node.mimeType
      );
    case 'approval-chip':
      return node.detail;
    case 'trace-rail':
      return `${node.eventCount} event(s)`;
  }
};

const buildShapeProps = (node: CanvasSessionNode, overrides?: { w?: number; h?: number }) => {
  if (node.kind === 'widget-frame') {
    return {
      w: overrides?.w ?? node.layoutHint.defaultSize.w,
      h: overrides?.h ?? node.layoutHint.defaultSize.h,
      nodeId: node.id,
      syncVersion: node.syncVersion,
      retention: node.retention,
      title: node.title,
      artifactId: node.artifactId ?? '',
      artifactUri: node.artifactUri ?? '',
      resourceUri: node.resourceUri ?? '',
    } satisfies RuntimeWidgetShape['props'];
  }

  return {
    w: overrides?.w ?? node.layoutHint.defaultSize.w,
    h: overrides?.h ?? node.layoutHint.defaultSize.h,
    nodeId: node.id,
    nodeKind: node.kind,
    syncVersion: node.syncVersion,
    retention: node.retention,
    title: getNodeCardTitle(node),
    subtitle: getNodeCardSubtitle(node),
    detail: getNodeCardDetail(node),
  } satisfies RuntimeCardShape['props'];
};

const buildZonePlacements = (nodes: CanvasSessionNode[]) => {
  const placements = new Map<string, { x: number; y: number }>();
  const zones = new Map<CanvasNodeLayoutHint['zone'], CanvasSessionNode[]>();

  for (const node of nodes) {
    const group = zones.get(node.layoutHint.zone);
    if (group) {
      group.push(node);
    } else {
      zones.set(node.layoutHint.zone, [node]);
    }
  }

  zones.forEach((group, zone) => {
    const layout = zoneLayouts[zone];
    const ordered = [...group].sort((left, right) => {
      if (left.layoutHint.priority !== right.layoutHint.priority) {
        return left.layoutHint.priority - right.layoutHint.priority;
      }
      return left.id.localeCompare(right.id);
    });

    ordered.forEach((node, index) => {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      placements.set(node.id, {
        x: layout.x + column * layout.gapX,
        y: layout.y + row * layout.gapY,
      });
    });
  });

  return placements;
};

const getExistingRuntimeShapes = (editor: Editor) =>
  editor
    .getCurrentPageShapes()
    .filter((shape): shape is RuntimeShape => runtimeShapeFamilies.has(shape.type as RuntimeShape['type']));

export function buildRuntimeShapeOperations(
  snapshot: CanvasSessionSnapshot,
  existingShapes: RuntimeShape[],
): RuntimeShapeOperations {
  const placements = buildZonePlacements(snapshot.nodes);
  const existingById = new Map(existingShapes.map((shape) => [shape.id, shape]));
  const nextNodeIds = new Set(snapshot.nodes.map((node) => node.id));

  const create: RuntimeShapeCreate[] = [];
  const update: RuntimeShapeUpdate[] = [];
  const del: string[] = [];

  for (const node of snapshot.nodes) {
    const shapeId = getRuntimeShapeId(node.id);
    const expectedType = getRuntimeShapeType(node);
    const existing = existingById.get(shapeId);
    const nextPlacement = placements.get(node.id) ?? { x: 0, y: 0 };

    if (!existing) {
      create.push({
        id: shapeId,
        type: expectedType,
        x: nextPlacement.x,
        y: nextPlacement.y,
        rotation: 0,
        props: buildShapeProps(node),
      });
      continue;
    }

    if (existing.type !== expectedType) {
      del.push(existing.id);
      create.push({
        id: shapeId,
        type: expectedType,
        x: existing.x,
        y: existing.y,
        rotation: existing.rotation ?? 0,
        props: buildShapeProps(node, { w: existing.props.w, h: existing.props.h }),
      });
      continue;
    }

    if (existing.props.syncVersion !== node.syncVersion) {
      update.push({
        id: existing.id,
        type: existing.type,
        props: buildShapeProps(node, { w: existing.props.w, h: existing.props.h }),
      });
    }
  }

  for (const existing of existingShapes) {
    const nodeId = typeof existing.props.nodeId === 'string' ? existing.props.nodeId : null;
    if (!nodeId || nextNodeIds.has(nodeId)) continue;
    if (existing.props.retention === 'mirror') {
      del.push(existing.id);
    }
  }

  return { create, update, delete: del };
}

export function applyRuntimeShapeOperations(editor: Editor, operations: RuntimeShapeOperations) {
  for (const shape of operations.create) {
    editor.createShape(shape as any);
  }
  if (operations.update.length > 0) {
    editor.updateShapes(operations.update as any);
  }
  if (operations.delete.length > 0) {
    editor.deleteShapes(operations.delete as any);
  }
}

export function useCanvasRuntimeShapeReconciler(
  editor: Editor | null,
  snapshot: CanvasSessionSnapshot | null | undefined,
  options: { isHost: boolean },
) {
  useEffect(() => {
    if (!editor || !options.isHost || !snapshot) return;
    const operations = buildRuntimeShapeOperations(snapshot, getExistingRuntimeShapes(editor));
    if (!operations.create.length && !operations.update.length && !operations.delete.length) {
      return;
    }
    applyRuntimeShapeOperations(editor, operations);
  }, [editor, options.isHost, snapshot]);
}
