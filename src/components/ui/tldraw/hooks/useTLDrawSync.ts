import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSync, type RemoteTLStoreWithStatus } from '@tldraw/sync';
import type { customShapeUtil } from '../tldraw-canvas';
import { createLogger } from '@/lib/utils';
import { buildSyncContract, getCanvasIdFromCurrentUrl } from '@/lib/realtime/sync-contract';
import {
  AssetRecordType,
  MediaHelpers,
  defaultBindingUtils,
  defaultShapeUtils,
  getHashForString,
  type TLAsset,
  type TLBookmarkAsset,
  type TLAssetStore,
  uniqueId,
} from 'tldraw';

const DEFAULT_SYNC_HOST = 'https://demo.tldraw.xyz';
const IMAGE_WORKER = 'https://images.tldraw.xyz';

type PresentWindow = Window & {
  __present?: {
    syncDiagnostics?: {
      tldraw?: Record<string, unknown>;
    };
  };
};

type SyncHookGlobal = typeof globalThis & {
  __LOGGED_TLDRAW_SYNC_HOST__?: boolean;
  __WARNED_PRESENT_TLDRAW_DEMO_HOST__?: boolean;
};

function shallowEqualObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  if (left === right) return true;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }

  return true;
}

function useStableShallowObjectIdentity<T extends Record<string, unknown>>(value: T): T {
  const ref = useRef(value);

  if (!shallowEqualObjects(ref.current, value)) {
    ref.current = value;
  }

  return ref.current;
}

export function normalizeHost(rawHost?: string | null) {
  if (!rawHost) return null;
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}

export function resolveSyncHost(rawHost?: string | null) {
  const envHost = normalizeHost(rawHost);
  if (!envHost) return DEFAULT_SYNC_HOST;

  try {
    const url = new URL(envHost);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      url.protocol = 'https:';
    }
    url.pathname = url.pathname.replace(/\/?connect\/?$/, '').replace(/\/+$/, '');
    return url.origin;
  } catch {
    return DEFAULT_SYNC_HOST;
  }
}

export function isTldrawOwnedHost(host: string) {
  try {
    const url = new URL(host);
    return ['tldraw.com', 'tldraw.xyz'].some(
      (disallowedHost) =>
        url.hostname === disallowedHost || url.hostname.endsWith(`.${disallowedHost}`),
    );
  } catch {
    return false;
  }
}

function buildUploadMethodOrder(host: string): Array<'PUT' | 'POST'> {
  return isTldrawOwnedHost(host) ? ['POST', 'PUT'] : ['PUT', 'POST'];
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

export async function uploadAssetToSyncHost(host: string, file: File): Promise<{ src: string }> {
  const id = uniqueId();
  const objectName = `${id}-${file.name}`.replace(/\W/g, '-');
  const url = `${host}/uploads/${objectName}`;
  const headers = file.type ? { 'Content-Type': file.type } : undefined;

  let lastError: unknown = null;
  let lastStatus: number | null = null;
  let lastDetail = '';

  for (const method of buildUploadMethodOrder(host)) {
    try {
      const response = await fetch(url, {
        method,
        body: file,
        headers,
      });
      if (response.ok) {
        return { src: url };
      }
      lastStatus = response.status;
      lastDetail = await readResponseText(response);
      if (![404, 405, 501].includes(response.status)) {
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  const suffix = lastDetail ? `: ${lastDetail}` : '';
  throw new Error(
    `Failed to upload TLDraw asset to ${host} (${lastStatus ?? 'network error'}${suffix})`,
  );
}

export function createSyncAssetStore(host: string): TLAssetStore {
  return {
    upload: async (_asset, file) => uploadAssetToSyncHost(host, file),
    resolve(asset, context) {
      if (!asset.props.src) return null;

      if (asset.type === 'video') return asset.props.src;
      if (asset.type !== 'image') return null;
      if (!asset.props.src.startsWith('http:') && !asset.props.src.startsWith('https:')) {
        return asset.props.src;
      }
      if (context.shouldResolveToOriginal) return asset.props.src;
      if (MediaHelpers.isAnimatedImageType(asset.props.mimeType) || asset.props.isAnimated) {
        return asset.props.src;
      }
      if (MediaHelpers.isVectorImageType(asset.props.mimeType)) return asset.props.src;

      const url = new URL(asset.props.src);
      const isTldrawImage = /\.tldraw\.(?:com|xyz|dev|workers\.dev)$/.test(url.host);
      const hostIsTldrawOwned = isTldrawOwnedHost(host);

      if (!isTldrawImage || !hostIsTldrawOwned) return asset.props.src;

      const { fileSize = 0 } = asset.props;
      const isWorthResizing = fileSize >= 1024 * 1024 * 1.5;

      if (isWorthResizing) {
        const networkCompensation =
          !context.networkEffectiveType || context.networkEffectiveType === '4g' ? 1 : 0.5;
        const width = Math.ceil(
          Math.min(
            asset.props.w *
              Math.max(1 / 32, Math.min(context.steppedScreenScale, 1)) *
              networkCompensation *
              context.dpr,
            asset.props.w,
          ),
        );
        url.searchParams.set('w', width.toString());
      }

      return `${IMAGE_WORKER}/${url.host}/${url.toString().slice(url.origin.length + 1)}`;
    },
  };
}

function createBlankBookmarkAsset(url: string): TLBookmarkAsset {
  const urlHash = getHashForString(url);
  return {
    id: AssetRecordType.createId(urlHash),
    typeName: 'asset',
    type: 'bookmark',
    props: {
      src: url,
      description: '',
      image: '',
      favicon: '',
      title: '',
    },
    meta: {},
  };
}

export async function createBookmarkAsset(host: string, url: string): Promise<TLBookmarkAsset> {
  try {
    const fetchUrl = new URL(`${host}/bookmarks/unfurl`);
    fetchUrl.searchParams.set('url', url);

    const response = await fetch(fetchUrl, { method: 'POST' });
    if (!response.ok) {
      return createBlankBookmarkAsset(url);
    }
    const meta = (await response.json()) as {
      description?: string;
      image?: string;
      favicon?: string;
      title?: string;
    } | null;

    return {
      ...createBlankBookmarkAsset(url),
      props: {
        src: url,
        description: meta?.description ?? '',
        image: meta?.image ?? '',
        favicon: meta?.favicon ?? '',
        title: meta?.title ?? '',
      },
    } satisfies TLBookmarkAsset;
  } catch {
    return createBlankBookmarkAsset(url);
  }
}

export function useTLDrawSync(
  roomName: string,
  shapeUtils?: readonly (typeof customShapeUtil)[],
): RemoteTLStoreWithStatus {
  const rawEnvHost =
    process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || process.env.NEXT_PUBLIC_TLDRAW_SYNC_HOST;
  const safeHost = useMemo(() => resolveSyncHost(rawEnvHost), [rawEnvHost]);
  const assetStore = useMemo(() => createSyncAssetStore(safeHost), [safeHost]);
  const usingTldrawOwnedHost = useMemo(() => isTldrawOwnedHost(safeHost), [safeHost]);

  const resolvedShapeUtils = useMemo(
    () => (shapeUtils && shapeUtils.length > 0 ? shapeUtils : undefined),
    [shapeUtils],
  );

  const syncOptions = useMemo(
    () => ({
      shapeUtils: resolvedShapeUtils
        ? [...defaultShapeUtils, ...resolvedShapeUtils]
        : defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
    }),
    [resolvedShapeUtils],
  );
  const stableSyncOptions = useStableShallowObjectIdentity(syncOptions);

  const registerExternalAssetHandler = useCallback(
    (editor: {
      registerExternalAssetHandler: (
        type: string,
        handler: (input: { url: string }) => Promise<TLAsset>,
      ) => void;
    }) => {
      editor.registerExternalAssetHandler('url', async ({ url }) =>
        createBookmarkAsset(safeHost, url),
      );
    },
    [safeHost],
  );

  const store: RemoteTLStoreWithStatus = useSync({
    uri: `${safeHost}/connect/${encodeURIComponent(roomName)}`,
    roomId: roomName,
    assets: assetStore,
    onMount: registerExternalAssetHandler,
    ...stableSyncOptions,
  } as Parameters<typeof useSync>[0] & {
    roomId: string;
    onMount: typeof registerExternalAssetHandler;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !roomName) return;
    try {
      const contract = buildSyncContract({
        roomName,
        canvasId: getCanvasIdFromCurrentUrl(),
        tldrawRoomId: roomName,
      });
      const diagnostics = {
        ok: contract.errors.length === 0,
        canvasId: contract.canvasId,
        roomName: contract.livekitRoomName,
        tldrawRoomId: contract.tldrawRoomId,
        syncStatus: store?.status ?? 'unknown',
        syncHost: safeHost,
        usingTldrawOwnedHost,
        errors: contract.errors,
        updatedAt: Date.now(),
      };
      const w = window as PresentWindow;
      w.__present = w.__present || {};
      w.__present.syncDiagnostics = w.__present.syncDiagnostics || {};
      w.__present.syncDiagnostics.tldraw = diagnostics;
      window.dispatchEvent(
        new CustomEvent('present:sync-diagnostic', {
          detail: { source: 'tldraw', ...diagnostics },
        }),
      );
    } catch {
      // noop
    }
  }, [roomName, safeHost, store?.status, usingTldrawOwnedHost]);

  useEffect(() => {
    if (typeof window === 'undefined' || !usingTldrawOwnedHost) return;
    try {
      const g = globalThis as SyncHookGlobal;
      if (g.__WARNED_PRESENT_TLDRAW_DEMO_HOST__) return;
      createLogger('Tldraw').warn(
        'Using a tldraw-owned sync host. Image upload compatibility depends on demo infrastructure; prefer the PRESENT sync worker for production.',
      );
      g.__WARNED_PRESENT_TLDRAW_DEMO_HOST__ = true;
    } catch {
      // noop
    }
  }, [usingTldrawOwnedHost]);

  try {
    const g = globalThis as SyncHookGlobal;
    if (process.env.NODE_ENV === 'development' && !g.__LOGGED_TLDRAW_SYNC_HOST__) {
      createLogger('Tldraw').info('Using sync host:', safeHost);
      g.__LOGGED_TLDRAW_SYNC_HOST__ = true;
    }
  } catch {
    // noop
  }

  return store;
}
