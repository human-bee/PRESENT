import { focusResult } from './tldraw/focus';
import { type TLShapeId } from 'tldraw';
import { RenderReceipts } from './tldraw/render-receipts';
import { Tldraw, type Editor } from 'tldraw';
import type { RemoteTLStoreWithStatus } from '@tldraw/sync';
import { getAssetUrls } from '@tldraw/assets/selfHosted';
import { useState, useEffect, type ReactNode } from 'react';
import { NativeControls, type CanvasUiMode } from './tldraw/native-controls';
import type { Operation, RoomState } from '../shared/room';
import { PresentWidgetShapeUtil, WidgetRuntimeProvider } from './tldraw/PresentWidgetShapeUtil';
import { CanvasToolbar, CanvasMenu } from './tldraw/canvas-chrome';
import { ToolRail } from './tldraw/tool-rail';
import 'tldraw/tldraw.css';
import './tldraw/canvas.css';

export type Viewport = { x: number; y: number; zoom: number };
const shapeUtils = [PresentWidgetShapeUtil];
const assetUrls = getAssetUrls({ baseUrl: '/tldraw-assets' });

export function Canvas({ sync, roomId, selfId, onMount, act, onError, children }: {
  sync: RemoteTLStoreWithStatus; roomId: string; selfId: string;
  onMount: (editor: Editor) => void; act: (op: Operation) => Promise<RoomState>;
  onError: (message: string) => void; children?: ReactNode;
}) {
  const [mode, setMode] = useState<CanvasUiMode>(() => {
    try { const saved = localStorage.getItem('present:canvas-ui'); return saved === 'hidden' ? 'hidden' : 'full'; } catch { return 'full'; }
  });
  useEffect(() => { try { localStorage.setItem('present:canvas-ui', mode); } catch { /* Session-only in restricted browsers. */ } }, [mode]);
  return <main data-canvas-ui={mode} className="native-canvas" aria-label="Shared infinite canvas">
    <WidgetRuntimeProvider roomId={roomId} selfId={selfId} act={act} onError={onError}>
      <Tldraw store={sync} shapeUtils={shapeUtils} assetUrls={assetUrls} components={{ Toolbar: CanvasToolbar, MenuPanel: CanvasMenu, StylePanel: null, NavigationPanel: null }} hideUi={mode !== 'full'} onMount={editor => {
        editor.user.updateUserPreferences({ colorScheme: 'light', isSnapMode: true });
        editor.updateInstanceState({ isGridMode: false });
        onMount(editor);
        const focus = new URLSearchParams(window.location.search).get('focus');
        if (focus && /^[\w-]{1,100}$/.test(focus)) void focusResult(editor, [`shape:${focus}` as TLShapeId]);
        if (import.meta.env.DEV) (window as Window & { __presentEditor?: Editor }).__presentEditor = editor;
      }} licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}>
        {import.meta.env.DEV && <RenderReceipts/>}
        <NativeControls mode={mode} setMode={setMode}/>
        {mode === 'compact' && <ToolRail/>}
      </Tldraw>
    </WidgetRuntimeProvider>
    <div className="canvas-ui-toggle overlay" role="group" aria-label="Canvas controls visibility">
      <button type="button" className="canvas-tools-button" aria-label={mode === 'hidden' ? 'Show drawing tools' : 'Hide drawing tools'} aria-pressed={mode !== 'hidden'} title={mode === 'hidden' ? 'Show drawing tools' : 'Hide drawing tools'} onClick={() => setMode(mode === 'hidden' ? 'full' : 'hidden')}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m13 6 5 5M4 15l5 5"/></svg>
      </button>
    </div>
    {children}
  </main>;
}
