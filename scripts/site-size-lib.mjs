/**
 * site-size-lib.mjs — measures a static site folder (the web edition in dist-web/) for the Pages deploy.
 *
 * GitHub Pages sites should stay under 1 GB and single files under 100 MB. siteReport() walks the folder
 * and sums bytes per top-level group (app code, models, audio, other); checkSite() turns that into
 * problems. Plain Node ESM, no dependencies; used by scripts/site-size.mjs and tests.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const SITE_LIMIT_BYTES = 1024 ** 3;
export const FILE_LIMIT_BYTES = 100 * 1024 ** 2;

/** Group name for a path relative to the site root ('/' separated). */
export function groupOf(rel) {
  if (rel.startsWith('app/')) return 'app';
  if (rel.startsWith('assets/models/')) return 'models';
  if (rel.startsWith('assets/audio/')) return 'audio';
  return 'other';
}

/** Walks `dir`: total bytes, file count, bytes per group and the largest files (biggest first). */
export function siteReport(dir, top = 5) {
  const files = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(a, r);
      else if (entry.isFile()) files.push({ path: r, bytes: statSync(a).size });
    }
  };
  walk(dir, '');
  const groups = { app: 0, models: 0, audio: 0, other: 0 };
  let total = 0;
  for (const f of files) {
    groups[groupOf(f.path)] += f.bytes;
    total += f.bytes;
  }
  const largest = [...files].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, top);
  return { total, files: files.length, groups, largest };
}

/** Problems that would break the deploy (empty = fine). */
export function checkSite(report, limits = {}) {
  const site = limits.site ?? SITE_LIMIT_BYTES;
  const file = limits.file ?? FILE_LIMIT_BYTES;
  const problems = [];
  if (report.files === 0) problems.push('the site folder is empty');
  if (report.total > site) problems.push(`site is ${mb(report.total)}, over the ${mb(site)} limit`);
  for (const f of report.largest) if (f.bytes > file) problems.push(`${f.path} is ${mb(f.bytes)}, over the ${mb(file)} per-file limit`);
  return problems;
}

export const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/** Budget for the JS + CSS the title screen needs (gzip), A128. */
export const FIRST_LOAD_LIMIT_GZ = 1024 ** 2;
/** Vite manifest keys main.tsx loads before the title screen shows (entry, web start-up, App shell). */
export const START_MODULES = ['index.html', 'webEdition.ts', 'ui/App.tsx'];
/** Chunks loaded later, on demand: what each screen adds on top of the first load. */
export const LAZY_GROUPS = {
  creator: ['ui/creator/Creator.tsx'],
  game: ['ui/game/GameScreen.tsx'],
  'game host': ['../host/inPage.ts'],
  '3D': ['three/CharacterPreview.tsx', 'three/BattleMap3D.tsx'],
};

/** Output files (JS + CSS) of the given manifest keys and everything they import statically. */
export function manifestClosure(manifest, keys) {
  const files = new Set();
  const seen = new Set();
  const visit = (key) => {
    const m = manifest[key];
    if (!m || seen.has(key)) return;
    seen.add(key);
    files.add(m.file);
    for (const css of m.css ?? []) files.add(css);
    for (const imp of m.imports ?? []) visit(imp);
  };
  for (const k of keys) visit(k);
  return files;
}

/**
 * First-load and per-screen code sizes of a web build (raw + gzip), from Vite's manifest
 * (dist-web/.vite/manifest.json). `gzipSize(file)` measures one output file (injectable for tests).
 */
export function loadReport(manifest, gzipSize) {
  const size = (files) => {
    let bytes = 0;
    let gzip = 0;
    for (const f of files) {
      const s = gzipSize(f);
      bytes += s.bytes;
      gzip += s.gzip;
    }
    return { files: files.size, bytes, gzip };
  };
  const first = manifestClosure(manifest, START_MODULES);
  const lazy = {};
  for (const [name, keys] of Object.entries(LAZY_GROUPS)) {
    const extra = new Set([...manifestClosure(manifest, keys)].filter((f) => !first.has(f)));
    lazy[name] = size(extra);
  }
  return { firstLoad: size(first), lazy };
}

/** Problems with the load budget (empty = fine). */
export function checkLoad(report, limitGz = FIRST_LOAD_LIMIT_GZ) {
  const problems = [];
  if (report.firstLoad.files === 0) problems.push('no start-up chunks found in the Vite manifest');
  if (report.firstLoad.gzip > limitGz) problems.push(`title screen loads ${kb(report.firstLoad.gzip)} gzip of code, over the ${kb(limitGz)} budget`);
  return problems;
}

/** Build-log lines for the load report. */
export function formatLoad(report) {
  const f = report.firstLoad;
  return [
    `Title screen code: ${kb(f.gzip)} gzip (${kb(f.bytes)} raw, ${f.files} files; budget ${kb(FIRST_LOAD_LIMIT_GZ)} gzip)`,
    `  loaded later: ${Object.entries(report.lazy)
      .map(([name, s]) => `${name} +${kb(s.gzip)} gzip`)
      .join(', ')}`,
  ];
}

/** Human-readable report lines for the build log. */
export function formatReport(report) {
  const g = report.groups;
  return [
    `Web edition size: ${mb(report.total)} in ${report.files} files`,
    `  app code ${mb(g.app)}, models ${mb(g.models)}, audio ${mb(g.audio)}, other ${mb(g.other)}`,
    `  largest: ${report.largest.map((f) => `${f.path} (${mb(f.bytes)})`).join(', ')}`,
  ];
}
