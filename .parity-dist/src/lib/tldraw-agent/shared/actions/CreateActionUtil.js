import { toRichText } from 'tldraw';
import z from 'zod';
import { convertSimpleShapeToTldrawShape, SIMPLE_TO_GEO_TYPES, } from '../format/convertSimpleShapeToTldrawShape';
import { SimpleShapeSchema } from '../format/SimpleShape';
import { AgentActionUtil } from './AgentActionUtil';
const CreateAction = z
    .object({
    _type: z.literal('create'),
    intent: z.string(),
    shape: SimpleShapeSchema,
})
    .meta({ title: 'Create', description: 'The AI creates a new shape.' });
export class CreateActionUtil extends AgentActionUtil {
    getSchema() {
        return CreateAction;
    }
    getInfo(action) {
        return {
            icon: 'pencil',
            description: action.intent ?? '',
        };
    }
    sanitizeAction(action, helpers) {
        if (!action.complete)
            return action;
        const { shape } = action;
        const hasValidId = typeof shape.shapeId === 'string' && shape.shapeId.trim().length > 0;
        if (!hasValidId) {
            const fallbackId = helpers.generateFallbackSimpleShapeId();
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[CanvasAgent] Missing shapeId for create action. Generated fallback id.', {
                    fallbackId,
                    intent: action.intent,
                });
            }
            shape.shapeId = fallbackId;
        }
        else if (shape.shapeId !== shape.shapeId.trim()) {
            shape.shapeId = shape.shapeId.trim();
        }
        // Ensure the created shape has a unique ID
        shape.shapeId = helpers.ensureShapeIdIsUnique(shape.shapeId);
        // If the shape is an arrow, ensure the from and to IDs are real shapes
        if (shape._type === 'arrow') {
            if (shape.fromId) {
                shape.fromId = helpers.ensureShapeIdExists(shape.fromId);
            }
            if (shape.toId) {
                shape.toId = helpers.ensureShapeIdExists(shape.toId);
            }
        }
        return action;
    }
    applyAction(action, helpers) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        const { editor } = this.agent;
        // Translate the shape back to the chat's position
        action.shape = helpers.removeOffsetFromShape(action.shape);
        const result = convertSimpleShapeToTldrawShape(editor, action.shape, {
            defaultShape: getDefaultShape(action.shape._type),
        });
        editor.createShape(result.shape);
        // Handle arrow bindings if they exist
        if (result.bindings) {
            for (const binding of result.bindings) {
                editor.createBinding({
                    type: binding.type,
                    fromId: binding.fromId,
                    toId: binding.toId,
                    props: binding.props,
                    meta: binding.meta,
                });
            }
        }
    }
}
CreateActionUtil.type = 'create';
function getDefaultShape(shapeType) {
    const isGeo = shapeType in SIMPLE_TO_GEO_TYPES;
    return isGeo
        ? SHAPE_DEFAULTS.geo
        : (SHAPE_DEFAULTS[shapeType] ?? SHAPE_DEFAULTS.unknown);
}
const SHARED_DEFAULTS = {
    isLocked: false,
    opacity: 1,
    rotation: 0,
    meta: {},
};
const SHAPE_DEFAULTS = {
    text: {
        ...SHARED_DEFAULTS,
        props: {
            autoSize: true,
            color: 'black',
            font: 'draw',
            richText: toRichText(''),
            scale: 1,
            size: 's',
            textAlign: 'start',
            w: 0,
        },
    },
    line: {
        ...SHARED_DEFAULTS,
        props: {
            size: 's',
            color: 'black',
            dash: 'draw',
            points: {
                a1: {
                    id: 'a1',
                    index: 'a1',
                    x: 0,
                    y: 0,
                },
                a2: {
                    id: 'a2',
                    index: 'a2',
                    x: 100,
                    y: 0,
                },
            },
            scale: 1,
            spline: 'line',
        },
    },
    arrow: {
        ...SHARED_DEFAULTS,
        props: {
            arrowheadEnd: 'arrow',
            arrowheadStart: 'none',
            bend: 0,
            color: 'black',
            dash: 'draw',
            elbowMidPoint: 0.5,
            end: { x: 100, y: 0 },
            fill: 'none',
            font: 'draw',
            kind: 'arc',
            labelColor: 'black',
            labelPosition: 0.5,
            richText: toRichText(''),
            scale: 1,
            size: 's',
            start: { x: 0, y: 0 },
        },
    },
    geo: {
        ...SHARED_DEFAULTS,
        props: {
            align: 'middle',
            color: 'black',
            dash: 'draw',
            fill: 'none',
            font: 'draw',
            geo: 'rectangle',
            growY: 0,
            h: 100,
            labelColor: 'black',
            richText: toRichText(''),
            scale: 1,
            size: 's',
            url: '',
            verticalAlign: 'middle',
            w: 100,
        },
    },
    note: {
        ...SHARED_DEFAULTS,
        props: {
            color: 'black',
            richText: toRichText(''),
            size: 's',
            align: 'middle',
            font: 'draw',
            fontSizeAdjustment: 0,
            growY: 0,
            labelColor: 'black',
            scale: 1,
            url: '',
            verticalAlign: 'middle',
        },
    },
    draw: {
        ...SHARED_DEFAULTS,
        props: {},
    },
    unknown: {
        ...SHARED_DEFAULTS,
        props: {},
    },
};
//# sourceMappingURL=CreateActionUtil.js.map