/** Vite config: builds the Preact client from src/client into dist/client, and configures Vitest. */
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  plugins: [preact()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
