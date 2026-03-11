import { buildCodexAppServerManifest } from './app-server';

process.stdout.write(`${JSON.stringify(buildCodexAppServerManifest(), null, 2)}\n`);
