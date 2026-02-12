import type { Editor } from '@tldraw/tldraw';
import type { ToolCall, ToolRunResult } from '@/components/tool-dispatcher/utils/toolTypes';

type MergedToolExecutor = (params: Record<string, unknown>) => Promise<unknown> | unknown;

type CustomMcpToolEntry =
  | MergedToolExecutor
  | {
      execute?: MergedToolExecutor;
    };

declare global {
  interface Window {
    __present?: {
      tldrawEditor?: Editor;
      livekitRoomName?: string;
    };
    __present_roomName?: string;
    __present_canvas_room?: string;
    __present_tldrawEditor?: Editor;
    __presentDispatcherMetrics?: boolean;
    __presentToolDispatcherExecute?: (call: ToolCall) => Promise<ToolRunResult>;
    __present_steward_active?: boolean;
    __present_mermaid_last_shape_id?: string;
    __present_mermaid_session?: {
      text?: string;
      last?: string;
    };
    __custom_mcp_tools?: Record<string, CustomMcpToolEntry>;
    __custom_tool_dispatcher?: {
      executeMCPTool: (
        toolName: string,
        params: Record<string, unknown>,
      ) => Promise<ToolRunResult>;
    };
    callMcpTool?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
  }
}
