#!/usr/bin/env node
/**
 * site-size.mjs — prints the size of the built web edition and fails if it breaks a GitHub Pages limit
 * (site < 1 GB, files < 100 MB) or the title screen's code budget (< 1 MB gzip, from Vite's manifest).
 * Run after `npm run build:web`; the Pages workflow runs it before upload.
 *
 * Usage: node scripts/site-size.mjs [dir]   (default dist-web)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { checkLoad, checkSite, formatLoad, formatReport, loadReport, siteReport } from './site-size-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(ROOT, process.argv[2] ?? 'dist-web');

if (!existsSync(dir)) {
  console.error(`${path.relative(ROOT, dir)} not found: run npm run build:web first.`);
  process.exit(1);
}
const report = siteReport(dir);
for (const line of formatReport(report)) console.log(line);
const problems = checkSite(report);

const manifestFile = path.join(dir, '.vite', 'manifest.json');
if (existsSync(manifestFile)) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const load = loadReport(manifest, (file) => {
    const buf = readFileSync(path.join(dir, file));
    return { bytes: buf.length, gzip: gzipSync(buf).length };
  });
  for (const line of formatLoad(load)) console.log(line);
  problems.push(...checkLoad(load));
} else {
  problems.push('.vite/manifest.json missing: the load report needs `build.manifest` (vite.config.ts, web mode)');
}

for (const p of problems) console.error(`! ${p}`);
if (problems.length) process.exit(1);
