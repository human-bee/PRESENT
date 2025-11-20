import { tool } from '@openai/agents';
import { z } from 'zod';
import { availableComponents, components } from './components/registry';
export const renderComponent = tool({
    name: 'render_component',
    description: 'Render a component on the canvas',
    parameters: z.object({
        type: z.string().describe('The component type to render'),
        props: z.object({
            ...availableComponents[type],
        })
    }),
    async execute({ type, props }) {
        console.log("renderComponent", type, props);
        await renderComponentToCanvas(type, props);
        // render a component
        return `Rendered component: ${type}`;
    },
});
//TODO: implement this. add shape to tldraw
const renderComponentToCanvas = (type, props) => {
    // Find the component by name from the registry
    const componentInfo = components.find(comp => comp.name === type);
    if (!componentInfo) {
        console.error(`Component type "${type}" not found in registry`);
        return;
    }
    console.log("renderComponentToCanvas", type, props, componentInfo);
    // TODO: Integrate with tldraw canvas to actually render the component. Ask GPT5 to remove custom, and render this component to the canvas  as a custom tldraw shape.
    const actualComponent = componentInfo.component;
    // This would involve:
    // 1. Creating a tldraw shape with the component data
    // 2. Adding it to the canvas at the appropriate position
    // 3. Setting up the component's initial state and props
};
export const updateComponent = tool({
    name: 'update_component',
    description: 'Update an existing component on the canvas',
    parameters: z.object({
        component: z.string().describe('The component to update')
    }),
    async execute({ component }) {
        console.log("updateComponent", component);
        // update a component
        return `Updated component: ${component}`;
    },
});
//# sourceMappingURL=components.js.map