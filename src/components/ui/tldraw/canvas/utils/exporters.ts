import type { TLShapeId } from '@tldraw/tldraw';

export type ExportFormat = 'png' | 'svg' | 'json';

export interface ExportRequest {
  format: ExportFormat;
  ids?: TLShapeId[];
  filename?: string;
}

export function ensureFileExtension(filename: string, extension: ExportFormat): string {
  const normalized = filename.trim().replace(/\s+/g, '-').toLowerCase();
  const suffix = `.${extension}`;
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

export function createDefaultFilename(prefix: string, extension: ExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return ensureFileExtension(`${prefix}-${timestamp}`, extension);
}

export function normalizeIds(ids?: TLShapeId[]): TLShapeId[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  return [...new Set(ids)];
}
