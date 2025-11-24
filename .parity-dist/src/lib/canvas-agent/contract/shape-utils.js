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
const SHAPE_TYPE_SYNONYMS = {
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
const FILL_SYNONYMS = {
    transparent: 'none',
    outline: 'none',
    hollow: 'none',
    solid: 'solid',
    bold: 'solid',
    semi: 'semi',
};
const DASH_SYNONYMS = {
    dotted: 'dotted',
    dots: 'dotted',
    dashed: 'dashed',
    dash: 'dashed',
    solid: 'solid',
    none: 'draw',
    draw: 'draw',
};
const FONT_SYNONYMS = {
    monospace: 'mono',
    mono: 'mono',
    regular: 'sans',
    sans_serif: 'sans',
    sans: 'sans',
    serif: 'serif',
};
const SIZE_SYNONYMS = {
    tiny: 'xs',
    small: 's',
    medium: 'm',
    large: 'l',
    xl: 'xl',
    headline: 'xl',
    hero: 'xl',
};
const normalizeEnumValue = (value, allowed, aliases) => {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized)
            return undefined;
        if (allowed.has(normalized))
            return normalized;
        if (aliases[normalized])
            return aliases[normalized];
    }
    return undefined;
};
const resolveColorName = (value, aliases) => {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return undefined;
    if (TL_COLOR_KEYS.has(normalized))
        return normalized;
    if (aliases && aliases[normalized])
        return aliases[normalized];
    return undefined;
};
const stripUnsupportedProps = (props, shapeType) => {
    if (shapeType === 'text' || shapeType === 'note') {
        delete props.dash;
        delete props.fill;
        delete props.strokeWidth;
        delete props.corner;
        delete props.radius;
        delete props.opacity;
        delete props.h;
        delete props.text;
    }
    if (shapeType === 'line' || shapeType === 'arrow') {
        delete props.w;
        delete props.h;
    }
    return props;
};
const buildRichTextDoc = (value) => {
    const paragraphs = value.split(/\r?\n/);
    return {
        type: 'doc',
        content: paragraphs.length > 0
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
export const sanitizeShapeProps = (rawProps, shapeType, options) => {
    const next = { ...rawProps };
    const color = resolveColorName(next.color ?? next.stroke ?? next.strokeColor, options?.colorAliases);
    if (color)
        next.color = color;
    else
        delete next.color;
    const fill = normalizeEnumValue(next.fill, TL_FILL_KEYS, FILL_SYNONYMS);
    if (fill)
        next.fill = fill;
    else
        delete next.fill;
    const dash = normalizeEnumValue(next.dash ?? next.strokeStyle, TL_DASH_KEYS, DASH_SYNONYMS);
    if (dash)
        next.dash = dash;
    else
        delete next.dash;
    const font = normalizeEnumValue(next.font, TL_FONT_KEYS, FONT_SYNONYMS);
    if (font)
        next.font = font;
    else
        delete next.font;
    const size = normalizeEnumValue(next.size, TL_SIZE_KEYS, SIZE_SYNONYMS);
    if (size)
        next.size = size;
    else
        delete next.size;
    if (typeof next.text === 'string' && next.text.trim().length === 0) {
        delete next.text;
    }
    if ((shapeType === 'text' || shapeType === 'note') && typeof next.text === 'string') {
        next.richText = buildRichTextDoc(next.text);
        delete next.text;
    }
    return stripUnsupportedProps(next, shapeType);
};
export const resolveShapeType = (value) => {
    if (!value || typeof value !== 'string')
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return undefined;
    if (TL_SHAPE_TYPES.has(normalized))
        return normalized;
    if (SHAPE_TYPE_SYNONYMS[normalized])
        return SHAPE_TYPE_SYNONYMS[normalized];
    return undefined;
};
//# sourceMappingURL=shape-utils.js.map