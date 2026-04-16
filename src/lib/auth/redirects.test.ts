import {
  buildAuthPageHref,
  DEFAULT_POST_AUTH_PATH,
  sanitizeInternalRedirectPath,
} from './redirects';

describe('auth redirect helpers', () => {
  it('falls back to the canvas for empty or unsafe next values', () => {
    expect(sanitizeInternalRedirectPath(null)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(sanitizeInternalRedirectPath('https://evil.example')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(sanitizeInternalRedirectPath('//evil.example')).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('keeps internal paths including query and hash', () => {
    expect(sanitizeInternalRedirectPath('/canvas?id=123#focus')).toBe('/canvas?id=123#focus');
  });

  it('omits the query param for the default destination', () => {
    expect(buildAuthPageHref('signin', '/canvas')).toBe('/auth/signin');
    expect(buildAuthPageHref('signup', null)).toBe('/auth/signup');
  });

  it('encodes non-default destinations into the auth page href', () => {
    expect(buildAuthPageHref('signin', '/canvas?id=123')).toBe(
      '/auth/signin?next=%2Fcanvas%3Fid%3D123',
    );
  });
});
