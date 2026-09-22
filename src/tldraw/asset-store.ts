import type { TLAssetStore } from 'tldraw';

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const localAssetPath = /^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|gif|webp|avif|mp4|webm|mov)$/;
const localMediaPath = /^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/;
const mediaTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime']);

export const presentAssetStore: TLAssetStore = {
  async upload(_asset, file, signal) {
    if (!mediaTypes.has(file.type)) throw new Error('Drop a PNG, JPEG, GIF, WebP, AVIF, MP4, WebM or MOV file.');
    if (!file.size || file.size > MAX_ASSET_BYTES) throw new Error('Images and videos can be up to 25 MB.');
    const response = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, signal });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'This file could not upload. Try again.');
    if (!result || typeof result !== 'object' || !('src' in result) || typeof result.src !== 'string' || !localAssetPath.test(result.src)) throw new Error('The upload did not return a local asset.');
    return { src: result.src };
  },
  resolve(asset) {
    const src = asset.props.src;
    return typeof src === 'string' && (localAssetPath.test(src) || localMediaPath.test(src)) ? src : null;
  },
};
