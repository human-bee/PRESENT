"use client";
import * as React from 'react';
import type { Editor } from 'tldraw';

type Props = { editor: Editor | null };

export function BrandGridOverlay({ editor }: Props) {
  const [opacity, setOpacity] = React.useState(0.12);

  React.useEffect(() => {
    if (!editor) return;
    let mounted = true;
    const tick = () => {
      try {
        const cam = (editor as any).getCamera?.();
        const z = typeof cam?.z === 'number' ? cam.z : (editor as any).getZoom?.() ?? 1;
        const o = Math.max(0.06, Math.min(0.18, 0.22 - 0.06 * Math.log10(z + 0.01)));
        if (mounted) setOpacity(o);
      } catch {}
    };
    const id = setInterval(tick, 250);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [editor]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 1,
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 8px), ' +
          'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 8px), ' +
          'repeating-linear-gradient(0deg, rgba(255,106,0,0.12) 0 1px, transparent 1px 32px), ' +
          'repeating-linear-gradient(90deg, rgba(255,106,0,0.12) 0 1px, transparent 1px 32px)',
        opacity,
        mixBlendMode: 'overlay',
      }}
    />
  );
}

