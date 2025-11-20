import { createShapeId, reverseRecordsDiff, } from 'tldraw';
import { convertTldrawFillToSimpleFill } from './SimpleFill';
import { convertTldrawFontSizeAndScaleToSimpleFontSize } from './SimpleFontSize';
/**
 * Convert a tldraw shape to a simple shape
 */
export function convertTldrawShapeToSimpleShape(editor, shape) {
    switch (shape.type) {
        case 'text':
            return convertTextShapeToSimple(editor, shape);
        case 'geo':
            return convertGeoShapeToSimple(editor, shape);
        case 'line':
            return convertLineShapeToSimple(editor, shape);
        case 'arrow':
            return convertArrowShapeToSimple(editor, shape);
        case 'note':
            return convertNoteShapeToSimple(editor, shape);
        case 'draw':
            return convertDrawShapeToSimple(editor, shape);
        default:
            return convertUnknownShapeToSimple(editor, shape);
    }
}
export function convertTldrawShapeToSimpleType(shape) {
    switch (shape.type) {
        case 'geo': {
            const geoShape = shape;
            return GEO_TO_SIMPLE_TYPES[geoShape.props.geo];
        }
        case 'text':
        case 'line':
        case 'arrow':
        case 'note':
        case 'draw':
            return shape.type;
        default:
            return 'unknown';
    }
}
const GEO_TO_SIMPLE_TYPES = {
    rectangle: 'rectangle',
    ellipse: 'ellipse',
    triangle: 'triangle',
    diamond: 'diamond',
    hexagon: 'hexagon',
    oval: 'pill',
    cloud: 'cloud',
    'x-box': 'x-box',
    'check-box': 'check-box',
    heart: 'heart',
    pentagon: 'pentagon',
    octagon: 'octagon',
    star: 'star',
    rhombus: 'parallelogram-right',
    'rhombus-2': 'parallelogram-left',
    trapezoid: 'trapezoid',
    'arrow-right': 'fat-arrow-right',
    'arrow-left': 'fat-arrow-left',
    'arrow-up': 'fat-arrow-up',
    'arrow-down': 'fat-arrow-down',
};
export function convertTldrawIdToSimpleId(id) {
    return id.slice('shape:'.length);
}
function convertDrawShapeToSimple(editor, shape) {
    return {
        _type: 'draw',
        color: shape.props.color,
        fill: convertTldrawFillToSimpleFill(shape.props.fill),
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
    };
}
function convertTextShapeToSimple(editor, shape) {
    const util = editor.getShapeUtil(shape);
    const text = util.getText(shape) ?? '';
    const bounds = getSimpleBounds(editor, shape);
    const textSize = shape.props.size;
    const textAlign = shape.props.textAlign;
    const textWidth = shape.props.w;
    let anchorX = bounds.x;
    switch (textAlign) {
        case 'middle':
            anchorX = bounds.x + textWidth / 2;
            break;
        case 'end':
            anchorX = bounds.x + textWidth;
            break;
        case 'start':
        default:
            anchorX = bounds.x;
            break;
    }
    return {
        _type: 'text',
        color: shape.props.color,
        fontSize: convertTldrawFontSizeAndScaleToSimpleFontSize(textSize, shape.props.scale),
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
        text: text,
        textAlign: shape.props.textAlign,
        x: anchorX,
        y: bounds.y,
    };
}
function convertGeoShapeToSimple(editor, shape) {
    const util = editor.getShapeUtil(shape);
    const text = util.getText(shape);
    const bounds = getSimpleBounds(editor, shape);
    const shapeTextAlign = shape.props.align;
    let newTextAlign;
    switch (shapeTextAlign) {
        case 'start-legacy':
            newTextAlign = 'start';
            break;
        case 'middle-legacy':
            newTextAlign = 'middle';
            break;
        case 'end-legacy':
            newTextAlign = 'end';
            break;
        default:
            newTextAlign = shapeTextAlign;
            break;
    }
    return {
        _type: GEO_TO_SIMPLE_TYPES[shape.props.geo],
        color: shape.props.color,
        fill: convertTldrawFillToSimpleFill(shape.props.fill),
        h: shape.props.h,
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
        text: text ?? '',
        textAlign: newTextAlign,
        w: shape.props.w,
        x: bounds.x,
        y: bounds.y,
    };
}
function convertLineShapeToSimple(editor, shape) {
    const bounds = getSimpleBounds(editor, shape);
    const points = Object.values(shape.props.points).sort((a, b) => a.index.localeCompare(b.index));
    return {
        _type: 'line',
        color: shape.props.color,
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
        x1: points[0].x + bounds.x,
        x2: points[1].x + bounds.x,
        y1: points[0].y + bounds.y,
        y2: points[1].y + bounds.y,
    };
}
function convertArrowShapeToSimple(editor, shape) {
    const bounds = getSimpleBounds(editor, shape);
    const bindings = editor.store.query.records('binding').get();
    const arrowBindings = bindings.filter((b) => b.type === 'arrow' && b.fromId === shape.id);
    const startBinding = arrowBindings.find((b) => b.props.terminal === 'start');
    const endBinding = arrowBindings.find((b) => b.props.terminal === 'end');
    return {
        _type: 'arrow',
        bend: shape.props.bend * -1,
        color: shape.props.color,
        fromId: startBinding?.toId ?? null,
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
        text: shape.meta.text ?? '',
        toId: endBinding?.toId ?? null,
        x1: shape.props.start.x + bounds.x,
        x2: shape.props.end.x + bounds.x,
        y1: shape.props.start.y + bounds.y,
        y2: shape.props.end.y + bounds.y,
    };
}
function convertNoteShapeToSimple(editor, shape) {
    const util = editor.getShapeUtil(shape);
    const text = util.getText(shape);
    const bounds = getSimpleBounds(editor, shape);
    return {
        _type: 'note',
        color: shape.props.color,
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
        text: text ?? '',
        x: bounds.x,
        y: bounds.y,
    };
}
function convertUnknownShapeToSimple(editor, shape) {
    const bounds = getSimpleBounds(editor, shape);
    return {
        _type: 'unknown',
        note: shape.meta.note ?? '',
        shapeId: convertTldrawIdToSimpleId(shape.id),
        subType: shape.type,
        x: bounds.x,
        y: bounds.y,
    };
}
function getSimpleBounds(editor, shape) {
    const bounds = editor.getShapePageBounds(shape);
    if (bounds) {
        return bounds;
    }
    // Create a mock shape and get the bounds, then reverse the creation of the mock shape
    let mockBounds;
    const diff = editor.store.extractingChanges(() => {
        editor.run(() => {
            const mockId = createShapeId();
            editor.createShape({
                id: mockId,
                type: shape.type,
                props: shape.props,
                meta: shape.meta,
            });
            mockBounds = editor.getShapePageBounds(mockId);
        }, { ignoreShapeLock: false, history: 'ignore' });
    });
    const reverseDiff = reverseRecordsDiff(diff);
    editor.store.applyDiff(reverseDiff);
    if (!mockBounds) {
        throw new Error('Failed to get bounds for shape');
    }
    return mockBounds;
}
//# sourceMappingURL=convertTldrawShapeToSimpleShape.js.map