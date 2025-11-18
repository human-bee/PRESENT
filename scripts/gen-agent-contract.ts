#!/usr/bin/env tsx

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { zodToJsonSchema } from 'zod-to-json-schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type GeneratedActionSchema = {
  name: string;
  schema: ReturnType<typeof zodToJsonSchema>;
};

const requireFromHere = createRequire(import.meta.url);

type AgentUtilsModule = typeof import('../vendor/tldraw-agent-template/shared/AgentUtils');

let patchedZod = false;

function patchModuleExports(mod: Record<string, unknown> | undefined, label?: string) {
  if (!mod) return;
  const prototypes = new Set<Record<string, unknown>>();
  const attachMeta = (schema: Record<string, unknown>) => {
    if (typeof schema.meta === 'function') {
      return schema;
    }
    Object.defineProperty(schema, 'meta', {
      value(metadata: Record<string, unknown>) {
        if (!this._def) {
          Object.defineProperty(this, '_def', { value: {}, writable: true });
        }
        this._def.meta = { ...(this._def.meta as Record<string, unknown> | undefined), ...metadata };
        return this;
      },
      configurable: true,
      writable: true,
    });
    return schema;
  };
  const collect = (candidate?: { prototype?: Record<string, unknown> }) => {
    if (!candidate?.prototype) return;
    prototypes.add(candidate.prototype);
  };
  collect(mod.ZodType as { prototype?: Record<string, unknown> });
  collect((mod as Record<string, unknown>).default as { prototype?: Record<string, unknown> });
  collect((mod as Record<string, unknown>).z as { prototype?: Record<string, unknown> });

  for (const proto of prototypes) {
    if (!proto || typeof proto.meta === 'function') {
      continue;
    }
    if (process.env.DEBUG_AGENT_CONTRACT === '1') {
      console.log(
        `Patching zod prototype keys${label ? ` [${label}]` : ''} `,
        Object.getOwnPropertyNames(proto),
      );
    }
    attachMeta(proto);
  }
}

async function ensureZodMetaPatch() {
  if (patchedZod) {
    return;
  }

  patchModuleExports(requireFromHere('zod'), 'cjs');
  const esmModule = await import('zod');
  patchModuleExports(esmModule as unknown as Record<string, unknown>, 'esm');
  if ('default' in esmModule) {
    patchModuleExports((esmModule as Record<string, unknown>).default as Record<string, unknown>, 'esm-default');
  }

  patchedZod = true;

  if (process.env.DEBUG_AGENT_CONTRACT === '1') {
    const testCjs = (requireFromHere('zod') as Record<string, any>).object({});
    console.log('Patched zod.meta helper for vendor schemas (cjs typeof =', typeof testCjs.meta, ')');
    const testEsm = (await import('zod')).object({});
    console.log('Patched zod.meta helper for vendor schemas (esm typeof =', typeof testEsm.meta, ')');
  }
}

async function importAgentUtils(): Promise<AgentUtilsModule> {
  await ensureZodMetaPatch();
  return import('../vendor/tldraw-agent-template/shared/AgentUtils');
}

async function main() {
  const { getAgentActionUtilsRecord } = await importAgentUtils();
  const actionUtils = getAgentActionUtilsRecord();

  const entries = Object.entries(actionUtils)
    .map(([name, util]) => {
      const schema = util.getSchema();
      if (!schema) {
        return null;
      }

      const jsonSchema = zodToJsonSchema(schema, {
        name: `${name}Action`,
        basePath: ['properties', 'actions', 'items'],
      });

      return {
        name,
        schema: jsonSchema,
      } satisfies GeneratedActionSchema;
    })
    .filter((value): value is GeneratedActionSchema => value !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'vendor/tldraw-agent-template',
    actions: entries,
  } satisfies {
    generatedAt: string;
    source: string;
    actions: GeneratedActionSchema[];
  };

  const targetDir = path.resolve(__dirname, '../generated');
  mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, 'agent-contract.json');
  writeFileSync(targetFile, `${JSON.stringify(output, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${entries.length} action schemas to ${path.relative(process.cwd(), targetFile)}`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
