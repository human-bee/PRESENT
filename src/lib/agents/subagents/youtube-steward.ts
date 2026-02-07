import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

const CEREBRAS_MODEL = getModelForSteward('YOUTUBE_STEWARD_FAST_MODEL');

const YOUTUBE_STEWARD_INSTRUCTIONS = `
You are a fast YouTube assistant that maps user requests to YouTube MCP tool calls.

Available YouTube MCP Tools:
- searchVideos: Search for videos. Args: { query, maxResults?, order? }
- getVideoDetails: Get video metadata. Args: { videoId }
- getChannelVideos: List videos from channel. Args: { channelId, maxResults? }
- getTrending: Get trending videos. Args: { categoryId?, regionCode? }

Category IDs: music=10, gaming=20, education=27, science=28, howto=26, entertainment=24, news=25

Rules:
1. Parse the user's intent and map to the appropriate tool
2. For "latest" or "newest" requests, use order: "date"
3. For "popular" or "best" requests, use order: "viewCount"
4. Always call commit_action with the result

Kind values: search, getVideo, getChannel, getTrending, embed, noOp
`;

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_action',
      description: 'Commit the YouTube action',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['search', 'getVideo', 'getChannel', 'getTrending', 'embed', 'noOp'],
          },
          videoId: { type: 'string' },
          channelId: { type: 'string' },
          reason: { type: 'string' },
          mcpToolName: { type: 'string', description: 'MCP tool to call' },
          mcpToolArgs: { type: 'string', description: 'MCP tool args as JSON string' },
        },
        required: ['kind'],
      },
    },
  },
];

type YouTubeAction = {
  kind: string;
  videoId?: string;
  channelId?: string;
  reason?: string;
  mcpTool: { name: string; args: Record<string, unknown> } | null;
};

export async function runYouTubeSteward(params: { instruction: string; context?: any; billingUserId?: string }): Promise<YouTubeAction> {
  const { instruction, context } = params;
  const billingUserId = typeof params.billingUserId === 'string' ? params.billingUserId : '';
  const cerebrasKey =
    BYOK_REQUIRED && billingUserId
      ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
      : null;

  // The FAST YouTube steward uses Cerebras; if it's not configured we return a best-effort heuristic
  // so the rest of the system can keep running.
  if (BYOK_REQUIRED && !cerebrasKey) {
    return {
      kind: 'search',
      reason: 'BYOK Cerebras key missing (falling back to heuristic)',
      mcpTool: { name: 'searchVideos', args: { query: instruction, maxResults: 5 } },
    };
  }

  if (!BYOK_REQUIRED && !isFastStewardReady()) {
    return {
      kind: 'search',
      reason: 'FAST YouTube steward unavailable (missing CEREBRAS_API_KEY)',
      mcpTool: { name: 'searchVideos', args: { query: instruction, maxResults: 5 } },
    };
  }

  const contextInfo = context?.currentVideo
    ? `Current video: ${context.currentVideo.title} (${context.currentVideo.videoId})`
    : '';

  const messages = [
    { role: 'system' as const, content: YOUTUBE_STEWARD_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `${contextInfo}\n\nInstruction: "${instruction}"\n\nDetermine the best YouTube action and call commit_action.`,
    },
  ];

  try {
    const client = getCerebrasClient(cerebrasKey ?? undefined);
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0]?.message;

    if (choice?.tool_calls?.[0]) {
      const toolCall = choice.tool_calls[0];
      if (toolCall.function.name === 'commit_action') {
        const args = JSON.parse(toolCall.function.arguments);
        let mcpTool: { name: string; args: Record<string, unknown> } | null = null;

        if (args.mcpToolName) {
          try {
            mcpTool = {
              name: args.mcpToolName,
              args: args.mcpToolArgs ? JSON.parse(args.mcpToolArgs) : {},
            };
          } catch {
            mcpTool = { name: args.mcpToolName, args: {} };
          }
        }

        return {
          kind: args.kind,
          videoId: args.videoId,
          channelId: args.channelId,
          reason: args.reason,
          mcpTool,
        };
      }
    }

    return {
      kind: 'search',
      mcpTool: { name: 'searchVideos', args: { query: instruction, maxResults: 5 } },
    };
  } catch (error) {
    console.error('[YouTubeSteward] Error:', error);
    return { kind: 'noOp', reason: 'Error processing instruction', mcpTool: null };
  }
}
