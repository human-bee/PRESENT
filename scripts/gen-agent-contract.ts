#!/usr/bin/env tsx

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type GeneratedActionSchema = {
  name: string;
  schema: ReturnType<typeof z.toJSONSchema>;
};

const requireFromHere = createRequire(import.meta.url);

type AgentUtilsModule = typeof import('../vendor/tldraw-agent-template/shared/AgentUtils');
type FairyActionSchemasModule = typeof import('../src/vendor/tldraw-fairy/fairy-shared/schema/AgentActionSchemas');

type ContractProfile = 'template24' | 'fairy48';

const PROFILE_CONFIG: Record<
  ContractProfile,
  {
    source: string;
    targetFile: string;
  }
> = {
  template24: {
    source: 'vendor/tldraw-agent-template',
    targetFile: 'agent-contract.json',
  },
  fairy48: {
    source: 'src/vendor/tldraw-fairy',
    targetFile: 'fairy-agent-contract.json',
  },
};

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

async function importFairyActionSchemas(): Promise<FairyActionSchemasModule> {
  await ensureZodMetaPatch();
  return import('../src/vendor/tldraw-fairy/fairy-shared/schema/AgentActionSchemas');
}

const isZodSchemaLike = (value: unknown): value is { safeParse: (input: unknown) => unknown; _def?: unknown } => {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as { safeParse?: unknown }).safeParse === 'function';
};

const readActionTypeLiteral = (schema: unknown): string | null => {
  if (!isZodSchemaLike(schema)) return null;
  const anySchema = schema as {
    _def?: {
      shape?: (() => Record<string, unknown>) | Record<string, unknown>;
    };
  };
  const shapeDef = anySchema._def?.shape;
  const shape =
    typeof shapeDef === 'function'
      ? (shapeDef as () => Record<string, unknown>)()
      : shapeDef && typeof shapeDef === 'object'
        ? (shapeDef as Record<string, unknown>)
        : null;
  if (!shape || !('_type' in shape)) return null;
  const typeSchema = shape._type as { _def?: { value?: unknown }; value?: unknown } | undefined;
  if (!typeSchema) return null;
  const literal = typeSchema._def?.value ?? typeSchema.value;
  return typeof literal === 'string' && literal.trim().length > 0 ? literal.trim() : null;
};

async function buildTemplateEntries(): Promise<GeneratedActionSchema[]> {
  const { getAgentActionUtilsRecord } = await importAgentUtils();
  const actionUtils = getAgentActionUtilsRecord();

  return Object.entries(actionUtils)
    .map(([name, util]) => {
      const schema = util.getSchema();
      if (!schema) {
        return null;
      }

      const jsonSchema = z.toJSONSchema(schema, {
        reused: 'ref',
      });

      return {
        name,
        schema: jsonSchema,
      } satisfies GeneratedActionSchema;
    })
    .filter((value): value is GeneratedActionSchema => value !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function buildFairyEntries(): Promise<GeneratedActionSchema[]> {
  const moduleExports = await importFairyActionSchemas();
  const byName = new Map<string, GeneratedActionSchema>();

  Object.entries(moduleExports).forEach(([exportName, value]) => {
    if (!exportName.endsWith('ActionSchema')) return;
    if (!isZodSchemaLike(value)) return;
    const actionName = readActionTypeLiteral(value);
    if (!actionName || actionName === 'unknown') return;

    const schema = z.toJSONSchema(value, {
      reused: 'ref',
    });
    byName.set(actionName, {
      name: actionName,
      schema,
    });
  });

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const parseProfiles = (argv: string[]): ContractProfile[] => {
  let requested = 'all';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      requested = 'all';
      continue;
    }
    if (arg.startsWith('--profile=')) {
      requested = arg.slice('--profile='.length);
      continue;
    }
    if (arg === '--profile') {
      requested = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
  }

  const normalized = requested.trim().toLowerCase();
  if (!normalized || normalized === 'all') return ['template24', 'fairy48'];
  if (normalized === 'template24' || normalized === 'template') return ['template24'];
  if (normalized === 'fairy48' || normalized === 'fairy') return ['fairy48'];
  throw new Error(`Unsupported --profile value "${requested}". Use template24, fairy48, or all.`);
};

async function writeProfileContract(profile: ContractProfile) {
  const entries = profile === 'template24' ? await buildTemplateEntries() : await buildFairyEntries();
  const config = PROFILE_CONFIG[profile];

  const output = {
    generatedAt: new Date().toISOString(),
    profile,
    source: config.source,
    actions: entries,
  } satisfies {
    generatedAt: string;
    profile: ContractProfile;
    source: string;
    actions: GeneratedActionSchema[];
  };

  const targetDir = path.resolve(__dirname, '../generated');
  mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, config.targetFile);
  writeFileSync(targetFile, `${JSON.stringify(output, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(
    `[${profile}] wrote ${entries.length} action schemas to ${path.relative(process.cwd(), targetFile)}`,
  );
}

async function main() {
  const profiles = parseProfiles(process.argv.slice(2));
  for (const profile of profiles) {
    await writeProfileContract(profile);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
