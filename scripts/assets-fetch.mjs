#!/usr/bin/env node
/**
 * assets-fetch.mjs — downloads the CC0 3D model packs listed in assets/manifest.json.
 *
 * Every pack in the manifest is fetched file-by-file from its official source
 * (KayKit's GitHub repositories, Quaternius's own Poly Pizza uploads), cached in
 * assets/_packs/<packId>/ and copied to assets/models/<target>. Both folders are
 * gitignored; only the manifest is committed.
 *
 * - Idempotent: files already cached with the recorded size/sha256 are not re-downloaded.
 * - Verified: each download is checked against the manifest's `bytes` and `sha256`.
 * - Mirror: packs whose host refuses CI servers (Poly Pizza answers GitHub Actions with HTTP 403)
 *   have a committed CC0 copy in assets/mirror/<packId>/ (same layout as the cache); it is used
 *   instead of downloading when present and verified (`--force` ignores it).
 * - Manual packs (`download.manual: true`) are never scraped; the script prints the
 *   instructions and copies the files if the owner has placed them in assets/_packs/<packId>/.
 *
 * Usage:
 *   node scripts/assets-fetch.mjs                 fetch everything
 *   node scripts/assets-fetch.mjs --only <packId> fetch one pack (repeatable)
 *   node scripts/assets-fetch.mjs --dry-run       list what would be fetched
 *   node scripts/assets-fetch.mjs --force         re-download even if cached
 *   node scripts/assets-fetch.mjs --write-hashes  record bytes + sha256 of downloads into the manifest
 *
 * Plain Node ESM (Node >= 20), no dependencies.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'assets', 'manifest.json');
const PACKS_DIR = path.join(ROOT, 'assets', '_packs');
const MODELS_DIR = path.join(ROOT, 'assets', 'models');
const MIRROR_DIR = path.join(ROOT, 'assets', 'mirror');
const CONCURRENCY = 4;
const RETRIES = 3;
const USER_AGENT = 'solo-dnd-assets-fetch/1.0 (+CC0 asset setup)';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const only = args.flatMap((a, i) => (a === '--only' && args[i + 1] ? [args[i + 1]] : []));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const WRITE_HASHES = flag('--write-hashes');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Where a manifest file is cached inside assets/_packs/<packId>/. */
function cachePath(pack, file) {
  const rel = file.url ? path.basename(file.target) : file.from;
  return path.join(PACKS_DIR, pack.id, ...rel.split('/'));
}

/** Download URL for a manifest file (explicit url, else pack base url + path in pack). */
function sourceUrl(pack, file) {
  if (file.url) return file.url;
  return pack.download.url + file.from.split('/').map(encodeURIComponent).join('/');
}

function verify(buf, file) {
  if (file.bytes !== undefined && buf.length !== file.bytes) return `size ${buf.length} != expected ${file.bytes}`;
  if (file.sha256 && sha256(buf) !== file.sha256) return 'sha256 mismatch';
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
  throw lastErr;
}

/** Fetch (or reuse) one file, then copy it into assets/models. Returns a status record. */
async function processFile(pack, file) {
  const cache = cachePath(pack, file);
  const target = path.join(MODELS_DIR, ...file.target.split('/'));
  let buf = null;
  let action = 'cached';

  if (!FORCE && existsSync(cache)) {
    const existing = await readFile(cache);
    if (!verify(existing, file)) buf = existing;
  }
  // Committed CC0 copy (assets/mirror/<packId>/...) for hosts that refuse CI servers (Poly Pizza → HTTP 403).
  const mirror = path.join(MIRROR_DIR, path.relative(PACKS_DIR, cache));
  if (!buf && !FORCE && existsSync(mirror)) {
    const copy = await readFile(mirror);
    if (!verify(copy, file)) {
      buf = copy;
      await mkdir(path.dirname(cache), { recursive: true });
      await copyFile(mirror, cache);
      action = 'mirrored';
    }
  }
  if (!buf) {
    if (pack.download.manual) return { status: 'missing', file, note: `place it at ${path.relative(ROOT, cache)}` };
    buf = await download(sourceUrl(pack, file));
    const problem = verify(buf, file);
    if (problem) return { status: 'failed', file, note: problem };
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(cache + '.part', buf);
    await rename(cache + '.part', cache);
    action = 'downloaded';
  }

  await mkdir(path.dirname(target), { recursive: true });
  const same = existsSync(target) && (await stat(target)).size === buf.length && sha256(await readFile(target)) === sha256(buf);
  if (!same) await copyFile(cache, target);
  return { status: action, file, bytes: buf.length, sha: sha256(buf) };
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

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const packs = manifest.packs.filter((p) => only.length === 0 || only.includes(p.id));
  if (packs.length === 0) {
    console.error(`No packs match --only ${only.join(', ')}. Known: ${manifest.packs.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`3D asset setup: ${packs.length} pack(s) -> ${path.relative(ROOT, MODELS_DIR)}`);
  let totalBytes = 0;
  let failures = 0;
  let manualMissing = 0;
  let hashesChanged = false;

  for (const pack of packs) {
    console.log(`\n== ${pack.name} (${pack.author}) — ${pack.license}`);
    if (pack.download.manual) {
      console.log(`   Manual download required: ${pack.download.instructions ?? pack.url}`);
    }
    if (DRY) {
      for (const f of pack.files) console.log(`   ${f.target}  <-  ${sourceUrl(pack, f)}`);
      continue;
    }
    const results = await runPool(pack.files.map((f) => () => processFile(pack, f)), CONCURRENCY);
    const counts = { downloaded: 0, cached: 0, mirrored: 0, failed: 0, missing: 0 };
    let packBytes = 0;
    results.forEach((r, i) => {
      const f = pack.files[i];
      counts[r.status]++;
      if (r.bytes) packBytes += r.bytes;
      if (r.status === 'failed') console.log(`   ! ${f.target}: ${r.note}`);
      if (r.status === 'missing') manualMissing++;
      if (WRITE_HASHES && r.sha && (f.sha256 !== r.sha || f.bytes !== r.bytes)) {
        f.sha256 = r.sha;
        f.bytes = r.bytes;
        hashesChanged = true;
      }
    });
    totalBytes += packBytes;
    failures += counts.failed;
    console.log(
      `   ${counts.downloaded} downloaded, ${counts.cached} already cached` +
        (counts.mirrored ? `, ${counts.mirrored} from assets/mirror` : '') +
        (counts.missing ? `, ${counts.missing} awaiting manual download` : '') +
        (counts.failed ? `, ${counts.failed} FAILED` : '') +
        ` (${mb(packBytes)})`,
    );
  }

  if (WRITE_HASHES && hashesChanged) {
    for (const p of manifest.packs) p.download.bytes = p.files.reduce((n, f) => n + (f.bytes ?? 0), 0);
    manifest.totals = {
      files: manifest.packs.reduce((n, p) => n + p.files.length, 0),
      bytes: manifest.packs.reduce((n, p) => n + p.download.bytes, 0),
    };
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('\nRecorded sizes + sha256 hashes in assets/manifest.json');
  }

  if (DRY) return;
  console.log(`\nDone: ${mb(totalBytes)} of models in ${path.relative(ROOT, MODELS_DIR)}.`);
  if (manualMissing) console.log(`${manualMissing} file(s) need a manual download (see messages above).`);
  if (failures) {
    console.log(`${failures} file(s) failed. Re-run this script to retry; the game falls back to simple shapes for missing models.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Asset fetch failed:', err?.message ?? err);
  process.exit(1);
});
