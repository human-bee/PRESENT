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

const { middleware } = require('./middleware');

describe('legacy archive middleware', () => {
  it('marks legacy paths with archive headers', () => {
    const response = middleware({
      nextUrl: {
        pathname: '/canvas',
      },
    });

    expect(response.headers.get('x-present-runtime')).toBe('legacy-archive');
    expect(response.headers.get('x-present-entrypoint')).toBe('/');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('leaves reset paths unmarked', () => {
    const response = middleware({
      nextUrl: {
        pathname: '/api/reset/workspaces',
      },
    });

    expect(response.headers.get('x-present-runtime')).toBeNull();
    expect(response.headers.get('x-present-entrypoint')).toBeNull();
  });
});
