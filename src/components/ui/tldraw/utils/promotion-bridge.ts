import { AssetRecordType, Editor, createShapeId, toRichText } from '@tldraw/tldraw';
import type { PromotableItem } from '@/lib/promotion-types';
import { registerSingletonWindowListener } from './window-listeners';

interface PromotionBridgeOptions {
  editor: Editor;
}

const clampDimension = (value: unknown, fallback: number, min = 48): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(min, value);
  }
  return fallback;
};

const isValidUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const getViewportOrigin = (editor: Editor, w: number, h: number) => {
  const viewport = editor.getViewportPageBounds();
  const x = viewport ? viewport.midX - w / 2 : 0;
  const y = viewport ? viewport.midY - h / 2 : 0;
  return { x, y };
};

const createImageShape = (editor: Editor, item: PromotableItem) => {
  const url = item.data?.url;
  if (!url) {
    console.warn('[PromotionBridge] Missing image url for promotable item', item);
    return;
  }
  const width = clampDimension(item.data?.width, 640, 16);
  const height = clampDimension(item.data?.height, Math.round(width * 0.66), 16);
  const { x, y } = getViewportOrigin(editor, width, height);

  const assetId = AssetRecordType.createId();
  const asset = {
    id: assetId,
    typeName: 'asset' as const,
    type: 'image' as const,
    props: {
      w: width,
      h: height,
      name: `${item.label || 'image'}.png`,
      src: url,
      isAnimated: false,
      mimeType: 'image/png',
    },
    meta: {},
  };

  editor.createAssets([asset as any]);
  editor.createShape({
    id: createShapeId(),
    type: 'image' as const,
    x,
    y,
    props: {
      w: width,
      h: height,
      assetId,
    },
  } as any);
};

const createTextShape = (editor: Editor, item: PromotableItem) => {
  const text = item.data?.text || item.label;
  if (!text) {
    console.warn('[PromotionBridge] No text provided for promotable item', item);
    return;
  }
  const width = clampDimension(item.data?.width, Math.max(320, Math.min(640, text.length * 10)), 64);
  const height = clampDimension(item.data?.height, 80, 32);
  const { x, y } = getViewportOrigin(editor, width, height);

  editor.createShape({
    id: createShapeId(),
    type: 'text' as const,
    x,
    y,
    props: {
      color: 'black',
      size: 'm',
      font: 'draw',
      textAlign: 'start',
      w: width,
      richText: toRichText(text),
      scale: 1,
      autoSize: true,
    },
  } as any);
};

const createBookmarkShape = (editor: Editor, item: PromotableItem) => {
  const url = item.data?.url;
  if (!isValidUrl(url)) {
    console.warn('[PromotionBridge] Invalid or missing URL for bookmark promotion', item);
    return;
  }
  const width = clampDimension(item.data?.width, 420, 120);
  const height = clampDimension(item.data?.height, 240, 120);
  const { x, y } = getViewportOrigin(editor, width, height);

  const assetId = AssetRecordType.createId();
  const asset = {
    id: assetId,
    typeName: 'asset' as const,
    type: 'bookmark' as const,
    props: {
      title: item.data?.title || item.label || url,
      description: '',
      image: '',
      favicon: '',
      src: url,
    },
    meta: {},
  };

  editor.createAssets([asset as any]);
  editor.createShape({
    id: createShapeId(),
    type: 'bookmark' as const,
    x,
    y,
    props: {
      w: width,
      h: height,
      assetId,
      url,
    },
  } as any);
};

const detectEmbedDefaults = (url: string) => {
  if (/youtube\.com|youtu\.be/.test(url)) {
    return { w: 640, h: 360 };
  }
  if (/spotify\.com/.test(url)) {
    return { w: 640, h: 232 };
  }
  if (/figma\.com/.test(url)) {
    return { w: 720, h: 450 };
  }
  return { w: 560, h: 315 };
};

const createEmbedShape = (editor: Editor, item: PromotableItem) => {
  const url = item.data?.url;
  if (!isValidUrl(url)) {
    console.warn('[PromotionBridge] Invalid or missing URL for embed promotion', item);
    return;
  }
  const defaults = detectEmbedDefaults(url);
  const width = clampDimension(item.data?.width, defaults.w, 160);
  const height = clampDimension(item.data?.height, defaults.h, 120);
  const { x, y } = getViewportOrigin(editor, width, height);

  editor.createShape({
    id: createShapeId(),
    type: 'embed' as const,
    x,
    y,
    props: {
      w: width,
      h: height,
      url,
    },
  } as any);
};

const promoteItemToCanvas = (editor: Editor, item: PromotableItem) => {
  try {
    switch (item.type) {
      case 'image':
        return createImageShape(editor, item);
      case 'text':
        return createTextShape(editor, item);
      case 'url':
        return createBookmarkShape(editor, item);
      case 'embed':
        return createEmbedShape(editor, item);
      default:
        console.warn('[PromotionBridge] Unsupported promotable type', item);
    }
  } catch (err) {
    console.error('[PromotionBridge] Failed to promote item', err);
  }
};

export function attachPromotionBridge({ editor }: PromotionBridgeOptions) {
  const cleanupFns: Array<() => void> = [];

  const cleanup = registerSingletonWindowListener(
    '__present_promote_content_handler',
    'tldraw:promote_content',
    (event) => {
      const detail = (event as CustomEvent).detail as any;
      const item = (detail?.item ?? detail) as PromotableItem | undefined;
      if (!item) {
        console.warn('[PromotionBridge] Received promote event without item payload');
        return;
      }
      promoteItemToCanvas(editor, item);
    },
  );
  cleanupFns.push(cleanup);

  return () => {
    cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore cleanup errors */
      }
    });
  };
}
