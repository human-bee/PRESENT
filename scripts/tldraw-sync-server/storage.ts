import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, join } from 'path';
import type { IncomingMessage } from 'http';

const ASSET_DIR = resolve('.tldraw-local/assets');
const META_SUFFIX = '.meta.json';

type StoredAsset = {
  data: Buffer;
  contentType: string;
};

async function ensureAssetDir() {
  await mkdir(ASSET_DIR, { recursive: true });
}

export async function storeAsset(id: string, stream: IncomingMessage) {
  await ensureAssetDir();
  const buffers: Buffer[] = [];
  for await (const chunk of stream) {
    buffers.push(Buffer.from(chunk));
  }
  await writeFile(join(ASSET_DIR, id), Buffer.concat(buffers));
  const contentType = stream.headers['content-type']?.trim() || 'application/octet-stream';
  await writeFile(join(ASSET_DIR, `${id}${META_SUFFIX}`), JSON.stringify({ contentType }));
}

export async function loadAsset(id: string): Promise<StoredAsset | null> {
  try {
    const filePath = join(ASSET_DIR, id);
    await access(filePath, constants.R_OK);
    const data = await readFile(filePath);
    let contentType = 'application/octet-stream';
    try {
      const metaRaw = await readFile(join(ASSET_DIR, `${id}${META_SUFFIX}`), 'utf8');
      const meta = JSON.parse(metaRaw) as { contentType?: string };
      if (typeof meta.contentType === 'string' && meta.contentType.trim()) {
        contentType = meta.contentType.trim();
      }
    } catch {
      // Older uploads may not have metadata; keep the binary fallback.
    }
    return { data, contentType };
  } catch {
    return null;
  }
}
