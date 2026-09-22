import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DefaultToolbar, DefaultStylePanel, DefaultMenuPanel } from 'tldraw';

/** Styles are explicitly requested at the tool, never opened by selection. */
export function ToolStyles({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor || pinned) return;
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setAnchor(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(null); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true); };
  }, [anchor, pinned]);
  return <div onContextMenu={event => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button || panel.current?.contains(button)) return;
    event.preventDefault(); event.stopPropagation(); button.click();
    const rect = button.getBoundingClientRect();
    if (pinned) return;
    setAnchor({ x: Math.min(rect.right + 12, window.innerWidth - 260), y: Math.max(80, Math.min(rect.top, window.innerHeight - 480)) });
  }}>
    {children}
    {anchor && <div ref={panel} className="tool-style-popover" role="dialog" aria-label="Tool style" style={{ left: anchor.x, top: anchor.y }}>
      <div className="style-palette-header">
        <div className="style-palette-drag" role="button" tabIndex={0} aria-label="Move tool style palette" title="Drag to move; arrow keys to nudge" onPointerDown={event => {
          event.preventDefault(); event.stopPropagation();
          drag.current = { x: event.clientX, y: event.clientY, left: anchor.x, top: anchor.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
          if (!drag.current) return;
          event.stopPropagation();
          const rect = panel.current?.getBoundingClientRect();
          setAnchor({ x: Math.max(8, Math.min(window.innerWidth - (rect?.width ?? 200) - 8, drag.current.left + event.clientX - drag.current.x)), y: Math.max(8, Math.min(window.innerHeight - (rect?.height ?? 350) - 8, drag.current.top + event.clientY - drag.current.y)) });
        }} onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onKeyDown={event => {
          const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
          if (!delta) return;
          event.preventDefault(); event.stopPropagation();
          const rect = panel.current?.getBoundingClientRect();
          setAnchor({ x: Math.max(8, Math.min(window.innerWidth - (rect?.width ?? 200) - 8, anchor.x + delta[0])), y: Math.max(8, Math.min(window.innerHeight - (rect?.height ?? 350) - 8, anchor.y + delta[1])) });
        }}>⠿ <span>Style</span></div>
        <button className="style-pin" aria-label={pinned ? 'Unpin tool style' : 'Pin tool style'} aria-pressed={pinned} title={pinned ? 'Unpin palette' : 'Keep palette open'} onClick={() => setPinned(!pinned)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8l-1 7 4 4v2H5v-2l4-4-1-7Z"/><path d="M12 16v6"/></svg>
        </button>
      </div>
      <DefaultStylePanel/>
    </div>}
  </div>;
}

export function CanvasToolbar() {
  return <div className="native-tool-dock"><ToolStyles><DefaultToolbar orientation="vertical"/></ToolStyles></div>;
}

export function CanvasMenu() {
  return <details className="canvas-menu"><summary aria-label="Canvas menu">☰</summary><DefaultMenuPanel/></details>;
}
