import type { RefObject } from 'react';

import { withWindowListeners } from './window-listeners';

export function registerUiStateHandlers(containerRef: RefObject<HTMLDivElement>): () => void {
  return withWindowListeners((add) => {
    const handleToggleGrid = () => {
      const el = containerRef.current;
      if (!el) return;
      const has = el.dataset.grid === 'on';
      if (has) {
        delete el.dataset.grid;
        el.style.backgroundImage = '';
      } else {
        el.dataset.grid = 'on';
        el.style.backgroundImage = 'radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px)';
        el.style.backgroundSize = '16px 16px';
      }
    };

    const handleSetBackground = (event: Event) => {
      const el = containerRef.current;
      if (!el) return;
      const detail = (event as CustomEvent).detail || {};
      if (detail.color) {
        el.style.backgroundColor = String(detail.color);
        if (el.dataset.grid !== 'on') el.style.backgroundImage = '';
      } else if (detail.image) {
        el.style.backgroundImage = `url(${detail.image})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
    };

    const handleSetTheme = (event: Event) => {
      const el = containerRef.current;
      if (!el) return;
      const detail = (event as CustomEvent).detail || {};
      const theme = String(detail.theme || '').toLowerCase();
      el.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    };

    add('tldraw:toggleGrid', handleToggleGrid as EventListener);
    add('tldraw:setBackground', handleSetBackground as EventListener);
    add('tldraw:setTheme', handleSetTheme as EventListener);
  });
}
