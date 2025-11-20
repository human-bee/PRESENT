import type { BoxModel } from 'tldraw';
import type { ContextItem } from '../../../../vendor/tldraw-agent-template/shared/types/ContextItem';
import type { SimpleShape } from '../../../../vendor/tldraw-agent-template/shared/format/SimpleShape';
import type { CanvasShapeSummary } from '@/lib/agents/shared/supabase-context';

type SelectedShapeSnapshot = {
  id?: string;
  type?: string;
  text?: string | null;
  label?: string | null;
  name?: string | null;
  x?: number | null;
  y?: number | null;
  meta?: Record<string, unknown> | null;
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const fallbackNote = (entry: { label?: string; name?: string; text?: string; type?: string }): string => {
  const note = entry.label ?? entry.name ?? entry.text ?? entry.type;
  return typeof note === 'string' && note.trim().length > 0 ? note.trim() : 'shape';
};

const simpleShapeFromSummary = (shape: CanvasShapeSummary): SimpleShape | null => {
  if (!shape?.id) return null;
  const meta = (shape.meta as Record<string, unknown>) || {};
  const x = coerceNumber(meta.x) ?? 0;
  const y = coerceNumber(meta.y) ?? 0;
  return {
    _type: 'unknown',
    note: fallbackNote(shape),
    shapeId: shape.id,
    subType: shape.type ?? 'shape',
    x,
    y,
  };
};

const simpleShapeFromSelection = (shape: SelectedShapeSnapshot): SimpleShape | null => {
  if (!shape?.id) return null;
  const meta = (shape.meta as Record<string, unknown>) || {};
  const x = coerceNumber(shape.x ?? meta.x) ?? 0;
  const y = coerceNumber(shape.y ?? meta.y) ?? 0;
  return {
    _type: 'unknown',
    note: fallbackNote(shape),
    shapeId: shape.id,
    subType: shape.type ?? 'shape',
    x,
    y,
  };
};

export type TeacherContextItemSources = {
  shapes?: CanvasShapeSummary[];
  selectedShapes?: SelectedShapeSnapshot[];
  viewport?: BoxModel | null;
};

export function buildTeacherContextItems(source: TeacherContextItemSources): ContextItem[] {
  const items: ContextItem[] = [];
  const selected = (source.selectedShapes ?? [])
    .map((entry) => simpleShapeFromSelection(entry))
    .filter((shape): shape is SimpleShape => Boolean(shape));
  const shapes = (source.shapes ?? [])
    .map((entry) => simpleShapeFromSummary(entry))
    .filter((shape): shape is SimpleShape => Boolean(shape));

  selected.slice(0, 8).forEach((shape) => {
    items.push({ type: 'shape', shape, source: 'user' });
  });

  if (shapes.length > 0) {
    items.push({ type: 'shapes', shapes: shapes.slice(0, 24), source: 'agent' });
  }

  if (source.viewport) {
    items.push({ type: 'area', bounds: source.viewport, source: 'user' });
  }

  return items;
}
