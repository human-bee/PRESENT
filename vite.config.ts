import { defineConfig } from 'vite';
export default defineConfig({ oxc: { jsx: { runtime: 'automatic' } }, build: { target: 'es2022' },
  server: { watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/docs/evidence/**', '**/.data/**'] } },
});
