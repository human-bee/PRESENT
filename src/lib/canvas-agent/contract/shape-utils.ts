const TL_SHAPE_TYPES = new Set([
  'note',
  'text',
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'draw',
  'highlight',
  'frame',
  'group',
  'star',
  'cloud',
]);

const SHAPE_TYPE_SYNONYMS: Record<string, string> = {
  box: 'note',
  sticky: 'note',
  sticky_note: 'note',
  card: 'note',
  hero: 'text',
  headline: 'text',
  caption: 'text',
  rect: 'rectangle',
  square: 'rectangle',
  circle: 'ellipse',
  oval: 'ellipse',
  connector: 'arrow',
  arrowhead: 'arrow',
  wire: 'line',
  pen: 'draw',
};

const TL_COLOR_KEYS = new Set([
  'black',
  'grey',
  'light-violet',
  'violet',
  'blue',
  'light-blue',
  'yellow',
  'orange',
  'green',
  'light-green',
  'light-red',
  'red',
  'white',
]);

const TL_FILL_KEYS = new Set(['none', 'semi', 'solid', 'pattern', 'background']);
const TL_DASH_KEYS = new Set(['draw', 'solid', 'dashed', 'dotted', 'mixed']);
const TL_FONT_KEYS = new Set(['mono', 'sans', 'serif']);
const TL_SIZE_KEYS = new Set(['xs', 's', 'm', 'l', 'xl']);

const FILL_SYNONYMS: Record<string, string> = {
  transparent: 'none',
  outline: 'none',
  hollow: 'none',
  solid: 'solid',
  bold: 'solid',
  semi: 'semi',
};

const DASH_SYNONYMS: Record<string, string> = {
  dotted: 'dotted',
  dots: 'dotted',
  dashed: 'dashed',
  dash: 'dashed',
  solid: 'solid',
  none: 'draw',
  draw: 'draw',
};

const FONT_SYNONYMS: Record<string, string> = {
  monospace: 'mono',
  mono: 'mono',
  regular: 'sans',
  sans_serif: 'sans',
  sans: 'sans',
  serif: 'serif',
};

const SIZE_SYNONYMS: Record<string, string> = {
  tiny: 'xs',
  small: 's',
  medium: 'm',
  large: 'l',
  xl: 'xl',
  headline: 'xl',
  hero: 'xl',
};

const normalizeEnumValue = (value: unknown, allowed: Set<string>, aliases: Record<string, string>): string | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (allowed.has(normalized)) return normalized;
    if (aliases[normalized]) return aliases[normalized];
  }
  return undefined;
};

const resolveColorName = (value: unknown, aliases?: Record<string, string>): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TL_COLOR_KEYS.has(normalized)) return normalized;
  if (aliases && aliases[normalized]) return aliases[normalized];
  return undefined;
};

const stripUnsupportedProps = (props: Record<string, unknown>, shapeType: string) => {
  if (shapeType === 'text' || shapeType === 'note') {
    delete props.dash;
    delete props.fill;
    delete props.strokeWidth;
    delete props.corner;
    delete props.radius;
    delete props.opacity;
    delete props.w;
    delete props.h;
    delete props.text;
  }
  if (shapeType === 'line') {
    const allowedLineProps = new Set(['color', 'dash', 'size', 'spline', 'scale', 'points']);
    for (const key of Object.keys(props)) {
      if (!allowedLineProps.has(key)) {
        delete props[key];
      }
    }
  }
  if (shapeType === 'arrow') {
    delete props.w;
    delete props.h;
  }
  return props;
};

const readPointTuple = (value: unknown): [number, number] | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
};

const toLinePointsRecord = (points: [number, number][]) => {
  const record: Record<string, { id: string; index: string; x: number; y: number }> = {};
  points.forEach((point, idx) => {
    const pointId = `a${idx + 1}`;
    record[pointId] = { id: pointId, index: pointId, x: point[0], y: point[1] };
  });
  return record;
};

const normalizeLineLikePoints = (props: Record<string, unknown>) => {
  const start = readPointTuple(props.startPoint) ?? [0, 0];
  const end = readPointTuple(props.endPoint);
  const existingPointsRaw = props.points;
  const existingPoints = Array.isArray(existingPointsRaw)
    ? existingPointsRaw
    : existingPointsRaw && typeof existingPointsRaw === 'object'
      ? Object.values(existingPointsRaw as Record<string, unknown>)
      : [];

  let normalized = existingPoints
    .map((point) => readPointTuple(point))
    .filter((point): point is [number, number] => Array.isArray(point));

  if (normalized.length === 1) {
    const [x, y] = normalized[0];
    normalized = [normalized[0], [x + 120, y]];
  }
  if (normalized.length < 2) {
    const fallbackEnd: [number, number] = end ?? [start[0] + 120, start[1]];
    const resolvedEnd: [number, number] =
      fallbackEnd[0] === start[0] && fallbackEnd[1] === start[1]
        ? [start[0] + 120, start[1]]
        : fallbackEnd;
    normalized = [start, resolvedEnd];
  }
  props.points = toLinePointsRecord(normalized);

  delete props.startPoint;
  delete props.endPoint;
};

const buildRichTextDoc = (value: string) => {
  const paragraphs = value.split(/\r?\n/);
  return {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((line) => ({
            type: 'paragraph',
            content: line.length > 0 ? [{ type: 'text', text: line }] : [],
          }))
        : [
            {
              type: 'paragraph',
              content: [],
            },
          ],
  };
};

export type SanitizeShapeOptions = {
  colorAliases?: Record<string, string>;
};

export const sanitizeShapeProps = (
  rawProps: Record<string, unknown>,
  shapeType: string,
  options?: SanitizeShapeOptions,
) => {
  const next: Record<string, unknown> = { ...rawProps };

  if (shapeType === 'line' || shapeType === 'arrow') {
    normalizeLineLikePoints(next);
  }

  const color = resolveColorName(next.color ?? next.stroke ?? next.strokeColor, options?.colorAliases);
  if (color) next.color = color;
  else delete next.color;

  const fill = normalizeEnumValue(next.fill, TL_FILL_KEYS, FILL_SYNONYMS);
  if (fill) next.fill = fill;
  else delete next.fill;

  const dash = normalizeEnumValue(next.dash ?? next.strokeStyle, TL_DASH_KEYS, DASH_SYNONYMS);
  if (dash) next.dash = dash;
  else delete next.dash;

  const font = normalizeEnumValue(next.font, TL_FONT_KEYS, FONT_SYNONYMS);
  if (font) next.font = font;
  else delete next.font;

  const size = normalizeEnumValue(next.size, TL_SIZE_KEYS, SIZE_SYNONYMS);
  if (size) next.size = size;
  else delete next.size;

  if (typeof next.text === 'string' && next.text.trim().length === 0) {
    delete next.text;
  }

  if ((shapeType === 'text' || shapeType === 'note') && typeof next.text === 'string') {
    next.richText = buildRichTextDoc(next.text);
    delete next.text;
  }

  return stripUnsupportedProps(next, shapeType);
};

export const resolveShapeType = (value?: string): string | undefined => {
  if (!value || typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TL_SHAPE_TYPES.has(normalized)) return normalized;
  if (SHAPE_TYPE_SYNONYMS[normalized]) return SHAPE_TYPE_SYNONYMS[normalized];
  return undefined;
};
