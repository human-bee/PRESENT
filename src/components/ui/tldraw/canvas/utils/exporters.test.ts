import {
  ensureFileExtension,
  createDefaultFilename,
  normalizeIds,
} from './exporters';
import type { TLShapeId } from '@tldraw/tlschema';

describe('exporters utils', () => {
  it('ensures expected file extension', () => {
    expect(ensureFileExtension('diagram.png', 'png')).toBe('diagram.png');
    expect(ensureFileExtension('diagram', 'png')).toBe('diagram.png');
    expect(ensureFileExtension('Diagram Name', 'svg')).toBe('diagram-name.svg');
  });

  it('creates timestamped filenames', () => {
    const value = createDefaultFilename('present', 'png');
    expect(value.startsWith('present-')).toBe(true);
    expect(value.endsWith('.png')).toBe(true);
  });

  it('normalizes shape ids', () => {
    expect(normalizeIds(undefined)).toBeUndefined();
    expect(normalizeIds([])).toBeUndefined();
    const ids = ['a', 'a', 'b'].map((id) => id as TLShapeId);
    expect(normalizeIds(ids)).toEqual(['a', 'b'].map((id) => id as TLShapeId));
  });
});
