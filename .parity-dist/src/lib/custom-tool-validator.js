/**
 * custom Tool Validator
 *
 * Validates and filters tools to ensure compatibility with custom SDK requirements.
 * Tool names must match pattern: ^[a-zA-Z0-9_-]+$
 */
// Valid tool name pattern as required by custom SDK
const VALID_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
/**
 * Validates a tool name against custom SDK requirements
 */
export function isValidToolName(name) {
    return VALID_TOOL_NAME_PATTERN.test(name);
}
/**
 * Sanitizes a tool name to make it valid for custom SDK
 * Replaces invalid characters with underscores
 */
export function sanitizeToolName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
/**
 * Filters and validates tools for custom SDK compatibility
 * @param tools Array of tools to validate
 * @returns Array of valid tools with sanitized names
 */
export function validatecustomTools(tools) {
    const validTools = [];
    const invalidTools = [];
    tools.forEach((tool, index) => {
        // Handle different tool formats
        const toolName = tool.name || tool.function?.name || `tool_${index}`;
        if (isValidToolName(toolName)) {
            validTools.push(tool);
        }
        else {
            // Log invalid tool for debugging
            console.warn(`🚨 [custom Tool Validator] Skipping tool with invalid name: "${toolName}" (contains invalid characters)`);
            invalidTools.push(toolName);
            // Optionally, we could sanitize and include the tool with a fixed name:
            // const sanitizedTool = {
            //   ...tool,
            //   name: sanitizeToolName(toolName),
            //   originalName: toolName
            // };
            // validTools.push(sanitizedTool);
        }
    });
    if (invalidTools.length > 0) {
        console.log(`📊 [custom Tool Validator] Filtered out ${invalidTools.length} invalid tools:`, invalidTools);
        console.log(`✅ [custom Tool Validator] ${validTools.length} valid tools passed through`);
    }
    return validTools;
}
/**
 * Creates a validated tool registry from a mixed registry
 */
export function createValidatedToolRegistry(registry) {
    if (!registry)
        return registry;
    // Handle Map-style registry
    if (registry instanceof Map) {
        const validatedMap = new Map();
        registry.forEach((tool, name) => {
            if (isValidToolName(name)) {
                validatedMap.set(name, tool);
            }
            else {
                console.warn(`🚨 [Tool Registry] Filtering out tool with invalid name: "${name}"`);
            }
        });
        return validatedMap;
    }
    // Handle object-style registry
    if (typeof registry === 'object') {
        const validatedRegistry = {};
        Object.entries(registry).forEach(([name, tool]) => {
            if (isValidToolName(name)) {
                validatedRegistry[name] = tool;
            }
            else {
                console.warn(`🚨 [Tool Registry] Filtering out tool with invalid name: "${name}"`);
            }
        });
        return validatedRegistry;
    }
    return registry;
}
//# sourceMappingURL=custom-tool-validator.js.map