/**
 * Which edition this client build is: the local edition (Fastify server + Ollama + Piper) or the web
 * edition (`npm run build:web`, Vite mode `web`: the game runs in the page, no AI, browser voice).
 * Also maps server-style asset paths (`/assets/...`) onto the build's base path, so the web edition
 * works from any sub-folder (e.g. GitHub Pages `/DnD-game/`).
 */

export const WEB_EDITION: boolean = import.meta.env.MODE === 'web';

/** `/assets/models/x.glb` → `<base>assets/models/x.glb` (base '/' in the local edition, './' or '/<repo>/' on the web). */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL ?? '/'): string {
  if (!path.startsWith('/assets/')) return path;
  return (base.endsWith('/') ? base : `${base}/`) + path.slice(1);
}
