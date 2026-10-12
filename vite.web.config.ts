import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** UI-only dev server in a plain browser, backed by the mock API (src/renderer/dev/mock.ts). */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@renderer': resolve(__dirname, 'src/renderer') } },
  server: { port: 5199 },
});
