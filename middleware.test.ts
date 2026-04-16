const edgeFetch = require('next/dist/compiled/@edge-runtime/primitives/fetch');

(global as typeof globalThis & {
  Request?: typeof edgeFetch.Request;
  Response?: typeof edgeFetch.Response;
  Headers?: typeof edgeFetch.Headers;
}).Request = edgeFetch.Request;
(global as typeof globalThis & {
  Request?: typeof edgeFetch.Request;
  Response?: typeof edgeFetch.Response;
  Headers?: typeof edgeFetch.Headers;
}).Response = edgeFetch.Response;
(global as typeof globalThis & {
  Request?: typeof edgeFetch.Request;
  Response?: typeof edgeFetch.Response;
  Headers?: typeof edgeFetch.Headers;
}).Headers = edgeFetch.Headers;

const { proxy } = require('./proxy');

describe('legacy archive proxy', () => {
  it('redirects legacy canvas root query links onto /canvas', () => {
    const response = proxy({
      url: 'https://present.best/?id=0204807e-788f-455c-af3d-12b233c21dc4',
      nextUrl: {
        pathname: '/',
        searchParams: new URLSearchParams('id=0204807e-788f-455c-af3d-12b233c21dc4'),
      },
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://present.best/canvas?id=0204807e-788f-455c-af3d-12b233c21dc4',
    );
  });

  it('marks legacy paths with archive headers', () => {
    const response = proxy({
      url: 'https://present.best/canvas',
      nextUrl: {
        pathname: '/canvas',
        searchParams: new URLSearchParams(),
      },
    });

    expect(response.headers.get('x-present-runtime')).toBe('legacy-archive');
    expect(response.headers.get('x-present-entrypoint')).toBe('/');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('leaves reset paths unmarked', () => {
    const response = proxy({
      url: 'https://present.best/api/reset/workspaces',
      nextUrl: {
        pathname: '/api/reset/workspaces',
        searchParams: new URLSearchParams(),
      },
    });

    expect(response.headers.get('x-present-runtime')).toBeNull();
    expect(response.headers.get('x-present-entrypoint')).toBeNull();
  });
});
