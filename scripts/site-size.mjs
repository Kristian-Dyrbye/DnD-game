#!/usr/bin/env node
/**
 * site-size.mjs — prints the size of the built web edition and fails if it breaks a GitHub Pages limit
 * (site < 1 GB, files < 100 MB). Run after `npm run build:web`; the Pages workflow runs it before upload.
 *
 * Usage: node scripts/site-size.mjs [dir]   (default dist-web)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite, formatReport, siteReport } from './site-size-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(ROOT, process.argv[2] ?? 'dist-web');

if (!existsSync(dir)) {
  console.error(`${path.relative(ROOT, dir)} not found: run npm run build:web first.`);
  process.exit(1);
}
const report = siteReport(dir);
for (const line of formatReport(report)) console.log(line);
const problems = checkSite(report);
for (const p of problems) console.error(`! ${p}`);
if (problems.length) process.exit(1);
