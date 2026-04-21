import React from 'react';
import type { ComponentSizeInfo } from '@/lib/component-sizing';
import {
  getCustomWidgetAutoFitSize,
  getCustomWidgetLayout,
  resolveSizingComponentName,
} from './custom-widget-sizing';

function CodexRemoteWidget() {
  return <div>Remote Codex</div>;
}

const baseSizeInfo: ComponentSizeInfo = {
  naturalWidth: 300,
  naturalHeight: 200,
  minWidth: 100,
  minHeight: 50,
  resizeMode: 'free',
  sizingPolicy: 'fit_until_user_resize',
};

describe('custom widget sizing policy', () => {
  it('uses stored component type when shape name is only a display label', () => {
    expect(resolveSizingComponentName('Remote Codex', <CodexRemoteWidget />)).toBe('CodexRemoteWidget');
  });

  it('grows a manually resized widget when content overflows its current shape bounds', () => {
    expect(
      getCustomWidgetAutoFitSize({
        naturalSize: { w: 300, h: 430 },
        shapeSize: { w: 300, h: 250 },
        sizeInfo: baseSizeInfo,
        sizingPolicy: 'fit_until_user_resize',
        userHasResized: true,
        autoFitted: true,
        lastAutoFitSize: { w: 300, h: 250 },
      }),
    ).toEqual({ w: 300, h: 430 });
  });

  it('does not shrink a manually resized widget just because measured content is smaller', () => {
    expect(
      getCustomWidgetAutoFitSize({
        naturalSize: { w: 300, h: 180 },
        shapeSize: { w: 300, h: 250 },
        sizeInfo: baseSizeInfo,
        sizingPolicy: 'fit_until_user_resize',
        userHasResized: true,
        autoFitted: true,
        lastAutoFitSize: { w: 300, h: 250 },
      }),
    ).toBeNull();
  });

  it('calculates a reusable scaled layout for dynamic widget content', () => {
    expect(
      getCustomWidgetLayout({
        sizeInfo: baseSizeInfo,
        sizingPolicy: 'always_fit',
        isFixedSizeWidget: false,
        naturalSize: { w: 300, h: 400 },
        pinnedNaturalSize: null,
        shapeSize: { w: 150, h: 200 },
      }),
    ).toMatchObject({
      baseW: 300,
      baseH: 400,
      layoutW: 150,
      layoutH: 200,
      scale: 0.5,
      offsetX: 0,
      offsetY: 0,
    });
  });
});
