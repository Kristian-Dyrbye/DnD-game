/**
 * Client entry point: mounts the Preact app. The web edition first moves game, saves and settings into
 * the page; the UI modules load only after that, because ui/state.ts may send `new_game` as soon as it
 * loads (`#play-<class>`), which must go through the in-page transport.
 */
import { render } from 'preact';
import { WEB_EDITION } from './edition';
import './styles.css';

async function start(): Promise<void> {
  if (WEB_EDITION) await (await import('./webEdition')).startWebEdition();
  const { App } = await import('./ui/App');
  const root = document.getElementById('app');
  if (root) render(<App />, root);
}

start().catch((err: unknown) => {
  // Shown instead of a blank page (e.g. an old cached build or a browser without module support).
  console.error(err);
  const root = document.getElementById('app');
  if (root) root.textContent = `The game failed to start: ${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`;
});
