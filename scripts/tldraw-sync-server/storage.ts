import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, join } from 'path';
import type { IncomingMessage } from 'http';

const ASSET_DIR = resolve('.tldraw-local/assets');

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
}

export async function loadAsset(id: string): Promise<Buffer | null> {
  try {
    const filePath = join(ASSET_DIR, id);
    await access(filePath, constants.R_OK);
    return await readFile(filePath);
  } catch {
    return null;
  }
}
