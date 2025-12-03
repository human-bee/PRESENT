import { Agent, run } from '@openai/agents';
import { OpenAIProvider, OpenAIChatCompletionsModel } from '@openai/agents-openai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';

// --- Configuration ---

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_CEREBRAS_BASE_URL = 'https://api.cerebras.ai';

type FastProvider = 'groq' | 'cerebras';

const resolveFastProvider = (): FastProvider => {
    const preference =
        process.env.LINEAR_STEWARD_FAST_PROVIDER ??
        process.env.AGENT_LLM_PROVIDER ??
        'groq'; // Default to Groq for speed
    const normalized = preference.trim().toLowerCase();
    if (normalized === 'cerebras') return 'cerebras';
    return 'groq';
};

export const linearStewardFastProvider = resolveFastProvider();

const defaultModelByProvider: Record<FastProvider, string> = {
    groq: 'llama-3.1-70b-versatile', // Good balance of speed and smarts
    cerebras: 'llama3.1-70b',
};

// --- Provider Setup (Copied/Adapted from flowchart-steward-fast) ---

const createProviderConfig = () => {
    if (linearStewardFastProvider === 'cerebras') {
        return {
            kind: 'cerebras',
            baseURL: process.env.CEREBRAS_API_BASE_URL || DEFAULT_CEREBRAS_BASE_URL,
            apiKey: process.env.CEREBRAS_API_KEY,
        };
    }
    return {
        kind: 'groq',
        baseURL: process.env.GROQ_API_BASE_URL || DEFAULT_GROQ_BASE_URL,
        apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
    };
};

const providerConfig = createProviderConfig();
const resolvedModel = process.env.LINEAR_STEWARD_FAST_MODEL || defaultModelByProvider[linearStewardFastProvider];

const buildModel = () => {
    if (providerConfig.kind === 'cerebras') {
        const client = new Cerebras({
            apiKey: providerConfig.apiKey,
            baseURL: providerConfig.baseURL,
        });
        // @ts-ignore - Cerebras SDK compatibility
        const model = new OpenAIChatCompletionsModel(client.chat.completions, resolvedModel);
        return model;
    }

    const provider = new OpenAIProvider({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
    });
    return provider.getModel(resolvedModel);
};

const lazyModel = buildModel();

// --- Agent Definition ---

const LINEAR_STEWARD_INSTRUCTIONS = `
You are a fast, precise assistant for the Linear issue tracking system.
Your goal is to map a user's natural language instruction to a Linear MCP tool call.

Context provided:
- Current issues (id, identifier, title, status, assignee, labels)

Rules:
1. Analyze the instruction and the current issues.
2. If the user refers to an issue by title or identifier (fuzzy match), find its ID.
3. Output a JSON object with "kind" describing the action and "mcpTool" containing the exact tool call.
4. For any action not in the list, use kind: "noOp".

Available Linear MCP Tools:

ISSUES:
- list_issues: List issues. Args: { query?: string, limit?: number }
- get_issue: Get issue details. Args: { issueId: string }
- create_issue: Create new issue. Args: { title: string, description?: string, teamId?: string, stateId?: string, priority?: number, labelIds?: string[] }
- update_issue: Update issue. Args: { issueId: string, title?: string, description?: string, stateId?: string, priority?: number, assigneeId?: string }
- delete_issue: Delete issue. Args: { issueId: string }

COMMENTS:
- list_comments: List comments on issue. Args: { issueId: string }
- create_comment: Add comment to issue. Args: { issueId: string, body: string }

LABELS:
- list_labels: List all labels. Args: { teamId?: string }
- add_issue_label: Add label to issue. Args: { issueId: string, labelId: string }
- remove_issue_label: Remove label from issue. Args: { issueId: string, labelId: string }

RELATIONS:
- list_issue_relations: List issue relations. Args: { issueId: string }
- create_issue_relation: Link two issues. Args: { issueId: string, relatedIssueId: string, type: "blocks" | "duplicate" | "related" }

TEAMS & PROJECTS:
- list_teams: List all teams. Args: {}
- list_projects: List projects. Args: { teamId?: string }

Kind values: moveIssue, updateIssue, createIssue, addComment, addLabel, removeLabel, linkIssue, search, noOp
`;

// We don't actually need the Agent framework to execute tools here if we just want JSON output.
// But using the Agent framework allows us to define the "tools" as functions the LLM *could* call,
// or we can just ask for JSON output.
// Given "flowchart-steward-fast" uses the Agent framework with a "commit" tool, let's do similar.

const commit_action = {
    type: 'function',
    name: 'commit_action',
    description: 'Commit the determined Linear action',
    parameters: {
        type: 'object',
        properties: {
            kind: { 
                type: 'string', 
                enum: ['moveIssue', 'updateIssue', 'createIssue', 'addComment', 'addLabel', 'removeLabel', 'linkIssue', 'search', 'noOp'] 
            },
            issueId: { type: 'string' },
            toStatus: { type: 'string' },
            reason: { type: 'string' },
            mcpTool: {
                anyOf: [
                    {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            args: { type: 'object' },
                        },
                        required: ['name', 'args'],
                    },
                    { type: 'null' },
                ],
            }
        },
        required: ['kind', 'mcpTool'],
    },
    execute: async (args: any) => {
        return args;
    }
};

export const linearStewardFast = new Agent({
    name: 'LinearStewardFAST',
    model: lazyModel as any,
    instructions: LINEAR_STEWARD_INSTRUCTIONS,
    tools: [commit_action as any],
});

export async function runLinearStewardFast(params: { instruction: string; context: any }) {
    const { instruction, context } = params;

    // Format context for the prompt
    const issuesList = (context.issues || [])
        .map((i: any) => `- [${i.id}] ${i.title} (Status: ${i.status}, Assignee: ${i.assignee})`)
        .join('\n');

    const prompt = `
Context Issues:
${issuesList}

Instruction: "${instruction}"

Determine the best Linear tool action. Call 'commit_action' with your decision.
`;

    try {
        // Hack: Capture the tool call arguments
        let capturedAction = null;

        const capture_tool = {
            ...commit_action,
            execute: async (args: any) => {
                capturedAction = args;
                return "Action committed.";
            }
        };

        // Create a temporary agent instance with the capture tool
        const tempAgent = new Agent({
            name: 'LinearStewardFAST',
            model: lazyModel as any,
            instructions: LINEAR_STEWARD_INSTRUCTIONS,
            tools: [capture_tool as any],
        });

        await run(tempAgent, prompt);

        return capturedAction || { kind: 'search', query: instruction, mcpTool: { name: 'linear_issues_search', args: { query: instruction } } };
    } catch (error) {
        console.error('[LinearSteward] Error:', error);
        return { kind: 'noOp', reason: 'Error processing instruction', mcpTool: null };
    }
}
