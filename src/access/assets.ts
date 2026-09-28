import type { TLAssetStore } from 'tldraw';
import { presentAssetStore, MAX_ASSET_BYTES } from '../tldraw/asset-store';
export function privateAssetStore(roomId: string): TLAssetStore {
  const prefix = `/api/assets/${roomId}/`;
  return {
    async upload(_asset, file, signal) {
      if (!file.size || file.size > MAX_ASSET_BYTES) throw new Error('Images and videos can be up to 25 MB.');
      const response = await fetch(`/api/assets/${roomId}`, { method: 'POST', headers: { 'content-type': file.type }, body: file, signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Upload failed.');
      if (typeof value.src !== 'string' || !value.src.startsWith(prefix) || !/^[a-f0-9]{64}\.(png|jpg|gif|webp|avif|mp4|webm|mov)$/.test(value.src.slice(prefix.length))) throw new Error('Invalid room asset.');
      return { src: value.src };
    },
    resolve(asset) {
      const src = asset.props.src;
      return typeof src === 'string' && src.startsWith(prefix) ? src : null;
    },
  };
}
export { presentAssetStore };
