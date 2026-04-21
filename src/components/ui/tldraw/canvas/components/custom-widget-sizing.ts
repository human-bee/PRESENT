import React, { type ReactNode } from 'react';
import { componentSizeInfo, type ComponentSizeInfo } from '@/lib/component-sizing';

export interface WidgetSize {
  w: number;
  h: number;
}

export interface WidgetLayout {
  baseW: number;
  baseH: number;
  layoutW: number;
  layoutH: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function readMeasuredElementSize(el: HTMLElement): WidgetSize {
  // Use layout metrics that are stable under CSS transforms so we do not chase our own scaling.
  const widthCandidate = Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth);
  const heightCandidate = Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight);
  return {
    w: Math.ceil(Number.isFinite(widthCandidate) ? widthCandidate : 0),
    h: Math.ceil(Number.isFinite(heightCandidate) ? heightCandidate : 0),
  };
}

export function getStoredComponentTypeName(stored: ReactNode | null | undefined): string | null {
  const readTypeName = (type: unknown): string | null => {
    if (!type || typeof type === 'string') return null;
    const record = type as { displayName?: unknown; name?: unknown };
    if (typeof record.displayName === 'string' && record.displayName.trim()) {
      return record.displayName.trim();
    }
    if (typeof record.name === 'string' && record.name.trim()) {
      return record.name.trim();
    }
    return null;
  };

  if (React.isValidElement(stored)) {
    return readTypeName(stored.type);
  }

  if (stored && typeof stored === 'object') {
    const record = stored as {
      type?: unknown;
      Component?: unknown;
      component?: unknown;
      props?: { componentType?: unknown; type?: unknown };
    };
    const propComponentType = record.props?.componentType ?? record.props?.type;
    if (typeof propComponentType === 'string' && propComponentType.trim()) {
      return propComponentType.trim();
    }
    return readTypeName(record.type ?? record.Component ?? record.component);
  }

  return null;
}

export function resolveSizingComponentName(shapeName: string, stored: ReactNode | null | undefined): string {
  if (componentSizeInfo[shapeName]) return shapeName;

  const storedTypeName = getStoredComponentTypeName(stored);
  if (!storedTypeName) return shapeName;
  if (componentSizeInfo[storedTypeName]) return storedTypeName;

  const embeddedKnownName = Object.keys(componentSizeInfo).find((name) => storedTypeName.includes(name));
  return embeddedKnownName ?? shapeName;
}

export function shouldMeasureCustomWidget({
  sizingPolicy,
  isPinned,
  isFixedSizeWidget,
}: {
  sizingPolicy: ComponentSizeInfo['sizingPolicy'];
  isPinned: boolean;
  isFixedSizeWidget: boolean;
}) {
  return sizingPolicy !== 'scale_only' && !isPinned && !isFixedSizeWidget;
}

export function getCustomWidgetAutoFitSize({
  naturalSize,
  shapeSize,
  sizeInfo,
  sizingPolicy,
  userHasResized,
  autoFitted,
  lastAutoFitSize,
}: {
  naturalSize: WidgetSize | null;
  shapeSize: WidgetSize;
  sizeInfo: ComponentSizeInfo;
  sizingPolicy: NonNullable<ComponentSizeInfo['sizingPolicy']>;
  userHasResized: boolean;
  autoFitted: boolean;
  lastAutoFitSize: WidgetSize | null;
}): WidgetSize | null {
  if (!naturalSize) return null;

  const minH = Math.max(32, sizeInfo.minHeight * 0.5);
  if (!Number.isFinite(naturalSize.h) || naturalSize.h < minH) {
    return null;
  }

  const nextSize = {
    w: sizeInfo.naturalWidth,
    h: naturalSize.h,
  };
  const widthChanged = Math.abs(shapeSize.w - nextSize.w) > 1;
  const heightChanged = Math.abs(shapeSize.h - nextSize.h) > 1;
  if (!widthChanged && !heightChanged) {
    return null;
  }

  const contentOverflowsShape = nextSize.h > shapeSize.h + 1;
  const shapeReflectsLastAutoFit =
    !lastAutoFitSize ||
    (Math.abs(shapeSize.w - lastAutoFitSize.w) <= 1 &&
      Math.abs(shapeSize.h - lastAutoFitSize.h) <= 1);
  const canFitPolicy =
    sizingPolicy === 'always_fit' ||
    (sizingPolicy === 'fit_until_user_resize' && !userHasResized);
  const canApplyFit =
    sizingPolicy === 'always_fit' ||
    (!autoFitted && (canFitPolicy || contentOverflowsShape)) ||
    (shapeReflectsLastAutoFit && (canFitPolicy || contentOverflowsShape));

  return canApplyFit ? nextSize : null;
}

export function getCustomWidgetLayout({
  sizeInfo,
  sizingPolicy,
  isFixedSizeWidget,
  naturalSize,
  pinnedNaturalSize,
  shapeSize,
  pinnedShapeSize,
}: {
  sizeInfo: ComponentSizeInfo;
  sizingPolicy: NonNullable<ComponentSizeInfo['sizingPolicy']>;
  isFixedSizeWidget: boolean;
  naturalSize: WidgetSize | null;
  pinnedNaturalSize: WidgetSize | null;
  shapeSize: WidgetSize;
  pinnedShapeSize?: Partial<WidgetSize>;
}): WidgetLayout {
  const baseW = sizeInfo.naturalWidth;
  const measuredHeight = isFixedSizeWidget
    ? sizeInfo.naturalHeight
    : pinnedNaturalSize
      ? (pinnedNaturalSize.h ?? naturalSize?.h ?? sizeInfo.naturalHeight)
      : (naturalSize?.h ?? sizeInfo.naturalHeight);
  const baseH = sizingPolicy === 'scale_only' ? sizeInfo.naturalHeight : measuredHeight;

  const layoutW = pinnedShapeSize?.w && Number.isFinite(pinnedShapeSize.w) && pinnedShapeSize.w > 0
    ? pinnedShapeSize.w
    : shapeSize.w;
  const layoutH = pinnedShapeSize?.h && Number.isFinite(pinnedShapeSize.h) && pinnedShapeSize.h > 0
    ? pinnedShapeSize.h
    : shapeSize.h;

  const scaleX = layoutW / baseW;
  const scaleY = layoutH / baseH;
  const scale = Math.min(scaleX, scaleY);
  const scaledWidth = baseW * scale;
  const scaledHeight = baseH * scale;

  return {
    baseW,
    baseH,
    layoutW,
    layoutH,
    scale,
    offsetX: (layoutW - scaledWidth) / 2,
    offsetY: (layoutH - scaledHeight) / 2,
  };
}
