/** Images are app-owned local assets; room data cannot introduce remote tracking URLs. */
export function localImageSource(value: unknown): string | null {
  return typeof value === 'string' && /^\/media\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif|avif)$/.test(value) ? value : null;
}
