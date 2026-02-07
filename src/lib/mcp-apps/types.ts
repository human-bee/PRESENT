export type McpAppResource = {
  html: string;
  mimeType?: string;
  meta?: Record<string, unknown>;
};

export type McpAppToolDescriptor = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: Record<string, unknown>;
};

export type McpAppHostContextInput = {
  toolName?: string;
  toolDescriptor?: McpAppToolDescriptor;
  displayMode?: string;
  containerWidth?: number;
  containerHeight?: number;
};
