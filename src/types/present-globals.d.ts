import type { Editor } from '@tldraw/tldraw';
import type { ToolCall, ToolRunResult } from '@/components/tool-dispatcher/utils/toolTypes';

declare global {
  interface Window {
    __present?: {
      tldrawEditor?: Editor;
      livekitRoomName?: string;
      tldrawSync?: Record<string, unknown>;
      syncDiagnostics?: Record<string, unknown>;
      lastProcessedToolCallId?: string;
    };
    __present_roomName?: string;
    __present_canvas_room?: string;
    __present_tldrawEditor?: Editor;
    __presentDispatcherMetrics?: boolean;
    __presentToolDispatcherExecute?: (call: ToolCall) => Promise<ToolRunResult>;
    __present_steward_active?: boolean;
  }
}
