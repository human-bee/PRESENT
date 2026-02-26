import { getModelControlApplyConfig, pickFirstNonEmpty } from './apply-config';

const APPLY_TIMEOUT_MS = 20_000;
const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.app/graphql/v2';
const DISCOVERY_TTL_MS = 5 * 60_000;

// Single-project defaults (PRESENT production). Any of these can still be overridden in config JSON.
const DEFAULT_VERCEL_TEAM_ID = 'team_fO9d0VBwdajXQ9sDxz9sJ8EA';
const DEFAULT_VERCEL_PROJECT_ID = 'prj_2ZlDYNPrmmUgQYKsBeQOi1BC0ISc';
const DEFAULT_VERCEL_PROJECT_NAME = 'present';

const DEFAULT_RAILWAY_PROJECT_ID = '98df8e65-3c11-452c-beb7-8fd0cb3754d3';
const DEFAULT_RAILWAY_ENVIRONMENT_NAME = 'production';
const DEFAULT_RAILWAY_CONDUCTOR_SERVICE_NAME = 'present-conductor';
const DEFAULT_RAILWAY_REALTIME_SERVICE_NAME = 'present-realtime';

export type ApplyServiceName = 'vercel_web' | 'railway_conductor' | 'railway_realtime';
export type ApplyStepStatus = 'applied' | 'failed' | 'skipped_unconfigured';
export type ApplyStepResult = {
  service: ApplyServiceName;
  status: ApplyStepStatus;
  detail?: string;
};

const APPLY_SERVICES: readonly ApplyServiceName[] = ['vercel_web', 'railway_conductor', 'railway_realtime'];

class MissingApplySettingError extends Error {
  constructor(public readonly key: string) {
    super(`Missing ${key}`);
    this.name = 'MissingApplySettingError';
  }
}

type ApplySuccess = {
  deploymentId: string;
  url?: string | null;
};

type RailwayDiscovery = {
  environmentId: string;
  serviceIdsByName: Record<string, string>;
};

type RailwayDiscoveryCacheEntry = {
  cacheKey: string;
  expiresAtMs: number;
  value: RailwayDiscovery;
};

let railwayDiscoveryCache: RailwayDiscoveryCacheEntry | null = null;
const railwayDiscoveryInFlight = new Map<string, Promise<RailwayDiscovery>>();

const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APPLY_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const requireSetting = (key: string, ...candidates: Array<string | null | undefined>): string => {
  const value = pickFirstNonEmpty(...candidates);
  if (!value) {
    throw new MissingApplySettingError(key);
  }
  return value;
};

const formatSuccessDetail = (result: ApplySuccess): string =>
  result.url ? `deploymentId=${result.deploymentId}, url=${result.url}` : `deploymentId=${result.deploymentId}`;

const discoverRailwayEnvironmentAndServices = async (params: {
  token: string;
  projectId: string;
  environmentName: string;
}): Promise<RailwayDiscovery> => {
  const cacheKey = `${params.projectId}:${params.environmentName}`;
  const now = Date.now();
  if (railwayDiscoveryCache && railwayDiscoveryCache.cacheKey === cacheKey && railwayDiscoveryCache.expiresAtMs > now) {
    return railwayDiscoveryCache.value;
  }
  const existing = railwayDiscoveryInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const discoveryPromise = (async () => {
    const query = `query ResolveRailway($projectId: String!) {
  project(id: $projectId) {
    environments {
      edges {
        node {
          id
          name
          serviceInstances {
            edges {
              node {
                serviceId
                serviceName
              }
            }
          }
        }
      }
    }
  }
}`;

    const payload = await withTimeout(async (signal) => {
      const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            projectId: params.projectId,
          },
        }),
        signal,
      });

      const body = (await response.json().catch(() => null)) as
        | {
            data?: {
              project?: {
                environments?: {
                  edges?: Array<{
                    node?: {
                      id?: string;
                      name?: string;
                      serviceInstances?: {
                        edges?: Array<{ node?: { serviceId?: string; serviceName?: string } }>;
                      };
                    };
                  }>;
                };
              };
            };
            errors?: Array<{ message?: string }>;
          }
        | null;

      if (!response.ok) {
        throw new Error(`Railway discovery failed: HTTP ${response.status}`);
      }

      if (body?.errors?.length) {
        throw new Error(`Railway discovery failed: ${body.errors[0]?.message || 'Unknown GraphQL error'}`);
      }

      return body;
    });

    const environments = payload?.data?.project?.environments?.edges || [];
    const envNode = environments
      .map((edge) => edge.node)
      .find((node) => node?.name?.toLowerCase() === params.environmentName.toLowerCase());

    if (!envNode?.id) {
      throw new Error(`Railway discovery failed: environment ${params.environmentName} not found`);
    }

    const serviceIdsByName: Record<string, string> = {};
    const serviceNodes = envNode.serviceInstances?.edges || [];
    for (const edge of serviceNodes) {
      const name = edge.node?.serviceName?.trim();
      const id = edge.node?.serviceId?.trim();
      if (name && id) {
        serviceIdsByName[name] = id;
      }
    }

    const value: RailwayDiscovery = {
      environmentId: envNode.id,
      serviceIdsByName,
    };

    railwayDiscoveryCache = {
      cacheKey,
      expiresAtMs: Date.now() + DISCOVERY_TTL_MS,
      value,
    };

    return value;
  })();

  railwayDiscoveryInFlight.set(cacheKey, discoveryPromise);
  try {
    return await discoveryPromise;
  } finally {
    railwayDiscoveryInFlight.delete(cacheKey);
  }
};

const resolveRailwaySettings = async (service: ApplyServiceName) => {
  const config = getModelControlApplyConfig();
  const token = requireSetting(
    'MODEL_CONTROL_APPLY_RAILWAY_TOKEN',
    config.railway?.token,
    process.env.MODEL_CONTROL_APPLY_RAILWAY_TOKEN,
  );

  const directEnvironmentId = pickFirstNonEmpty(
    config.railway?.environmentId,
    process.env.MODEL_CONTROL_APPLY_RAILWAY_ENVIRONMENT_ID,
  );

  const directServiceId =
    service === 'railway_conductor'
      ? pickFirstNonEmpty(
          config.railway?.conductorServiceId,
          process.env.MODEL_CONTROL_APPLY_RAILWAY_CONDUCTOR_SERVICE_ID,
        )
      : pickFirstNonEmpty(
          config.railway?.realtimeServiceId,
          process.env.MODEL_CONTROL_APPLY_RAILWAY_REALTIME_SERVICE_ID,
        );

  if (directEnvironmentId && directServiceId) {
    return {
      token,
      environmentId: directEnvironmentId,
      serviceId: directServiceId,
    };
  }

  const projectId = pickFirstNonEmpty(
    config.railway?.projectId,
    process.env.MODEL_CONTROL_APPLY_RAILWAY_PROJECT_ID,
    DEFAULT_RAILWAY_PROJECT_ID,
  ) as string;

  const environmentName = pickFirstNonEmpty(
    config.railway?.environmentName,
    process.env.MODEL_CONTROL_APPLY_RAILWAY_ENVIRONMENT_NAME,
    DEFAULT_RAILWAY_ENVIRONMENT_NAME,
  ) as string;

  const discovery = await discoverRailwayEnvironmentAndServices({
    token,
    projectId,
    environmentName,
  });

  const serviceName =
    service === 'railway_conductor'
      ? pickFirstNonEmpty(config.railway?.conductorServiceName, DEFAULT_RAILWAY_CONDUCTOR_SERVICE_NAME)
      : pickFirstNonEmpty(config.railway?.realtimeServiceName, DEFAULT_RAILWAY_REALTIME_SERVICE_NAME);

  const discoveredServiceId = serviceName ? discovery.serviceIdsByName[serviceName] : null;
  const serviceId = directServiceId || discoveredServiceId;
  const environmentId = directEnvironmentId || discovery.environmentId;

  if (!environmentId) {
    throw new MissingApplySettingError('MODEL_CONTROL_APPLY_RAILWAY_ENVIRONMENT_ID');
  }

  if (!serviceId) {
    const missingKey =
      service === 'railway_conductor'
        ? 'MODEL_CONTROL_APPLY_RAILWAY_CONDUCTOR_SERVICE_ID'
        : 'MODEL_CONTROL_APPLY_RAILWAY_REALTIME_SERVICE_ID';
    throw new MissingApplySettingError(missingKey);
  }

  return {
    token,
    environmentId,
    serviceId,
  };
};

const resolveVercelSettings = () => {
  const config = getModelControlApplyConfig();
  return {
    token: requireSetting(
      'MODEL_CONTROL_APPLY_VERCEL_TOKEN',
      config.vercel?.token,
      process.env.MODEL_CONTROL_APPLY_VERCEL_TOKEN,
    ),
    teamId: pickFirstNonEmpty(
      config.vercel?.teamId,
      process.env.MODEL_CONTROL_APPLY_VERCEL_TEAM_ID,
      process.env.VERCEL_ORG_ID,
      DEFAULT_VERCEL_TEAM_ID,
    ) as string,
    projectId: pickFirstNonEmpty(
      config.vercel?.projectId,
      process.env.MODEL_CONTROL_APPLY_VERCEL_PROJECT_ID,
      process.env.VERCEL_PROJECT_ID,
      DEFAULT_VERCEL_PROJECT_ID,
    ) as string,
    projectName: pickFirstNonEmpty(
      config.vercel?.projectName,
      process.env.MODEL_CONTROL_APPLY_VERCEL_PROJECT_NAME,
      DEFAULT_VERCEL_PROJECT_NAME,
    ) as string,
  };
};

const redeployRailway = async (service: ApplyServiceName): Promise<ApplySuccess> => {
  const settings = await resolveRailwaySettings(service);
  const query = `mutation ServiceInstanceDeploy($environmentId: String!, $serviceId: String!) {
  serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId)
}`;
  return withTimeout(async (signal) => {
    const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          environmentId: settings.environmentId,
          serviceId: settings.serviceId,
        },
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { data?: { serviceInstanceDeployV2?: string | null }; errors?: Array<{ message?: string }> }
      | null;
    if (!response.ok) {
      throw new Error(`Railway deploy failed: HTTP ${response.status}`);
    }
    const deploymentId = payload?.data?.serviceInstanceDeployV2;
    if (!deploymentId) {
      const firstError = payload?.errors?.[0]?.message;
      throw new Error(firstError ? `Railway deploy failed: ${firstError}` : 'Railway deploy failed');
    }
    return { deploymentId };
  });
};

const redeployVercel = async (): Promise<ApplySuccess> => {
  const settings = resolveVercelSettings();
  const latestDeploymentId = await withTimeout(async (signal) => {
    const response = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(settings.projectId)}&target=production&limit=1&teamId=${encodeURIComponent(settings.teamId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        signal,
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { deployments?: Array<{ uid?: string | null }> }
      | { error?: { message?: string } }
      | null;
    if (!response.ok) {
      const detail = (payload as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(`Failed to load latest Vercel deployment${detail ? `: ${detail}` : ''}`);
    }
    const deploymentId = payload && 'deployments' in payload ? payload.deployments?.[0]?.uid : null;
    if (!deploymentId) {
      throw new Error('No production deployment found to redeploy');
    }
    return deploymentId;
  });

  return withTimeout(async (signal) => {
    const response = await fetch(`https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(settings.teamId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: settings.projectName,
        project: settings.projectName,
        target: 'production',
        deploymentId: latestDeploymentId,
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { id?: string | null; url?: string | null; error?: { message?: string } }
      | null;
    if (!response.ok || !payload?.id) {
      const detail = payload?.error?.message;
      throw new Error(`Vercel redeploy failed${detail ? `: ${detail}` : ''}`);
    }
    return {
      deploymentId: payload.id,
      url: payload.url,
    };
  });
};

type ApplyAdapter = () => Promise<ApplySuccess>;
const APPLY_ADAPTERS: Record<ApplyServiceName, ApplyAdapter> = {
  vercel_web: redeployVercel,
  railway_conductor: () => redeployRailway('railway_conductor'),
  railway_realtime: () => redeployRailway('railway_realtime'),
};

export function getApplyServices(): readonly ApplyServiceName[] {
  return APPLY_SERVICES;
}

export async function runApplyService(service: ApplyServiceName): Promise<ApplyStepResult> {
  try {
    const result = await APPLY_ADAPTERS[service]();
    return {
      service,
      status: 'applied',
      detail: formatSuccessDetail(result),
    };
  } catch (error) {
    if (error instanceof MissingApplySettingError) {
      return {
        service,
        status: 'skipped_unconfigured',
        detail: `Missing ${error.key}`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      service,
      status: 'failed',
      detail: message.slice(0, 240),
    };
  }
}

export function __resetApplyRuntimeCachesForTests(): void {
  railwayDiscoveryCache = null;
  railwayDiscoveryInFlight.clear();
}
