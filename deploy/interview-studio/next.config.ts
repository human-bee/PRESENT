import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 2 },
  async headers() {
    return [{ source: '/:path*',headers: [
      { key: 'Referrer-Policy',value: 'no-referrer' },
      { key: 'X-Content-Type-Options',value: 'nosniff' },
      { key: 'Permissions-Policy',value: 'camera=(self), microphone=(self), display-capture=(self)' },
    ] }];
  },
};
export default config;
