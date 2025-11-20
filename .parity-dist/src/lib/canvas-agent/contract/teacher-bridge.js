import { TEACHER_ACTIONS } from './teacher';
import { validateTeacherActionPayload } from './teacher-validation';
const teacherActionSet = new Set(TEACHER_ACTIONS);
const toNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
};
const asString = (value) => (typeof value === 'string' && value.length > 0 ? value : undefined);
const asStringArray = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const result = value.map(asString).filter((v) => Boolean(v));
    return result.length > 0 ? result : undefined;
};
const omitKeys = new Set(['_type', 'shapeId', 'x', 'y']);
const toCanonicalShapeParams = (shapePayload) => {
    const type = asString(shapePayload._type) ?? 'unknown';
    const id = asString(shapePayload.shapeId);
    const x = toNumber(shapePayload.x);
    const y = toNumber(shapePayload.y);
    const props = {};
    Object.entries(shapePayload).forEach(([key, value]) => {
        if (omitKeys.has(key))
            return;
        props[key] = value;
    });
    return { type, id, x, y, props };
};
const mapAlignment = (alignment) => {
    switch (alignment) {
        case 'left':
            return { axis: 'x', mode: 'start' };
        case 'right':
            return { axis: 'x', mode: 'end' };
        case 'center-horizontal':
            return { axis: 'x', mode: 'center' };
        case 'top':
            return { axis: 'y', mode: 'start' };
        case 'bottom':
            return { axis: 'y', mode: 'end' };
        default:
            return { axis: 'y', mode: 'center' };
    }
};
const normalizePenPoints = (points) => {
    if (!Array.isArray(points))
        return [];
    return points
        .map((point) => {
        const x = toNumber(point?.x);
        const y = toNumber(point?.y);
        if (x === undefined || y === undefined)
            return null;
        return { x, y };
    })
        .filter((pt) => Boolean(pt));
};
const buildDrawSegments = (points, isClosed) => {
    if (points.length < 2)
        return null;
    const closedPoints = isClosed ? [...points, points[0]] : points;
    const minX = Math.min(...closedPoints.map((p) => p.x));
    const minY = Math.min(...closedPoints.map((p) => p.y));
    const relativePoints = closedPoints.map((point) => ({
        x: point.x - minX,
        y: point.y - minY,
        z: 0.75,
    }));
    if (relativePoints.length < 2)
        return null;
    return {
        origin: { x: minX, y: minY },
        segments: [
            {
                type: 'free',
                points: relativePoints,
            },
        ],
    };
};
const teacherConverters = {
    message: (payload) => {
        const text = typeof payload.text === 'string' ? payload.text : '';
        return { name: 'message', params: { text } };
    },
    think: (payload) => {
        const text = typeof payload.text === 'string' ? payload.text : '';
        return { name: 'think', params: { text } };
    },
    'add-detail': (payload) => {
        const hint = typeof payload.intent === 'string' ? payload.intent : undefined;
        return { name: 'add_detail', params: hint ? { hint } : {} };
    },
    'update-todo-list': (payload) => {
        const text = typeof payload.text === 'string' ? payload.text : '';
        return { name: 'todo', params: { text } };
    },
    setMyView: (payload) => {
        const x = toNumber(payload.x) ?? 0;
        const y = toNumber(payload.y) ?? 0;
        const w = toNumber(payload.w) ?? 0;
        const h = toNumber(payload.h) ?? 0;
        return { name: 'set_viewport', params: { bounds: { x, y, w, h }, smooth: false } };
    },
    create: (payload) => {
        const shape = payload.shape;
        if (!shape || typeof shape !== 'object')
            return null;
        const { type, id, x, y, props } = toCanonicalShapeParams(shape);
        const params = { type, props };
        if (id)
            params.id = id;
        if (x !== undefined)
            params.x = x;
        if (y !== undefined)
            params.y = y;
        return { name: 'create_shape', params };
    },
    update: (payload) => {
        const update = payload.update;
        if (!update || typeof update !== 'object')
            return null;
        const { id, props, x, y } = toCanonicalShapeParams(update);
        if (!id)
            return null;
        const params = { id, props };
        if (x !== undefined)
            params.x = x;
        if (y !== undefined)
            params.y = y;
        return { name: 'update_shape', params };
    },
    delete: (payload) => {
        const targetId = asString(payload.shapeId);
        if (!targetId)
            return null;
        return { name: 'delete_shape', params: { ids: [targetId] } };
    },
    move: (payload) => {
        const shapeId = asString(payload.shapeId);
        const x = toNumber(payload.x);
        const y = toNumber(payload.y);
        if (!shapeId || x === undefined || y === undefined)
            return null;
        return { name: 'move', params: { ids: [shapeId], target: { x, y } } };
    },
    align: (payload) => {
        const ids = asStringArray(payload.shapeIds);
        const alignment = asString(payload.alignment);
        if (!ids || !alignment)
            return null;
        const { axis, mode } = mapAlignment(alignment);
        return { name: 'align', params: { ids, axis, mode } };
    },
    distribute: (payload) => {
        const ids = asStringArray(payload.shapeIds);
        const direction = asString(payload.direction);
        if (!ids || !direction)
            return null;
        const axis = direction === 'horizontal' ? 'x' : 'y';
        return { name: 'distribute', params: { ids, axis } };
    },
    stack: (payload) => {
        const ids = asStringArray(payload.shapeIds);
        const direction = asString(payload.direction);
        const gap = toNumber(payload.gap) ?? 0;
        if (!ids || !direction)
            return null;
        const mapped = direction === 'horizontal' ? 'row' : 'column';
        return { name: 'stack', params: { ids, direction: mapped, gap } };
    },
    rotate: (payload) => {
        const shapeIds = asStringArray(payload.shapeIds);
        const degrees = toNumber(payload.degrees);
        if (!shapeIds || degrees === undefined)
            return null;
        const params = { shapeIds, degrees };
        const originX = toNumber(payload.originX);
        const originY = toNumber(payload.originY);
        const centerY = toNumber(payload.centerY);
        if (originX !== undefined)
            params.originX = originX;
        if (originY !== undefined)
            params.originY = originY;
        if (centerY !== undefined)
            params.centerY = centerY;
        return { name: 'rotate', params };
    },
    bringToFront: (payload) => {
        const ids = asStringArray(payload.shapeIds);
        if (!ids)
            return null;
        return { name: 'reorder', params: { ids, where: 'front' } };
    },
    sendToBack: (payload) => {
        const ids = asStringArray(payload.shapeIds);
        if (!ids)
            return null;
        return { name: 'reorder', params: { ids, where: 'back' } };
    },
    pen: (payload) => {
        const points = normalizePenPoints(payload.points);
        if (points.length < 2)
            return null;
        const closed = Boolean(payload.closed);
        const normalized = buildDrawSegments(points, closed);
        if (!normalized)
            return null;
        const color = asString(payload.color) ?? 'black';
        const fill = asString(payload.fill) ?? 'none';
        const params = {
            type: 'draw',
            x: normalized.origin.x,
            y: normalized.origin.y,
            props: {
                color,
                fill,
                dash: payload.style === 'straight' ? 'solid' : 'draw',
                size: 's',
                isPen: true,
                isClosed: closed,
                segments: normalized.segments,
            },
        };
        return { name: 'create_shape', params };
    },
};
function isTeacherActionCandidate(value) {
    return Boolean(value && typeof value === 'object' && typeof value._type === 'string');
}
export function convertTeacherAction(raw) {
    if (!isTeacherActionCandidate(raw)) {
        return null;
    }
    const actionType = raw._type;
    if (!teacherActionSet.has(actionType)) {
        return null;
    }
    const validation = validateTeacherActionPayload(actionType, raw);
    if (!validation.ok) {
        console.warn('[CanvasAgent:TeacherValidationFailed]', {
            action: actionType,
            issues: validation.issues,
        });
        return null;
    }
    const converter = teacherConverters[actionType];
    if (!converter) {
        console.warn('[CanvasAgent:TeacherActionUnsupported]', { action: actionType });
        return null;
    }
    return converter(raw);
}
//# sourceMappingURL=teacher-bridge.js.map