'use client';

import { useMemo } from 'react';
import type { WidgetRuntimeEnvelope } from '@present/contracts';
import {
  canvasRuntimeComponentTypes,
  getCanvasRuntimeComponentEntry,
} from './runtime-component-registry';

type CanvasRuntimeComponentHostProps = {
  nodeId: string;
  title: string;
  runtime: WidgetRuntimeEnvelope;
};

const hostShellStyle = {
  width: '100%',
  height: '100%',
  overflow: 'auto',
  background: '#f8fafc',
} satisfies React.CSSProperties;

const errorShellStyle = {
  width: '100%',
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  padding: '18px',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.06) 0%, rgba(148,163,184,0.12) 100%)',
  color: '#0f172a',
  fontFamily: '"IBM Plex Sans", "Helvetica Neue", sans-serif',
} satisfies React.CSSProperties;

const errorCardStyle = {
  width: '100%',
  maxWidth: '420px',
  borderRadius: '20px',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'rgba(255,255,255,0.88)',
  padding: '18px',
  boxShadow: '0 16px 44px rgba(15, 23, 42, 0.12)',
} satisfies React.CSSProperties;

function RuntimeComponentError({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div style={errorShellStyle}>
      <div style={errorCardStyle}>
        <div
          style={{
            fontSize: '10px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(15, 23, 42, 0.56)',
            fontWeight: 700,
            marginBottom: '10px',
          }}
        >
          Widget Runtime
        </div>
        <strong style={{ display: 'block', fontSize: '16px', marginBottom: '8px' }}>{title}</strong>
        <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'rgba(15,23,42,0.72)' }}>{detail}</p>
      </div>
    </div>
  );
}

export function CanvasRuntimeComponentHost({
  nodeId,
  title,
  runtime,
}: CanvasRuntimeComponentHostProps) {
  const componentType = typeof runtime.componentType === 'string' ? runtime.componentType.trim() : '';
  const registryEntry = componentType ? getCanvasRuntimeComponentEntry(componentType) : null;

  const parsedProps = useMemo(() => {
    if (!registryEntry) {
      return null;
    }

    return registryEntry.safeParse({
      title,
      ...(runtime.componentProps ?? {}),
    });
  }, [registryEntry, runtime.componentProps, title]);

  if (!componentType || !registryEntry) {
    return (
      <RuntimeComponentError
        title={title}
        detail={`Component widgets only support ${canvasRuntimeComponentTypes.join(', ')} in this wave. Received ${componentType || 'unknown'}.`}
      />
    );
  }

  if (!parsedProps?.success) {
    return (
      <RuntimeComponentError
        title={title}
        detail={`The ${componentType} widget props could not be parsed for the board runtime.`}
      />
    );
  }

  return (
    <div style={hostShellStyle}>
      {registryEntry.render(parsedProps.data, {
        nodeId,
        contextKey: runtime.contextKey ?? 'canvas',
      })}
    </div>
  );
}
