import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer') } },
  },
});
