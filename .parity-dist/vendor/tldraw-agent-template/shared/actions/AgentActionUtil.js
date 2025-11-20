export class AgentActionUtil {
    constructor(agent) {
        this.agent = agent;
        this.editor = agent?.editor;
    }
    /**
     * Get a schema to use for the model's response.
     * @returns The schema, or null to not use a schema
     */
    getSchema() {
        return null;
    }
    /**
     * Get information about the action to display within the chat history UI.
     * Return null to not show anything.
     * Defaults to the stringified action if not set.
     */
    getInfo(_action) {
        return {};
    }
    /**
     * Transforms the action before saving it to chat history.
     * Useful for sanitizing or correcting actions.
     * @returns The transformed action, or null to reject the action
     */
    sanitizeAction(action, _helpers) {
        return action;
    }
    /**
     * Apply the action to the editor.
     * Any changes that happen during this function will be displayed as a diff.
     */
    applyAction(_action, _helpers) {
        // Do nothing by default
    }
    /**
     * Whether the action gets saved to history.
     */
    savesToHistory() {
        return true;
    }
    /**
     * Build a system message that gets concatenated with the other system messages.
     * @returns The system message, or null to not add anything to the system message.
     */
    buildSystemPrompt() {
        return null;
    }
}
//# sourceMappingURL=AgentActionUtil.js.map