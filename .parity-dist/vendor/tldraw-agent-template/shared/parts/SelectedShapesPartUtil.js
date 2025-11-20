import { structuredClone } from 'tldraw';
import { convertTldrawShapeToSimpleShape } from '../format/convertTldrawShapeToSimpleShape';
import { PromptPartUtil } from './PromptPartUtil';
export class SelectedShapesPartUtil extends PromptPartUtil {
    getPriority() {
        return 55; // selected shapes after context items (low priority)
    }
    getPart(_request, helpers) {
        if (!this.agent)
            return { type: 'selectedShapes', shapes: null };
        const { editor } = this.agent;
        const userSelectedShapes = editor.getSelectedShapes().map((v) => structuredClone(v)) ?? [];
        const simpleShapes = [];
        for (const shape of userSelectedShapes) {
            if (!shape)
                continue;
            const simpleShape = convertTldrawShapeToSimpleShape(editor, shape);
            if (simpleShape) {
                simpleShapes.push(simpleShape);
            }
        }
        const normalizedSimpleShapes = simpleShapes.map((shape) => {
            const offsetShape = helpers.applyOffsetToShape(shape);
            return helpers.roundShape(offsetShape);
        });
        return {
            type: 'selectedShapes',
            shapes: normalizedSimpleShapes,
        };
    }
    buildContent({ shapes }) {
        if (!shapes || shapes.length === 0) {
            return [];
        }
        return [
            'The user has selected these shapes. Focus your task on these shapes where applicable:',
            shapes.map((shape) => JSON.stringify(shape)).join('\n'),
        ];
    }
}
SelectedShapesPartUtil.type = 'selectedShapes';
//# sourceMappingURL=SelectedShapesPartUtil.js.map