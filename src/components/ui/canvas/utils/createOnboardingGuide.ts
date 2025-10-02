import * as React from 'react';
import { nanoid } from 'nanoid';
import type { Editor } from 'tldraw';
import { createShapeId } from 'tldraw';

import { components } from '@/lib/custom';

import type { CanvasLogger } from '../hooks/useCanvasComponentStore';

export interface CreateOnboardingGuideOptions {
  editor: Editor;
  componentStore: React.MutableRefObject<Map<string, React.ReactNode>>;
  logger: CanvasLogger;
}

export function createOnboardingGuide({
  editor,
  componentStore,
  logger,
}: CreateOnboardingGuideOptions) {
  logger.info('🆘 Help button clicked - creating onboarding guide');

  const shapeId = createShapeId(nanoid());
  const OnboardingGuideComponent = components.find((c) => c.name === 'OnboardingGuide')?.component;

  if (!OnboardingGuideComponent) {
    logger.warn('OnboardingGuide component not found');
    return false;
  }

  const componentInstance = React.createElement(OnboardingGuideComponent, {
    __custom_message_id: shapeId,
    context: 'canvas',
    autoStart: true,
    state: {},
    updateState: (patch: Record<string, unknown> | ((prev: any) => any)) => {
      const previousState: Record<string, unknown> = {};
      const nextState =
        typeof patch === 'function'
          ? (patch as (prev: Record<string, unknown>) => Record<string, unknown>)(previousState)
          : { ...previousState, ...(patch || {}) };
      editor.updateShapes([
        {
          id: shapeId,
          type: 'custom' as const,
          props: { state: nextState },
        },
      ]);
    },
  });

  componentStore.current.set(shapeId, componentInstance);
  try {
    window.dispatchEvent(new Event('present:component-store-updated'));
  } catch {
    /* ignore */
  }

  const viewport = editor.getViewportPageBounds();
  const x = viewport ? viewport.midX - 200 : 100;
  const y = viewport ? viewport.midY - 150 : 100;

  editor.createShape({
    id: shapeId,
    type: 'custom',
    x,
    y,
    props: {
      w: 400,
      h: 300,
      customComponent: shapeId,
      name: 'OnboardingGuide',
    },
  });

  logger.info('✅ Onboarding guide created successfully');
  return true;
}
