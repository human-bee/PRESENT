import { defineConfig } from 'vite';
export default defineConfig({ esbuild: { jsx: 'automatic' }, build: { target: 'es2022' },
  server: { watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/docs/evidence/**', '**/.data/**'] } },
});
