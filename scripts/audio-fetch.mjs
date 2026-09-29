#!/usr/bin/env node
/**
 * audio-fetch.mjs — downloads the CC0 music, ambience and SFX listed in assets/audio-manifest.json.
 *
 * Packs come from their official distribution points (kenney.nl zips, OpenGameArt.org
 * file attachments). Downloads are cached in assets/_audio_packs/<packId>/, zips are
 * extracted there with `tar -xf` (bsdtar ships with Windows 10+; `unzip` is used as a
 * fallback elsewhere), and the chosen files are copied to assets/audio/<target>
 * (music/, ambience/, sfx/) under stable names. Both folders are gitignored; only the
 * manifest is committed.
 *
 * - Idempotent: cached downloads that match the recorded size/sha256 are reused, and
 *   targets that are already identical are not rewritten.
 * - Verified: each download (zip or single file) and each copied file is checked
 *   against the manifest's `bytes` and `sha256`.
 *
 * Usage:
 *   node scripts/audio-fetch.mjs                 fetch everything
 *   node scripts/audio-fetch.mjs --only <packId> fetch one pack (repeatable)
 *   node scripts/audio-fetch.mjs --dry-run       list what would be fetched
 *   node scripts/audio-fetch.mjs --force         re-download and re-extract even if cached
 *   node scripts/audio-fetch.mjs --write-hashes  record bytes + sha256 of downloads into the manifest
 *
 * Plain Node ESM (Node >= 20), no dependencies.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'assets', 'audio-manifest.json');
const PACKS_DIR = path.join(ROOT, 'assets', '_audio_packs');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');
const CONCURRENCY = 4;
const RETRIES = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; solo-dnd-audio-fetch/1.0; +CC0 asset setup)';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const only = args.flatMap((a, i) => (a === '--only' && args[i + 1] ? [args[i + 1]] : []));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const WRITE_HASHES = flag('--write-hashes');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const splitPath = (p) => p.split('/');

function verify(buf, rec) {
  if (rec.bytes !== undefined && buf.length !== rec.bytes) return `size ${buf.length} != expected ${rec.bytes}`;
  if (rec.sha256 && sha256(buf) !== rec.sha256) return 'sha256 mismatch';
  return null;
}

async function download(url) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`${url}: ${lastErr?.message ?? lastErr}`);
}

/** Return a verified cached copy, or download + verify + cache. `rec` holds bytes/sha256. */
async function fetchCached(url, cache, rec) {
  if (!FORCE && existsSync(cache)) {
    const existing = await readFile(cache);
    if (!verify(existing, rec)) return { buf: existing, action: 'cached' };
  }
  const buf = await download(url);
  const problem = verify(buf, rec);
  if (problem) throw new Error(`${path.basename(cache)}: ${problem}`);
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache + '.part', buf);
  await rename(cache + '.part', cache);
  return { buf, action: 'downloaded' };
}

/** Extract a zip with the platform's tar (bsdtar on Windows) or unzip. */
function extractZip(zip, dest) {
  const winTar = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : null;
  const attempts = [
    ...(process.platform === 'win32' && winTar && existsSync(winTar) ? [[winTar, ['-xf', zip, '-C', dest]]] : []),
    ['tar', ['-xf', zip, '-C', dest]],
    ['unzip', ['-o', '-q', zip, '-d', dest]],
  ];
  const errors = [];
  for (const [cmd, argv] of attempts) {
    const r = spawnSync(cmd, argv, { stdio: 'pipe', windowsHide: true });
    if (r.status === 0) return;
    errors.push(`${path.basename(cmd)}: ${r.error?.message ?? String(r.stderr).trim().split('\n')[0]}`);
  }
  throw new Error(`could not extract ${path.basename(zip)} (${errors.join('; ')})`);
}

/** Copy `src` to assets/audio/<target> unless an identical file is already there. */
async function place(buf, target) {
  const dest = path.join(AUDIO_DIR, ...splitPath(target));
  if (existsSync(dest) && sha256(await readFile(dest)) === sha256(buf)) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
}

async function runPool(tasks, n) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]().catch((err) => ({ status: 'failed', note: String(err?.message ?? err) }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}

/** Zip pack: fetch the archive once, extract, then copy each listed file. */
async function processZipPack(pack) {
  const dir = path.join(PACKS_DIR, pack.id);
  const zipPath = path.join(dir, path.basename(new URL(pack.download.url).pathname));
  const { buf: zipBuf, action } = await fetchCached(pack.download.url, zipPath, pack.download);
  const extracted = path.join(dir, 'extracted');
  const marker = path.join(extracted, '.sha256');
  const zipSha = sha256(zipBuf);
  const fresh = existsSync(marker) && (await readFile(marker, 'utf8')).trim() === zipSha;
  if (FORCE || action === 'downloaded' || !fresh) {
    await rm(extracted, { recursive: true, force: true });
    await mkdir(extracted, { recursive: true });
    extractZip(zipPath, extracted);
    await writeFile(marker, zipSha);
  }
  const results = [];
  for (const f of pack.files) {
    const src = path.join(extracted, ...splitPath(f.from));
    if (!existsSync(src)) { results.push({ status: 'failed', note: `${f.from} not found in zip` }); continue; }
    const buf = await readFile(src);
    const problem = verify(buf, f);
    if (problem) { results.push({ status: 'failed', note: `${f.from}: ${problem}` }); continue; }
    await place(buf, f.target);
    results.push({ status: action, bytes: buf.length, sha: sha256(buf) });
  }
  return { zip: { bytes: zipBuf.length, sha: zipSha }, results };
}

/** File pack: each file has its own url. */
async function processFilePack(pack) {
  const tasks = pack.files.map((f) => async () => {
    const cache = path.join(PACKS_DIR, pack.id, path.basename(f.from));
    const { buf, action } = await fetchCached(f.url, cache, f);
    await place(buf, f.target);
    return { status: action, bytes: buf.length, sha: sha256(buf) };
  });
  return { results: await runPool(tasks, CONCURRENCY) };
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const packs = manifest.packs.filter((p) => only.length === 0 || only.includes(p.id));
  if (packs.length === 0) {
    console.error(`No packs match --only ${only.join(', ')}. Known: ${manifest.packs.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`Audio setup: ${packs.length} pack(s) -> ${path.relative(ROOT, AUDIO_DIR)}`);
  let totalDownload = 0;
  let totalPlaced = 0;
  let failures = 0;
  let hashesChanged = false;

  const packTasks = packs.map((pack) => async () => {
    if (DRY) return { pack, dry: true };
    try {
      const out = pack.download.archive === 'zip' ? await processZipPack(pack) : await processFilePack(pack);
      return { pack, ...out };
    } catch (err) {
      return { pack, error: String(err?.message ?? err) };
    }
  });
  const outcomes = await runPool(packTasks, CONCURRENCY);

  for (const o of outcomes) {
    const { pack } = o;
    console.log(`\n== ${pack.name} (${pack.author}) — ${pack.license}`);
    if (o.dry) {
      if (pack.download.archive === 'zip') console.log(`   zip ${pack.download.url}`);
      for (const f of pack.files) console.log(`   ${f.target}  <-  ${f.url ?? f.from}`);
      continue;
    }
    if (o.error) {
      failures += pack.files.length;
      console.log(`   ! FAILED: ${o.error}`);
      console.log(`     Retry later, or download it manually from ${pack.url}`);
      continue;
    }
    const counts = { downloaded: 0, cached: 0, failed: 0 };
    let placed = 0;
    o.results.forEach((r, i) => {
      const f = pack.files[i];
      counts[r.status]++;
      if (r.status === 'failed') console.log(`   ! ${f.target}: ${r.note}`);
      if (r.bytes) placed += r.bytes;
      if (WRITE_HASHES && r.sha && (f.sha256 !== r.sha || f.bytes !== r.bytes)) {
        f.sha256 = r.sha;
        f.bytes = r.bytes;
        hashesChanged = true;
      }
    });
    let dl = placed;
    if (o.zip) {
      dl = o.zip.bytes;
      if (WRITE_HASHES && (pack.download.sha256 !== o.zip.sha || pack.download.bytes !== o.zip.bytes)) {
        pack.download.sha256 = o.zip.sha;
        pack.download.bytes = o.zip.bytes;
        hashesChanged = true;
      }
    }
    totalDownload += dl;
    totalPlaced += placed;
    failures += counts.failed;
    const fresh = pack.download.archive === 'zip' ? (counts.downloaded ? 'zip downloaded' : 'zip cached') : `${counts.downloaded} downloaded, ${counts.cached} cached`;
    console.log(`   ${pack.files.length - counts.failed}/${pack.files.length} files placed; ${fresh}` +
      (counts.failed ? `, ${counts.failed} FAILED` : '') + ` (download ${mb(dl)})`);
  }

  if (WRITE_HASHES && hashesChanged) {
    for (const p of manifest.packs) {
      if (p.download.archive !== 'zip') p.download.bytes = p.files.reduce((n, f) => n + (f.bytes ?? 0), 0);
    }
    manifest.totals = {
      packs: manifest.packs.length,
      files: manifest.packs.reduce((n, p) => n + p.files.length, 0),
      downloadBytes: manifest.packs.reduce((n, p) => n + (p.download.bytes ?? 0), 0),
      installedBytes: manifest.packs.reduce((n, p) => n + p.files.reduce((m, f) => m + (f.bytes ?? 0), 0), 0),
    };
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('\nRecorded sizes + sha256 hashes in assets/audio-manifest.json');
  }

  if (DRY) return;
  console.log(`\nDone: downloaded/cached ${mb(totalDownload)}; ${mb(totalPlaced)} of audio in ${path.relative(ROOT, AUDIO_DIR)}.`);
  if (failures) {
    console.log(`${failures} file(s) failed. Re-run this script to retry; the game plays silently where audio is missing.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Audio fetch failed:', err?.message ?? err);
  process.exit(1);
});
