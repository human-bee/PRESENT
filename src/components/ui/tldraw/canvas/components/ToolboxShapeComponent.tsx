"use client";

import React, { useContext } from 'react';
import { nanoid } from 'nanoid';
import { createShapeId, useEditor } from '@tldraw/tldraw';
import { ComponentToolbox } from '@/components/ui/shared/component-toolbox';
import { ComponentStoreContext } from '../hooks/useCanvasStore';
import { components as registeredComponents } from '@/lib/custom';

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
  const componentStore = useContext(ComponentStoreContext);
  const { w, h } = shape.props;

  const handleComponentCreate = (componentType: string) => {
    console.log('🔧 Creating component from toolbox:', componentType);

    if (!editor || !componentStore) {
      console.error('Editor or component store not available', {
        editor: !!editor,
        componentStore: !!componentStore,
      });
      return;
    }

    const Component = registeredComponents.find((c: any) => c.name === componentType)?.component;
    if (!Component) {
      console.error('Component not found:', componentType);
      return;
    }

    const shapeId = createShapeId(nanoid());
    const componentInstance = React.createElement(Component, { __custom_message_id: shapeId });
    componentStore.set(shapeId, componentInstance);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new Event('present:component-store-updated'));
      } catch {}
    }

    const viewport = editor.getViewportPageBounds();
    const x = viewport ? viewport.midX - 150 : 0;
    const y = viewport ? viewport.midY - 100 : 0;

    (editor as any).createShape?.({
      id: shapeId,
      type: 'custom',
      x,
      y,
      props: {
        w: 300,
        h: 200,
        customComponent: shapeId,
        name: componentType,
      },
    });

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
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ComponentToolbox onComponentCreate={handleComponentCreate} />
    </div>
  );
}
