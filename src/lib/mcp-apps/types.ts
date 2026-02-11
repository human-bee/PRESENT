import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type McpAppResource = {
  html: string;
  mimeType?: string;
  meta?: Record<string, unknown>;
};

export type McpAppToolDescriptor = Tool;

export type McpAppHostContextInput = {
  toolName?: string;
  toolDescriptor?: McpAppToolDescriptor;
  displayMode?: string;
  containerWidth?: number;
  containerHeight?: number;
};
