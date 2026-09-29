/** Vite config: builds the Preact client from src/client into dist/client, and configures Vitest. */
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  plugins: [preact()],
  server: {
    // During `npm run dev`, forward API and game-channel traffic to the Fastify server (npm run dev:server).
    proxy: {
      '/api': 'http://127.0.0.1:3210',
      '/assets': 'http://127.0.0.1:3210',
      '/ws': { target: 'ws://127.0.0.1:3210', ws: true },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    // The SRD data (~1.2 MB of JSON) is bundled; splitting it out is part of the performance pass (A112).
    chunkSizeWarningLimit: 3000,
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
