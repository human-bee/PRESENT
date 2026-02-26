describe('apply runtime', () => {
  const CONFIG_ENV = 'MODEL_CONTROL_APPLY_CONFIG_JSON';
  const originalConfig = process.env[CONFIG_ENV];
  const originalFetch = global.fetch;

  const restoreConfig = () => {
    if (typeof originalConfig === 'undefined') {
      delete process.env[CONFIG_ENV];
      return;
    }
    process.env[CONFIG_ENV] = originalConfig;
  };

  const mockJsonResponse = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response;

  beforeEach(() => {
    restoreConfig();
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    restoreConfig();
    global.fetch = originalFetch;
  });

  it('returns skipped_unconfigured when required token is missing', async () => {
    delete process.env[CONFIG_ENV];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runApplyService } = require('./apply-runtime');
    const result = await runApplyService('vercel_web');
    expect(result.status).toBe('skipped_unconfigured');
    expect(result.detail).toContain('MODEL_CONTROL_APPLY_VERCEL_TOKEN');
  });

  it('runs vercel adapter successfully when config is present', async () => {
    process.env[CONFIG_ENV] = JSON.stringify({
      vercel: {
        token: 'vercel-token',
        teamId: 'team-id',
        projectId: 'project-id',
        projectName: 'present',
      },
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v6/deployments')) {
        return mockJsonResponse(200, { deployments: [{ uid: 'latest-deployment-id' }] });
      }
      if (url.includes('/v13/deployments')) {
        expect(init?.method).toBe('POST');
        return mockJsonResponse(200, { id: 'redeploy-id', url: 'present-redeploy.vercel.app' });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    }) as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runApplyService, __resetApplyRuntimeCachesForTests } = require('./apply-runtime');
    __resetApplyRuntimeCachesForTests();
    const result = await runApplyService('vercel_web');
    if (result.status !== 'applied') {
      throw new Error(`vercel apply failed in test: ${result.detail || 'missing detail'}`);
    }
    expect(result.status).toBe('applied');
    expect(result.detail).toContain('deploymentId=redeploy-id');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('dedupes railway discovery when both railway services apply concurrently', async () => {
    process.env[CONFIG_ENV] = JSON.stringify({
      railway: {
        token: 'railway-token',
        projectId: 'project-id',
        environmentName: 'production',
        conductorServiceName: 'present-conductor',
        realtimeServiceName: 'present-realtime',
      },
    });

    let discoveryCalls = 0;
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        query?: string;
        variables?: Record<string, string>;
      };
      if (body.query?.includes('ResolveRailway')) {
        discoveryCalls += 1;
        return mockJsonResponse(200, {
          data: {
            project: {
              environments: {
                edges: [
                  {
                    node: {
                      id: 'env-id',
                      name: 'production',
                      serviceInstances: {
                        edges: [
                          { node: { serviceId: 'svc-conductor', serviceName: 'present-conductor' } },
                          { node: { serviceId: 'svc-realtime', serviceName: 'present-realtime' } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        });
      }
      if (body.query?.includes('ServiceInstanceDeploy')) {
        const deploymentId = `dep-${body.variables?.serviceId || 'unknown'}`;
        return mockJsonResponse(200, {
          data: {
            serviceInstanceDeployV2: deploymentId,
          },
        });
      }
      throw new Error(`unexpected railway fetch payload: ${String(init?.body)}`);
    }) as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runApplyService, __resetApplyRuntimeCachesForTests } = require('./apply-runtime');
    __resetApplyRuntimeCachesForTests();

    const [conductor, realtime] = await Promise.all([
      runApplyService('railway_conductor'),
      runApplyService('railway_realtime'),
    ]);
    if (conductor.status !== 'applied' || realtime.status !== 'applied') {
      throw new Error(
        `railway apply failed in test: conductor=${conductor.detail || conductor.status}, realtime=${realtime.detail || realtime.status}`,
      );
    }
    expect(conductor.status).toBe('applied');
    expect(realtime.status).toBe('applied');
    expect(discoveryCalls).toBe(1);
  });
});
