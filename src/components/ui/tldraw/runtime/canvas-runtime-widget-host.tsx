'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Artifact, WidgetInstance } from '@present/contracts';
import McpAppWidget from '@/components/ui/mcp/mcp-app-widget';
import { CanvasRuntimeComponentHost } from './canvas-runtime-component-host';

type ArtifactResponse = {
  artifact: Artifact;
};

type CanvasRuntimeWidgetHostProps = {
  node: WidgetInstance;
};

const bodyShellStyle = {
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: '#fff',
} satisfies React.CSSProperties;

const messageStyle = {
  margin: 0,
  padding: '18px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'rgba(248,250,252,0.72)',
  fontFamily: '"IBM Plex Sans", "Helvetica Neue", sans-serif',
} satisfies React.CSSProperties;

async function loadArtifact(resourceUri: string) {
  const response = await fetch(resourceUri);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as ArtifactResponse;
}

function HtmlBundleWidgetHost({ node }: { node: WidgetInstance }) {
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const artifactUri = node.artifactUri;
  const syncVersion = node.syncVersion;

  useEffect(() => {
    let cancelled = false;
    if (!artifactUri) {
      setStatus('error');
      setError('Artifact route missing for HTML widget bundle.');
      return;
    }

    setStatus('loading');
    setError(null);

    loadArtifact(artifactUri)
      .then((payload) => {
        if (cancelled) return;
        setHtml(payload.artifact.content || '');
        setStatus('ready');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setStatus('error');
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [artifactUri, syncVersion]);

  if (status === 'error') {
    return <p style={messageStyle}>{error ?? 'Widget bundle could not be loaded from the artifact route.'}</p>;
  }

  if (!html) {
    return <p style={messageStyle}>{status === 'loading' ? 'Loading widget bundle…' : 'Widget bundle is empty.'}</p>;
  }

  return (
    <iframe
      title={node.title}
      sandbox="allow-scripts"
      srcDoc={html}
      style={{ width: '100%', height: '100%', border: '0', background: '#fff' }}
    />
  );
}

export function CanvasRuntimeWidgetHost({ node }: CanvasRuntimeWidgetHostProps) {
  const runtime = node.widgetRuntime;
  const runtimeResourceUri = runtime.resourceUri;
  const runtimeServerName = runtime.serverName;
  const runtimeToolName = runtime.toolName;
  const runtimeDisplayMode = runtime.displayMode;
  const runtimeContextKey = runtime.contextKey;
  const runtimeArgs = runtime.args;
  const runtimeComponentProps = runtime.componentProps;

  const mcpProps = useMemo(
    () => ({
      title: node.title,
      ...(runtimeComponentProps ?? {}),
      toolName: runtimeToolName ?? undefined,
      serverName: runtimeServerName ?? undefined,
      resourceUri: runtimeResourceUri ?? undefined,
      args: runtimeArgs ?? undefined,
      displayMode: runtimeDisplayMode ?? undefined,
      contextKey: runtimeContextKey ?? 'canvas',
      __custom_message_id: `runtime-${node.id}`,
    }),
    [
      node.id,
      node.title,
      runtimeArgs,
      runtimeComponentProps,
      runtimeContextKey,
      runtimeDisplayMode,
      runtimeResourceUri,
      runtimeServerName,
      runtimeToolName,
    ],
  );

  if (runtime.hostKind === 'mcp_app') {
    return (
      <div style={bodyShellStyle}>
        <McpAppWidget {...mcpProps} />
      </div>
    );
  }

  if (runtime.hostKind === 'component') {
    return (
      <div style={bodyShellStyle}>
        <CanvasRuntimeComponentHost nodeId={node.id} title={node.title} runtime={runtime} />
      </div>
    );
  }

  return (
    <div style={bodyShellStyle}>
      <HtmlBundleWidgetHost node={node} />
    </div>
  );
}
