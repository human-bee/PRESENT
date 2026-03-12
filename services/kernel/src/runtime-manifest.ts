import { runtimeManifestSchema } from '@present/contracts';

export function buildRuntimeManifest() {
  return runtimeManifestSchema.parse({
    generatedAt: new Date().toISOString(),
    codex: {
      appServerBaseUrl: process.env.CODEX_APP_SERVER_URL ?? 'http://127.0.0.1:4096',
      authModes: ['chatgpt', 'api_key', 'shared_key', 'byok'],
      recommendedModels: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
    },
    mcp: {
      serverName: 'present-mcp',
      transport: 'stdio',
      command: ['npm', 'run', 'present:mcp'],
    },
    collaboration: {
      livekitEnabled: true,
      canvasEnabled: true,
      widgetsEnabled: true,
      dualClient: true,
    },
  });
}
