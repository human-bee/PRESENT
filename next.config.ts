import type { NextConfig } from 'next';
import path from 'path';

const clientAliasMap = {
  // Prefer ESM build to avoid dist-cjs richText path in the browser
  'tldraw$': path.resolve(__dirname, 'node_modules/tldraw/dist-esm/index.mjs'),
  // Force ESM entries for tldraw subpackages to avoid dual CJS/ESM imports in dev
  '@tldraw/utils': path.resolve(__dirname, 'node_modules/@tldraw/utils/dist-esm/index.mjs'),
  '@tldraw/state': path.resolve(__dirname, 'node_modules/@tldraw/state/dist-esm/index.mjs'),
  '@tldraw/state-react': path.resolve(
    __dirname,
    'node_modules/@tldraw/state-react/dist-esm/index.mjs',
  ),
  '@tldraw/store': path.resolve(__dirname, 'node_modules/@tldraw/store/dist-esm/index.mjs'),
  '@tldraw/validate': path.resolve(__dirname, 'node_modules/@tldraw/validate/dist-esm/index.mjs'),
  '@tldraw/tlschema': path.resolve(__dirname, 'node_modules/@tldraw/tlschema/dist-esm/index.mjs'),
  '@tldraw/editor': path.resolve(__dirname, 'node_modules/@tldraw/editor/dist-esm/index.mjs'),
  // Force singleton React
  // react: path.resolve(__dirname, 'node_modules/react'),
  // 'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
} as const;

const serverAliasMap = {} as const;

const transpiledPackages = [
  'tldraw',
  '@tldraw/utils',
  '@tldraw/state',
  '@tldraw/state-react',
  '@tldraw/store',
  '@tldraw/validate',
  '@tldraw/tlschema',
  '@tldraw/editor',
  '@tiptap/core',
  '@tiptap/pm',
  '@tiptap/starter-kit',
  '@tiptap/extension-blockquote',
  '@tiptap/extension-bold',
  '@tiptap/extension-bubble-menu',
  '@tiptap/extension-bullet-list',
  '@tiptap/extension-code',
  '@tiptap/extension-code-block',
  '@tiptap/extension-document',
  '@tiptap/extension-dropcursor',
  '@tiptap/extension-floating-menu',
  '@tiptap/extension-gapcursor',
  '@tiptap/extension-hard-break',
  '@tiptap/extension-heading',
  '@tiptap/extension-highlight',
  '@tiptap/extension-history',
  '@tiptap/extension-horizontal-rule',
  '@tiptap/extension-italic',
  '@tiptap/extension-link',
  '@tiptap/extension-list-item',
  '@tiptap/extension-ordered-list',
  '@tiptap/extension-paragraph',
  '@tiptap/extension-strike',
  '@tiptap/extension-text',
  '@tiptap/extension-text-style',
  '@tiptap/extension-underline',
  '@radix-ui/react-password-toggle-field',
] as const;

const nextConfig: NextConfig = {
  // Keep TypeScript checks enabled during build so deploys fail fast on type regressions.
  typescript: {
    ignoreBuildErrors: false,
  },
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production' ? { exclude: ['warn', 'error'] } : false,
  },

  // Skip trailing slash redirect
  skipTrailingSlashRedirect: true,

  transpilePackages: [...transpiledPackages],

  // Fix tldraw multiple instances issue and alias away @custom-ai/react
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...(isServer ? serverAliasMap : clientAliasMap),
    };
    return config;
  },

  turbopack: {
    root: __dirname,
    resolveAlias: {
      ...clientAliasMap,
    },
  },

  /* config options here */
};

export default nextConfig;
