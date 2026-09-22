import { defineConfig } from 'vite';
export default defineConfig({ esbuild: { jsx: 'automatic' }, build: { target: 'es2022' } });
