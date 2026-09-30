/**
 * Vite config: builds the Preact client from src/client into dist/client, and configures Vitest.
 * `vite build --mode web` (npm run build:web) makes the web edition instead: the game runs in the page
 * (InPage transport, no AI), relative asset URLs (base './', or WEB_BASE e.g. `/DnD-game/`) and the
 * downloaded models/audio copied next to it → dist-web/ (a static site for GitHub Pages).
 */
import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';
import type { ProxyOptions } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB_OUT = resolve(ROOT, 'dist-web');

/** Copies assets/models and assets/audio (fetched by Setup / CI) into the web build; skipped if not downloaded. */
function copyGameAssets(): Plugin {
  return {
    name: 'copy-game-assets',
    apply: 'build',
    closeBundle() {
      for (const sub of ['models', 'audio']) {
        const from = resolve(ROOT, 'assets', sub);
        if (!existsSync(from)) {
          console.warn(`[web] assets/${sub} not found (run the fetch scripts): the web build has no ${sub}.`);
          continue;
        }
        cpSync(from, join(WEB_OUT, 'assets', sub), { recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  // During `npm run dev`, forward API and game-channel traffic to the Fastify server (npm run dev:server).
  // The web edition has no server (and `vite preview` would inherit the proxy and hide dist-web/assets).
  const proxy: Record<string, string | ProxyOptions> = web
    ? {}
    : {
        '/api': 'http://127.0.0.1:3210',
        '/assets': 'http://127.0.0.1:3210',
        '/ws': { target: 'ws://127.0.0.1:3210', ws: true },
      };
  return {
    root: 'src/client',
    publicDir: false,
    base: web ? (process.env.WEB_BASE ?? './') : '/',
    plugins: web ? [preact(), copyGameAssets()] : [preact()],
    server: { proxy },
    build: {
      outDir: web ? WEB_OUT : '../../dist/client',
      emptyOutDir: true,
      // Keep Vite's own chunks apart from the copied game assets (assets/models, assets/audio).
      ...(web ? { assetsDir: 'app' } : {}),
      // The SRD data (~1.2 MB of JSON) is bundled; splitting it out is part of the performance pass (A112).
      chunkSizeWarningLimit: 2000,
    },
    test: {
      root: '.',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
      environment: 'node',
      // Adventure solver and full-fight simulation tests take 3–12 s alone and 30 s+ under full parallel load
      // on a hybrid laptop CPU (i7-1260P: tests landing on E-cores); the 5 s default flakes.
      testTimeout: 60_000,
    },
  };
});
