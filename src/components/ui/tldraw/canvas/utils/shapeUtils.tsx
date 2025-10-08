"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer as TldrawHTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
} from '@tldraw/tldraw';
import { getComponentSizeInfo } from '@/lib/component-sizing';
import type { customShapeProps, MermaidStreamShapeProps } from './types';
import { CustomShapeComponent } from '../components/CustomShapeComponent';
import { MermaidStreamShapeComponent } from '../components/MermaidStreamShapeComponent';
import { ToolboxShapeComponent } from '../components/ToolboxShapeComponent';

export type CustomShape = TLBaseShape<'custom', customShapeProps>;
export type MermaidStreamShape = TLBaseShape<'mermaid_stream', MermaidStreamShapeProps>;
export type ToolboxShape = TLBaseShape<'toolbox', { w: number; h: number; name: string }>;

export class MermaidStreamShapeUtil extends BaseBoxShapeUtil<MermaidStreamShape> {
  static type = 'mermaid_stream' as const;
  static props = {
    w: T.number,
    h: T.number,
    name: T.string,
    mermaidText: T.string,
    compileState: T.optional(T.string),
    renderState: T.optional(T.string),
    streamId: T.optional(T.string),
    keepLastGood: T.optional(T.boolean),
  } as unknown as RecordProps<MermaidStreamShape>;

  getDefaultProps(): MermaidStreamShape['props'] {
    return {
      w: 400,
      h: 300,
      name: 'Mermaid (stream)',
      mermaidText: 'graph TD; A[Start] --> B{Decision}; B -->|Yes| C[OK]; B -->|No| D[Retry];',
      compileState: 'idle',
      keepLastGood: true,
    };
  }

  component(shape: MermaidStreamShape) {
    return (
      <TldrawHTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'stretch',
          overflow: 'hidden',
          pointerEvents: 'all',
          position: 'relative',
          width: `${shape.props.w}px`,
          height: `${shape.props.h}px`,
        }}
      >
        <MermaidStreamShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  indicator(shape: MermaidStreamShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }

  canEdit = () => false;
  canResize = () => true;
  isAspectRatioLocked = () => false;
}

export class CustomShapeUtil extends BaseBoxShapeUtil<CustomShape> {
  static type = 'custom' as const;
  static props = {
    w: T.number,
    h: T.number,
    customComponent: T.any,
    name: T.string,
    pinned: T.optional(T.boolean),
    pinnedX: T.optional(T.number),
    pinnedY: T.optional(T.number),
    userResized: T.optional(T.boolean),
    state: T.optional(T.any),
  } as unknown as RecordProps<CustomShape>;

  private userResized = new Set<string>();

  getDefaultProps(): CustomShape['props'] {
    return {
      w: 300,
      h: 200,
      customComponent: '',
      name: 'custom Component',
      pinned: false,
      pinnedX: 0.5,
      pinnedY: 0.5,
      userResized: false,
    };
  }

  component(shape: CustomShape) {
    return (
      <TldrawHTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          overflow: 'visible',
          pointerEvents: 'all',
          position: 'relative',
          width: `${shape.props.w}px`,
          height: `${shape.props.h}px`,
          zIndex: shape.props.pinned ? 1000 : 100,
        }}
      >
        <CustomShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  indicator(shape: CustomShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }

  canEdit = () => false;
  canResize = () => true;
  isAspectRatioLocked = () => false;

  override canBind = ({ fromShapeType }: { fromShapeType: string }) => fromShapeType !== 'custom';

  override onResize(shape: CustomShape, info: TLResizeInfo<CustomShape>) {
    this.userResized.add(shape.id);

    const sizeInfo = getComponentSizeInfo(shape.props.name);

    let w = shape.props.w * info.scaleX;
    let h = shape.props.h * info.scaleY;

    w = Math.max(sizeInfo.minWidth, w);
    h = Math.max(sizeInfo.minHeight, h);

    if (sizeInfo.aspectRatio && sizeInfo.resizeMode === 'aspect-locked') {
      const ratio = sizeInfo.aspectRatio;
      if (Math.abs(info.scaleX - 1) > Math.abs(info.scaleY - 1)) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }
    }

    if (sizeInfo.resizeMode === 'fixed') {
      w = sizeInfo.naturalWidth;
      h = sizeInfo.naturalHeight;
    }

    return {
      props: {
        ...shape.props,
        w,
        h,
        userResized: true,
      },
    };
  }

  onBeforeUpdate(next: CustomShape, prev: CustomShape) {
    if (next.props.w !== prev.props.w || next.props.h !== prev.props.h) {
      this.userResized.add(next.id);
    }
  }

  onAfterUpdate(next: CustomShape) {
    if (!(next.props.userResized ?? false) && this.userResized.has(next.id)) {
      next.props.userResized = true;
    }
  }

  toSvg(shape: CustomShape, _ctx: unknown) {
    void _ctx;
    const container = typeof document !== 'undefined' ? document.getElementById(shape.id) : null;
    const inner = container?.innerHTML ?? '';

    const backgroundRect = (
      <rect
        x={0}
        y={0}
        width={shape.props.w}
        height={shape.props.h}
        rx={8}
        ry={8}
        fill="white"
        stroke="#E5E7EB"
        strokeWidth={1}
      />
    );

    if (!inner) {
      return (
        <>
          {backgroundRect}
          <text
            x={shape.props.w / 2}
            y={shape.props.h / 2}
            dominantBaseline="middle"
            textAnchor="middle"
            fill="#64748B"
            fontSize={12}
            fontFamily="ui-sans-serif, system-ui, -apple-system"
          >
            {shape.props.name || 'Component'}
          </text>
        </>
      );
    }

    return (
      <>
        {backgroundRect}
        <foreignObject
          x={0}
          y={0}
          width={shape.props.w}
          height={shape.props.h}
          className="tl-export-embed-styles"
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              overflow: 'hidden',
              background: 'transparent',
              fontFamily: 'ui-sans-serif, system-ui, -apple-system',
            }}
            dangerouslySetInnerHTML={{ __html: inner }}
          />
        </foreignObject>
      </>
    );
  }

  public hasUserResized(id: string) {
    return this.userResized.has(id);
  }
}

export class ToolboxShapeUtil extends BaseBoxShapeUtil<ToolboxShape> {
  static type = 'toolbox' as const;
  static props = {
    w: T.number,
    h: T.number,
    name: T.string,
  } as unknown as RecordProps<ToolboxShape>;

  getDefaultProps(): ToolboxShape['props'] {
    return {
      w: 56,
      h: 560,
      name: 'Component Toolbox',
    };
  }

  component(shape: ToolboxShape) {
    return (
      <TldrawHTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          overflow: 'visible',
          pointerEvents: 'all',
          position: 'relative',
          zIndex: 1000,
        }}
      >
        <ToolboxShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  indicator(shape: ToolboxShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }

  canBind = ({ fromShapeType }: { fromShapeType: string }) => fromShapeType !== 'toolbox';
}
