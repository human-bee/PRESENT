import { useRef, useState } from 'react';
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, stopEventPropagation, useEditor, useValue, TLDOCUMENT_ID, type TLResizeInfo } from 'tldraw';
import { type PresentWidgetShape, presentWidgetMigrations, presentWidgetShapeProps } from '../../shared/tldraw-schema';
import { patchNativeShape, shapeToObject } from '../../shared/tldraw-adapter';
import type { Operation } from '../../shared/room';
import { readMediaReference } from '../../shared/media-reference';
import { MediaTileSettings } from '../media/tile-settings';
import '../media/tile-chrome.css';
import { WidgetContent } from '../widgets/widget-content';
import { useWidgetRuntime } from './widget-runtime';
export { WidgetRuntimeProvider, type WidgetRuntime } from './widget-runtime';

function PresentWidget({ shape }: { shape: PresentWidgetShape }) {
  const editor = useEditor();
  const { act, selfId, onError } = useWidgetRuntime();
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  // Read the widget and receipts in one native snapshot, including before React receives new shape props.
  const { object, receipts } = useValue('present-widget-state', () => {
    const current = editor.getShape(shape.id);
    const document = editor.store.get(TLDOCUMENT_ID);
    const present = document?.typeName === 'document' ? document.meta.present : null;
    const requests = present && typeof present === 'object' && !Array.isArray(present) ? present.requests : null;
    return { object: current ? shapeToObject(current) : null,
      receipts: Array.isArray(requests) ? requests.flatMap(pair => Array.isArray(pair) && typeof pair[0] === 'string' ? [pair[0]] : []) : [] };
  }, [editor, shape.id]);
  const send = (operation: Operation, requestId?: string) => {
    setError(null);
    // Same-widget edits reach the server in input order; other participants remain independent.
    const result = pending.current.catch(() => undefined).then(() => act(operation, requestId));
    pending.current = result;
    return result.catch(cause => {
      const message = cause instanceof Error ? cause.message : 'This widget could not update. Try again.';
      setError(message); onError?.(message);
      throw cause;
    });
  };
  if (!object) return null;
  const mediaReference = readMediaReference(object.data);
  return <HTMLContainer tabIndex={mediaReference ? 0 : undefined} className={mediaReference ? 'media-widget' : undefined} id={shape.id} style={{
    width: shape.props.w, height: shape.props.h, pointerEvents: 'all', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', border: '1px solid #dfe5d8', borderRadius: 12, background: '#fffef9', color: '#28342a',
    boxShadow: '0 4px 20px #2637220b', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  }}>
    <div className="widget-title-bar" style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 14px',
      fontSize: 12, fontWeight: 500, color: '#6e786a', userSelect: 'none', cursor: 'grab', borderBottom: '1px solid #edf0e8',
    }} title="Drag to move">
      <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{shape.props.title}</span>
      {mediaReference && <MediaTileSettings participantId={mediaReference.participantId} />}
    </div>
    <fieldset aria-label={`${shape.props.title} controls`} onPointerDown={stopEventPropagation} onPointerUp={stopEventPropagation} onDoubleClick={stopEventPropagation}
      onWheel={stopEventPropagation} style={{ flex: 1, minWidth: 0, minHeight: 0, margin: 0, padding: 0, border: 0, position: 'relative' }}>
      <WidgetContent object={object} participantId={selfId} receipts={receipts}
        patch={(patch, requestId) => {
          if (patch.data && Object.hasOwn(patch.data, 'state')) return send({ type: 'patch', id: object.id, patch }, requestId);
          const current = editor.getShape(shape.id);
          if (!current) return;
          try {
            if (shape.props.kind === 'timer') editor.markHistoryStoppingPoint('Change timer');
            editor.updateShape(patchNativeShape(current, patch));
          } catch (cause) { onError?.(cause instanceof Error ? cause.message : 'This widget could not update.'); }
        }}
        increment={(key, by, requestId) => send({ type: 'increment', id: object.id, key, by }, requestId)} />
    </fieldset>
    {error && <div role="status" style={{ padding: '6px 12px', fontSize: 12, color: '#9b4234' }}>{error}</div>}
  </HTMLContainer>;
}

export class PresentWidgetShapeUtil extends BaseBoxShapeUtil<PresentWidgetShape> {
  static override type = 'present-widget' as const;
  static override props = presentWidgetShapeProps;
  static override migrations = presentWidgetMigrations;
  getDefaultProps(): PresentWidgetShape['props'] {
    return { w: 360, h: 300, kind: 'widget', title: 'Something new', data: {}, pinned: false, createdBy: '', createdAt: 0, expiresAt: null };
  }
  override canEdit() { return false; }
  override canScroll() { return true; }
  override getText(shape: PresentWidgetShape) { return shape.props.title; }
  override onResize(shape: PresentWidgetShape, info: TLResizeInfo<PresentWidgetShape>) {
    return resizeBox(shape, info, { minWidth: 220, minHeight: shape.props.data.capability === 'youtube' ? 234 : 160, maxWidth: 4000, maxHeight: 4000 });
  }
  component(shape: PresentWidgetShape) { return <PresentWidget shape={shape} />; }
  getIndicatorPath(shape: PresentWidgetShape) {
    const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 12); return path;
  }
}
