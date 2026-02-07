"use client";

import type { McpAppResource, McpAppToolDescriptor } from './types';
import { logJourneyEvent } from '@/lib/journey-logger';

type McpResourceContent = {
  text?: string;
  mimeType?: string;
  uri?: string;
};

const isHttpLike = (value: string) =>
  value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/');

export function resolveToolResourceUri(tool?: McpAppToolDescriptor): string | undefined {
  if (!tool) return undefined;
  const meta = tool._meta ?? {};
  const nested = (meta as any)?.ui;
  const nestedUri = typeof nested?.resourceUri === 'string' ? nested.resourceUri : undefined;
  if (nestedUri) return nestedUri;
  const flatUri = typeof (meta as any)?.['ui/resourceUri'] === 'string' ? (meta as any)['ui/resourceUri'] : undefined;
  return flatUri;
}

export async function callMcpMethod(
  serverUrl: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 12000,
): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    try {
      logJourneyEvent({
        eventType: 'mcp_call',
        source: 'ui',
        tool: method,
        payload: { serverUrl, params },
      });
    } catch { }
    const response = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID?.() || String(Date.now()),
        method,
        params,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(payload.error?.message || 'mcp_request_failed');
    }
    try {
      logJourneyEvent({
        eventType: 'mcp_result',
        source: 'ui',
        tool: method,
        durationMs: Date.now() - startedAt,
        payload: { serverUrl, result: payload?.result ?? null },
      });
    } catch { }
    return payload?.result ?? null;
  } catch (error) {
    try {
      logJourneyEvent({
        eventType: 'mcp_error',
        source: 'ui',
        tool: method,
        durationMs: Date.now() - startedAt,
        payload: { serverUrl, error: error instanceof Error ? error.message : String(error) },
      });
    } catch { }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function readResourceFromMcp(serverUrl: string, resourceUri: string): Promise<McpAppResource> {
  const result = await callMcpMethod(serverUrl, 'resources/read', { uri: resourceUri });
  const contents = Array.isArray(result?.contents) ? (result.contents as McpResourceContent[]) : [];
  const htmlParts: string[] = [];
  let mimeType: string | undefined = undefined;

  contents.forEach((item) => {
    if (typeof item?.mimeType === 'string' && !mimeType) {
      mimeType = item.mimeType;
    }
    if (typeof item?.text === 'string') {
      htmlParts.push(item.text);
    }
  });

  const html = htmlParts.join('\n').trim();
  if (!html) {
    throw new Error('mcp_resource_empty');
  }

  return { html, mimeType, meta: { resourceUri } };
}

async function readResourceFromUrl(resourceUri: string): Promise<McpAppResource> {
  const response = await fetch(resourceUri);
  if (!response.ok) {
    throw new Error(`resource_fetch_failed_${response.status}`);
  }
  const html = await response.text();
  return { html, mimeType: response.headers.get('content-type') || undefined, meta: { resourceUri } };
}

export async function loadMcpAppResource(args: {
  resourceUri: string;
  serverUrl?: string;
}): Promise<McpAppResource> {
  const { resourceUri, serverUrl } = args;
  if (!resourceUri) throw new Error('resource_uri_missing');

  if (resourceUri.startsWith('ui://')) {
    if (!serverUrl) {
      throw new Error('mcp_server_missing');
    }
    return readResourceFromMcp(serverUrl, resourceUri);
  }

  if (isHttpLike(resourceUri)) {
    return readResourceFromUrl(resourceUri);
  }

  throw new Error('unsupported_resource_uri');
}
