import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'public', 'tldraw-assets');
mkdirSync(destination, { recursive: true });
for (const folder of ['fonts', 'icons', 'translations', 'embed-icons']) {
  cpSync(join(root, 'node_modules', '@tldraw', 'assets', folder), join(destination, folder), { recursive: true });
}
