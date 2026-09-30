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

/** Human-readable report lines for the build log. */
export function formatReport(report) {
  const g = report.groups;
  return [
    `Web edition size: ${mb(report.total)} in ${report.files} files`,
    `  app code ${mb(g.app)}, models ${mb(g.models)}, audio ${mb(g.audio)}, other ${mb(g.other)}`,
    `  largest: ${report.largest.map((f) => `${f.path} (${mb(f.bytes)})`).join(', ')}`,
  ];
}
