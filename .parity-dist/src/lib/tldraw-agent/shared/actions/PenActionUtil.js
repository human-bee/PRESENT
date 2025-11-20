import { createShapeId, Vec } from 'tldraw';
import { z } from 'zod';
import { asColor, SimpleColor } from '../format/SimpleColor';
import { convertSimpleFillToTldrawFill, SimpleFillSchema } from '../format/SimpleFill';
import { AgentActionUtil } from './AgentActionUtil';
const PenAction = z
    .object({
    _type: z.literal('pen'),
    color: SimpleColor,
    closed: z.boolean(),
    fill: SimpleFillSchema,
    intent: z.string(),
    points: z.array(z.object({
        x: z.number(),
        y: z.number(),
    })),
    style: z.enum(['smooth', 'straight']),
});
export class PenActionUtil extends AgentActionUtil {
    getSchema() {
        return PenAction;
    }
    getInfo(action) {
        return {
            icon: 'pencil',
            description: action.intent ?? '',
        };
    }
    sanitizeAction(action, helpers) {
        if (!action.points)
            return action;
        // This is a complex action for the model, so validate the data it gives us
        const validPoints = action.points
            .map((point) => helpers.ensureValueIsVec(point))
            .filter((v) => v !== null);
        action.points = validPoints;
        action.closed = helpers.ensureValueIsBoolean(action.closed) ?? false;
        action.fill = helpers.ensureValueIsSimpleFill(action.fill) ?? 'none';
        return action;
    }
    applyAction(action, helpers) {
        if (!this.agent)
            return;
        if (!action.points)
            return;
        if (action.points.length === 0)
            return;
        action.points = action.points.map((point) => helpers.removeOffsetFromVec(point));
        if (action.closed) {
            const firstPoint = action.points[0];
            action.points.push(firstPoint);
        }
        const minX = Math.min(...action.points.map((p) => p.x));
        const minY = Math.min(...action.points.map((p) => p.y));
        const points = [];
        const maxDistanceBetweenPoints = action.style === 'smooth' ? 10 : 2;
        for (let i = 0; i < action.points.length - 1; i++) {
            const point = action.points[i];
            points.push(point);
            const nextPoint = action.points[i + 1];
            if (!nextPoint)
                continue;
            const distance = Vec.Dist(point, nextPoint);
            const numPointsToAdd = Math.floor(distance / maxDistanceBetweenPoints);
            const pointsToAdd = Array.from({ length: numPointsToAdd }, (_, j) => {
                const t = (j + 1) / (numPointsToAdd + 1);
                return Vec.Lrp(point, nextPoint, t);
            });
            points.push(...pointsToAdd);
        }
        if (points.length === 0) {
            return;
        }
        const segments = [
            {
                type: 'free',
                points: points.map((point) => ({
                    x: point.x - minX,
                    y: point.y - minY,
                    z: 0.75,
                })),
            },
        ];
        this.agent.editor.createShape({
            id: createShapeId(),
            type: 'draw',
            x: minX,
            y: minY,
            props: {
                color: asColor(action.color ?? 'black'),
                fill: convertSimpleFillToTldrawFill(action.fill ?? 'none'),
                dash: 'draw',
                size: 's',
                segments,
                isComplete: action.complete,
                isClosed: action.closed,
                isPen: true,
            },
        });
    }
}
PenActionUtil.type = 'pen';
//# sourceMappingURL=PenActionUtil.js.map