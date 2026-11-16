import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    // fengari reads its config from process.env
    'process.env.FENGARICONF': 'undefined',
  },
  esbuild: { charset: 'ascii' },
  worker: { format: 'es' },
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
});
