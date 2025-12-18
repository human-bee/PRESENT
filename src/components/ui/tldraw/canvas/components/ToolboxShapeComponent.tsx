"use client";

import React from 'react';
import { nanoid } from 'nanoid';
import { createShapeId, useEditor } from '@tldraw/tldraw';
import { ComponentToolbox } from '@/components/ui/shared/component-toolbox';
import { getAvailableComponents } from '@/lib/component-icons';
import { findTiledPlacement } from '@/components/ui/tldraw/utils/findTiledPlacement';

interface ToolboxShapeProps {
  id: string;
  props: {
    w: number;
    h: number;
    name: string;
  };
}

export function ToolboxShapeComponent({ shape }: { shape: ToolboxShapeProps }) {
  const editor = useEditor();
  const { w, h } = shape.props;
  const BASE_W = 56;
  const PAD = 8; // matches p-2
  const BTN = 36; // h-9
  const GAP = 6; // gap-1.5
  const EXTRA_INFOGRAPHIC_SPACING = 8; // mt-2 on infographic button

  const buttonCount = React.useMemo(() => {
    // standard components + infographic trigger
    return getAvailableComponents().length + 1;
  }, []);

  const baseHeightNeeded = React.useMemo(() => {
    if (buttonCount === 0) return 0;
    const buttonsHeight = buttonCount * BTN;
    const gapsHeight = Math.max(0, buttonCount - 1) * GAP;
    return PAD * 2 + buttonsHeight + gapsHeight + EXTRA_INFOGRAPHIC_SPACING;
  }, [buttonCount]);

  const BASE_H = Math.max(baseHeightNeeded, 120);

  // Scale inner UI when the shape is resized so buttons grow/shrink with the box.
  const scale = React.useMemo(() => {
    const s = Math.min(w / BASE_W, h / BASE_H);
    // Avoid microscopic buttons but also cap runaway growth
    return Math.min(Math.max(s, 0.75), 3);
  }, [w, h, BASE_H]);

  const scaledWidth = BASE_W * scale;
  const scaledHeight = BASE_H * scale;
  const offsetX = (w - scaledWidth) / 2;
  const offsetY = (h - scaledHeight) / 2;

  // Auto-grow the shape vertically when new buttons are added so nothing is clipped.
  React.useEffect(() => {
    if (!editor || !baseHeightNeeded) return;
    const desiredHeight = Math.max(h, BASE_H * (w / BASE_W));
    const delta = Math.abs(desiredHeight - h);
    if (delta > 0.5) {
      editor.updateShapes([
        {
          id: shape.id as any,
          type: 'toolbox' as any,
          props: {
            ...shape.props,
            h: desiredHeight,
          },
        },
      ] as any);
    }
  }, [editor, h, w, baseHeightNeeded, BASE_H, shape.id, shape.props]);

  const handleComponentCreate = (componentType: string) => {
    console.log('🔧 Creating component from toolbox:', componentType);

    if (!editor) {
      console.error('Editor or component store not available', {
        editor: !!editor,
      });
      return;
    }

    if (componentType === 'infographic') {
      const viewport = editor.getViewportPageBounds();
      const placement = findTiledPlacement(editor, { w: 400, h: 600 }, { viewport });
      const x = viewport ? placement.x : 0;
      const y = viewport ? placement.y : 0;

      editor.createShape({
        id: createShapeId(),
        type: 'infographic',
        x,
        y,
        props: {
          w: 400,
          h: 600,
        },
      });
      return;
    }

    const messageId = `ui-${Date.now().toString(36)}-${nanoid(8)}`;
    window.dispatchEvent(
      new CustomEvent('custom:showComponent', {
        detail: {
          messageId,
          component: {
            type: componentType,
            props: {
              __custom_message_id: messageId,
              messageId,
              contextKey: 'canvas',
            },
          },
          contextKey: 'canvas',
        },
      }),
    );

    console.log('✅ Component created successfully:', componentType);
  };

  return (
    <div
      style={{
        width: `${w}px`,
        height: `${h}px`,
        border: '2px solid var(--color-accent)',
        borderRadius: '12px',
        background: 'var(--color-panel)',
        boxShadow: '0 2px 16px 0 rgba(0,0,0,0.10)',
        overflow: 'visible',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: 'top left',
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          width: `${BASE_W}px`,
          height: `${BASE_H}px`,
        }}
      >
        <ComponentToolbox onComponentCreate={handleComponentCreate} />
      </div>
    </div>
  );
}
