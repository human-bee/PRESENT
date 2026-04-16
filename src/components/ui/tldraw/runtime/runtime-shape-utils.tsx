'use client';

import type { SyntheticEvent } from 'react';
import {
  BaseBoxShapeUtil,
  HTMLContainer as TldrawHTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
} from '@tldraw/tldraw';
import type {
  ApprovalChip,
  ArtifactNode,
  MediaTile,
  RunNode,
  TraceRail,
  WidgetInstance,
} from '@present/contracts';
import type { RuntimeCardShapeProps, RuntimeWidgetShapeProps } from '../canvas/utils/types';
import {
  useCanvasRuntimeNode,
  useCanvasRuntimeShapeContext,
} from './canvas-runtime-shape-context';
import { CanvasRuntimeWidgetHost } from './canvas-runtime-widget-host';

export type RuntimeCardShape = TLBaseShape<'runtime_card', RuntimeCardShapeProps>;
export type RuntimeWidgetShape = TLBaseShape<'runtime_widget', RuntimeWidgetShapeProps>;

const stopCanvasEvent = (event: SyntheticEvent) => {
  event.stopPropagation();
};

const asString = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value : null);

const containerStyle = (w: number, h: number, background: string) =>
  ({
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
    overflow: 'hidden',
    pointerEvents: 'all',
    position: 'relative',
    width: `${Math.max(0, w)}px`,
    height: `${Math.max(0, h)}px`,
    borderRadius: '22px',
    border: '1px solid rgba(25, 31, 42, 0.16)',
    background,
    boxShadow: '0 18px 64px rgba(10, 12, 16, 0.18)',
  }) satisfies React.CSSProperties;

const cardShellStyle = (tone: string) =>
  ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '16px',
    background: tone,
    color: '#0f172a',
    fontFamily: '"IBM Plex Sans", "Helvetica Neue", sans-serif',
  }) satisfies React.CSSProperties;

const eyebrowStyle = {
  fontSize: '10px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
  color: 'rgba(15, 23, 42, 0.54)',
  fontWeight: 700,
};

const titleStyle = {
  fontSize: '16px',
  lineHeight: 1.2,
  fontWeight: 700,
  color: '#0f172a',
};

const textStyle = {
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'rgba(15, 23, 42, 0.72)',
};

const buttonRowStyle = {
  display: 'flex',
  gap: '8px',
  marginTop: 'auto',
};

const smallButtonStyle = (primary = false) =>
  ({
    borderRadius: '999px',
    border: primary ? '1px solid rgba(15, 23, 42, 0.08)' : '1px solid rgba(15, 23, 42, 0.16)',
    background: primary ? '#111827' : 'rgba(255,255,255,0.65)',
    color: primary ? '#f8fafc' : '#111827',
    padding: '8px 12px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
  }) satisfies React.CSSProperties;

const tracePreviewStyle = {
  display: 'grid',
  gap: '6px',
  marginTop: '4px',
} satisfies React.CSSProperties;

function RuntimeCardSurface({ shape }: { shape: RuntimeCardShape }) {
  const node = useCanvasRuntimeNode(shape.props.nodeId);
  const runtime = useCanvasRuntimeShapeContext();

  if (!node) {
    return (
      <div style={cardShellStyle('linear-gradient(180deg, #f8fafc 0%, #edf2f7 100%)')}>
        <div style={eyebrowStyle}>{shape.props.nodeKind}</div>
        <div style={titleStyle}>{shape.props.title}</div>
        {shape.props.detail ? <p style={textStyle}>{shape.props.detail}</p> : null}
      </div>
    );
  }

  switch (node.kind) {
    case 'agent-seat': {
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #fff8e8 0%, #fce7c8 100%)')}>
          <div style={eyebrowStyle}>{String(node.metadata['presenceState'] ?? node.state)}</div>
          <div style={titleStyle}>{node.label}</div>
          <p style={textStyle}>{node.participantIdentity ?? 'room participant'}</p>
          <p style={textStyle}>{asString(node.metadata['roomName']) ?? 'Canvas room seat'}</p>
        </div>
      );
    }
    case 'media-tile': {
      const label = asString(node.metadata['label']) ?? node.participantIdentity;
      const activeMedia = ['audio', 'video', 'screen'].filter((key) => node.media[key as keyof MediaTile['media']]);
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #ecfeff 0%, #c7f0ff 100%)')}>
          <div style={eyebrowStyle}>media-tile</div>
          <div style={titleStyle}>{label}</div>
          <p style={textStyle}>{activeMedia.length ? activeMedia.join(' • ') : 'connected'}</p>
          <p style={textStyle}>Identity: {node.participantIdentity}</p>
        </div>
      );
    }
    case 'run-lane': {
      const taskType = asString(node.metadata['taskType']) ?? 'server-owned task';
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #f8f0ff 0%, #eadcff 100%)')}>
          <div style={eyebrowStyle}>{node.status}</div>
          <div style={titleStyle}>{node.title}</div>
          <p style={textStyle}>{taskType}</p>
          <p style={textStyle}>Trace: {asString(node.metadata['traceId']) ?? 'pending'}</p>
        </div>
      );
    }
    case 'artifact-card': {
      const artifactKind = asString(node.metadata['kind']) ?? node.mimeType;
      const filePath = asString(node.metadata['filePath']);
      const preview = asString(node.metadata['preview']);
      const isPatch = artifactKind === 'file_patch';
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #fefce8 0%, #fef3c7 100%)')}>
          <div style={eyebrowStyle}>{artifactKind}</div>
          <div style={titleStyle}>{node.title}</div>
          <p style={textStyle}>{filePath ?? preview ?? node.mimeType}</p>
          {isPatch && runtime?.onApplyPatchArtifact ? (
            <div style={buttonRowStyle}>
              <button
                type="button"
                style={smallButtonStyle(true)}
                disabled={!runtime.canApplyLatestPatch}
                onPointerDown={stopCanvasEvent}
                onClick={(event) => {
                  stopCanvasEvent(event);
                  runtime.onApplyPatchArtifact?.(node.artifactId);
                }}
              >
                Apply Patch
              </button>
            </div>
          ) : null}
        </div>
      );
    }
    case 'approval-chip': {
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #fff1f2 0%, #ffe4e6 100%)')}>
          <div style={eyebrowStyle}>{String(node.metadata['kind'] ?? node.state)}</div>
          <div style={titleStyle}>{node.title}</div>
          <p style={textStyle}>{node.detail}</p>
          {node.state === 'pending' && runtime?.onResolveApproval ? (
            <div style={buttonRowStyle}>
              <button
                type="button"
                style={smallButtonStyle(true)}
                onPointerDown={stopCanvasEvent}
                onClick={(event) => {
                  stopCanvasEvent(event);
                  runtime.onResolveApproval?.(node.approvalRequestId, 'approved');
                }}
              >
                Approve
              </button>
              <button
                type="button"
                style={smallButtonStyle(false)}
                onPointerDown={stopCanvasEvent}
                onClick={(event) => {
                  stopCanvasEvent(event);
                  runtime.onResolveApproval?.(node.approvalRequestId, 'rejected');
                }}
              >
                Reject
              </button>
            </div>
          ) : null}
        </div>
      );
    }
    case 'trace-rail': {
      const preview = Array.isArray(node.metadata['preview']) ? (node.metadata['preview'] as Array<Record<string, unknown>>) : [];
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #ecfccb 0%, #d9f99d 100%)')}>
          <div style={eyebrowStyle}>{node.latestEventType ?? 'trace'}</div>
          <div style={titleStyle}>{node.title}</div>
          <p style={textStyle}>{node.eventCount} event(s) in the live replay window</p>
          {preview.length ? (
            <div style={tracePreviewStyle}>
              {preview.slice(0, 3).map((entry) => (
                <div key={String(entry['id'] ?? Math.random())} style={textStyle}>
                  <strong>{asString(entry['type']) ?? 'event'}</strong> {asString(entry['title']) ?? ''}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    default:
      return (
        <div style={cardShellStyle('linear-gradient(180deg, #f8fafc 0%, #edf2f7 100%)')}>
          <div style={eyebrowStyle}>{node.kind}</div>
          <div style={titleStyle}>{shape.props.title}</div>
        </div>
      );
  }
}

function RuntimeWidgetSurface({ shape }: { shape: RuntimeWidgetShape }) {
  const node = useCanvasRuntimeNode(shape.props.nodeId) as WidgetInstance | null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        background: 'linear-gradient(180deg, #111827 0%, #0f172a 100%)',
        color: '#f8fafc',
        fontFamily: '"IBM Plex Sans", "Helvetica Neue", sans-serif',
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ ...eyebrowStyle, color: 'rgba(248, 250, 252, 0.56)' }}>widget-frame</div>
          <div style={{ ...titleStyle, color: '#f8fafc' }}>{node?.title ?? shape.props.title}</div>
        </div>
        <div style={{ ...textStyle, color: 'rgba(248,250,252,0.68)' }}>
          {node?.widgetRuntime.hostKind ?? node?.bridgeState.status ?? 'idle'}
        </div>
      </div>
      <div style={{ width: '100%', height: '100%' }} onPointerDown={stopCanvasEvent}>
        {node ? (
          <CanvasRuntimeWidgetHost node={node} />
        ) : (
          <div style={{ padding: '16px', ...textStyle, color: 'rgba(248,250,252,0.72)' }}>
            {shape.props.resourceUri || shape.props.artifactUri || 'Widget bundle is waiting for render content.'}
          </div>
        )}
      </div>
    </div>
  );
}

export class RuntimeCardShapeUtil extends BaseBoxShapeUtil<RuntimeCardShape> {
  static type = 'runtime_card' as const;
  static props = {
    w: T.number,
    h: T.number,
    nodeId: T.string,
    nodeKind: T.string,
    syncVersion: T.string,
    retention: T.string,
    title: T.string,
    subtitle: T.optional(T.string),
    detail: T.optional(T.string),
  } as unknown as RecordProps<RuntimeCardShape>;

  getDefaultProps(): RuntimeCardShape['props'] {
    return {
      w: 320,
      h: 180,
      nodeId: 'runtime-node',
      nodeKind: 'artifact-card',
      syncVersion: 'initial',
      retention: 'mirror',
      title: 'Runtime Node',
    };
  }

  component(shape: RuntimeCardShape) {
    return (
      <TldrawHTMLContainer id={shape.id} style={containerStyle(shape.props.w, shape.props.h, '#ffffff')}>
        <RuntimeCardSurface shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  indicator(shape: RuntimeCardShape) {
    return <rect width={Math.max(0, shape.props.w)} height={Math.max(0, shape.props.h)} fill="transparent" />;
  }

  canEdit = () => false;
  canResize = () => true;
  isAspectRatioLocked = () => false;

  override onResize(shape: RuntimeCardShape, info: TLResizeInfo<RuntimeCardShape>) {
    return {
      props: {
        ...shape.props,
        w: Math.max(220, shape.props.w * info.scaleX),
        h: Math.max(132, shape.props.h * info.scaleY),
      },
    };
  }
}

export class RuntimeWidgetShapeUtil extends BaseBoxShapeUtil<RuntimeWidgetShape> {
  static type = 'runtime_widget' as const;
  static props = {
    w: T.number,
    h: T.number,
    nodeId: T.string,
    syncVersion: T.string,
    retention: T.string,
    title: T.string,
    artifactId: T.optional(T.string),
    artifactUri: T.optional(T.string),
    resourceUri: T.optional(T.string),
  } as unknown as RecordProps<RuntimeWidgetShape>;

  getDefaultProps(): RuntimeWidgetShape['props'] {
    return {
      w: 440,
      h: 336,
      nodeId: 'runtime-widget',
      syncVersion: 'initial',
      retention: 'persistent',
      title: 'Runtime Widget',
      artifactId: '',
      artifactUri: '',
      resourceUri: '',
    };
  }

  component(shape: RuntimeWidgetShape) {
    return (
      <TldrawHTMLContainer id={shape.id} style={containerStyle(shape.props.w, shape.props.h, '#111827')}>
        <RuntimeWidgetSurface shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  indicator(shape: RuntimeWidgetShape) {
    return <rect width={Math.max(0, shape.props.w)} height={Math.max(0, shape.props.h)} fill="transparent" />;
  }

  canEdit = () => false;
  canResize = () => true;
  isAspectRatioLocked = () => false;

  override onResize(shape: RuntimeWidgetShape, info: TLResizeInfo<RuntimeWidgetShape>) {
    return {
      props: {
        ...shape.props,
        w: Math.max(320, shape.props.w * info.scaleX),
        h: Math.max(240, shape.props.h * info.scaleY),
      },
    };
  }
}

export const runtimeShapeUtils = [RuntimeCardShapeUtil, RuntimeWidgetShapeUtil] as const;
