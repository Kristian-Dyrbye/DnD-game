#!/usr/bin/env node
/**
 * voices-fetch.mjs — installs offline TTS: the Piper Windows binary and the voices listed
 * in assets/voices-manifest.json.
 *
 * - Piper: the official rhasspy/piper release zip is cached in tools/_downloads/ and
 *   extracted into tools/ (the zip holds a top-level `piper/` folder, so the result is
 *   tools/piper/piper.exe). Extraction uses Windows' bundled bsdtar (`tar -xf`), falling
 *   back to `tar`/`unzip` elsewhere. A `.sha256` marker makes re-extraction idempotent.
 * - Voices: each `<id>.onnx` + `<id>.onnx.json` is downloaded into assets/voices/.
 * - Verified: every file is checked against the manifest's bytes + sha256; existing
 *   files that already match are left alone (idempotent). Downloads stream to `.part`
 *   files and are renamed only after verification.
 *
 * Usage:
 *   node scripts/voices-fetch.mjs                 install Piper + all voices
 *   node scripts/voices-fetch.mjs --only piper    only the binary (repeatable; or a voice id)
 *   node scripts/voices-fetch.mjs --dry-run       list what would be fetched
 *   node scripts/voices-fetch.mjs --force         re-download and re-extract even if present
 *   node scripts/voices-fetch.mjs --write-hashes  record bytes + sha256 into the manifest
 *   node scripts/voices-fetch.mjs --test          synthesize a test sentence with the narrator
 *                                                 voice into tools/_downloads/test.wav (Windows)
 *
 * Plain Node ESM (Node >= 20), no dependencies.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'assets', 'voices-manifest.json');
const TOOLS_DIR = path.join(ROOT, 'tools');
const DOWNLOADS = path.join(TOOLS_DIR, '_downloads');
const PIPER_DIR = path.join(TOOLS_DIR, 'piper');
const VOICE_DIR = path.join(ROOT, 'assets', 'voices');
const RETRIES = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; solo-dnd-voices-fetch/1.0)';
const TEST_SENTENCE = 'Welcome, traveller. The road to Aurelmark is long, and the night is full of wolves.';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const only = args.flatMap((a, i) => (a === '--only' && args[i + 1] ? [args[i + 1]] : []));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const WRITE_HASHES = flag('--write-hashes');
const TEST = flag('--test');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const rel = (p) => path.relative(ROOT, p);

async function hashFile(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/** Returns null when `file` matches rec {bytes, sha256}; otherwise the reason. */
async function checkFile(file, bytes, sha) {
  if (!existsSync(file)) return 'missing';
  const { size } = await stat(file);
  if (bytes !== undefined && size !== bytes) return `size ${size} != expected ${bytes}`;
  const actual = await hashFile(file);
  if (sha && actual !== sha) return 'sha256 mismatch';
  return null;
}

/** Stream `url` to `dest` (via .part) with a progress line; verify before renaming. */
async function download(url, dest, bytes, sha, label) {
  await mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || bytes || 0;
      let got = 0;
      let lastPct = -10;
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => {
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (process.stdout.isTTY && total && pct >= lastPct + 5) {
          lastPct = pct;
          process.stdout.write(`\r   ${label}: ${pct}% of ${mb(total)}   `);
        }
      });
      await pipeline(body, createWriteStream(part));
      if (process.stdout.isTTY && total) process.stdout.write('\r' + ' '.repeat(60) + '\r');
      const problem = await checkFile(part, bytes, sha);
      if (problem) throw new Error(problem);
      await rename(part, dest);
      return;
    } catch (err) {
      lastErr = err;
      await rm(part, { force: true });
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`${label}: ${lastErr?.message ?? lastErr} (${url})`);
}

/** Ensure `dest` matches bytes/sha256; download when missing, stale or --force. */
async function ensure(url, dest, bytes, sha, label) {
  if (!FORCE && !(await checkFile(dest, bytes, sha))) return 'present';
  await download(url, dest, bytes, sha, label);
  return 'downloaded';
}

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

async function installPiper(piper) {
  const zip = path.join(DOWNLOADS, path.basename(new URL(piper.url).pathname));
  const action = await ensure(piper.url, zip, piper.bytes, piper.sha256 || undefined, 'piper zip');
  const sha = await hashFile(zip);
  const marker = path.join(PIPER_DIR, '.zip-sha256');
  const exe = path.join(TOOLS_DIR, ...piper.exe.split('/'));
  const fresh = existsSync(exe) && existsSync(marker) && (await readFile(marker, 'utf8')).trim() === sha;
  let extracted = false;
  if (FORCE || !fresh) {
    await rm(PIPER_DIR, { recursive: true, force: true });
    await mkdir(TOOLS_DIR, { recursive: true });
    extractZip(zip, TOOLS_DIR);
    if (!existsSync(exe)) throw new Error(`${piper.exe} not found after extracting ${path.basename(zip)}`);
    await writeFile(marker, sha);
    extracted = true;
  }
  return { action, extracted, bytes: (await stat(zip)).size, sha, exe };
}

async function installVoice(v) {
  const onnx = path.join(VOICE_DIR, `${v.id}.onnx`);
  const json = `${onnx}.json`;
  const a1 = await ensure(v.url, onnx, v.bytes, v.sha256 || undefined, `${v.id}.onnx`);
  const a2 = await ensure(v.configUrl, json, v.configBytes, v.configSha256 || undefined, `${v.id}.onnx.json`);
  return {
    action: a1 === 'downloaded' || a2 === 'downloaded' ? 'downloaded' : 'present',
    bytes: (await stat(onnx)).size, sha: await hashFile(onnx),
    configBytes: (await stat(json)).size, configSha: await hashFile(json),
  };
}

/** Run piper.exe once with the narrator voice; report time and output size. */
async function testSynthesis(manifest) {
  if (process.platform !== 'win32') {
    console.log('\n--test: skipped (the pinned Piper binary is the Windows build).');
    return true;
  }
  const exe = path.join(TOOLS_DIR, ...manifest.piper.exe.split('/'));
  const narrator = manifest.voices.find((v) => v.role === 'narrator');
  const model = path.join(VOICE_DIR, `${narrator.id}.onnx`);
  const out = path.join(DOWNLOADS, 'test.wav');
  if (!existsSync(exe) || !existsSync(model)) {
    console.log(`\n--test: FAILED — ${!existsSync(exe) ? rel(exe) : rel(model)} is missing; run without --test first.`);
    return false;
  }
  await mkdir(DOWNLOADS, { recursive: true });
  await rm(out, { force: true });
  console.log(`\n--test: synthesizing with ${narrator.id} -> ${rel(out)}`);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(exe, ['--model', model, '--output_file', out], { windowsHide: true, cwd: path.dirname(exe) });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { stderr += String(err); resolve(-1); });
    child.on('close', (c) => {
      if (c !== 0) console.log(stderr.trim().split('\n').slice(-5).join('\n'));
      resolve(c);
    });
    child.stdin.end(TEST_SENTENCE + '\n');
  });
  const ms = Date.now() - started;
  if (code !== 0 || !existsSync(out)) {
    console.log(`--test: FAILED (exit ${code}).`);
    return false;
  }
  const size = (await stat(out)).size;
  const cfg = JSON.parse(await readFile(`${model}.json`, 'utf8'));
  const rate = cfg.audio?.sample_rate ?? 22050;
  const seconds = Math.max(0, size - 44) / 2 / rate;
  console.log(`--test: OK — ${seconds.toFixed(1)} s of audio (${(size / 1024).toFixed(0)} KB) in ${(ms / 1000).toFixed(1)} s wall time.`);
  return true;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const known = ['piper', ...manifest.voices.map((v) => v.id)];
  const unknown = only.filter((o) => !known.includes(o));
  if (unknown.length) {
    console.error(`Unknown --only ${unknown.join(', ')}. Known: ${known.join(', ')}`);
    process.exit(1);
  }
  const want = (id) => only.length === 0 || only.includes(id);
  const voices = manifest.voices.filter((v) => want(v.id));

  if (TEST && args.every((a) => a === '--test')) {
    process.exitCode = (await testSynthesis(manifest)) ? 0 : 1;
    return;
  }

  console.log(`Voice setup: Piper ${manifest.piper.version} -> ${rel(PIPER_DIR)}, ${voices.length} voice(s) -> ${rel(VOICE_DIR)}`);
  if (DRY) {
    if (want('piper')) console.log(`   piper   ${manifest.piper.url} (${mb(manifest.piper.bytes)}, ${manifest.piper.license})`);
    for (const v of voices) console.log(`   ${v.role.padEnd(10)} ${v.id}  ${v.url} (${mb(v.bytes)}, ${v.license})`);
    return;
  }

  let failures = 0;
  let changed = false;
  if (want('piper')) {
    try {
      const r = await installPiper(manifest.piper);
      console.log(`   piper: ${r.action === 'downloaded' ? 'downloaded' : 'cached'} zip (${mb(r.bytes)})` +
        `${r.extracted ? ', extracted' : ', already extracted'} -> ${rel(r.exe)}`);
      if (WRITE_HASHES && (manifest.piper.sha256 !== r.sha || manifest.piper.bytes !== r.bytes)) {
        Object.assign(manifest.piper, { sha256: r.sha, bytes: r.bytes });
        changed = true;
      }
    } catch (err) {
      failures++;
      console.log(`   ! piper FAILED: ${err?.message ?? err}`);
      console.log(`     Retry later, or download it manually from ${manifest.piper.releasePage}`);
    }
  }
  for (const v of voices) {
    try {
      const r = await installVoice(v);
      console.log(`   ${v.role.padEnd(10)} ${v.id}: ${r.action} (${mb(r.bytes)})`);
      if (WRITE_HASHES && (v.sha256 !== r.sha || v.bytes !== r.bytes || v.configSha256 !== r.configSha || v.configBytes !== r.configBytes)) {
        Object.assign(v, { sha256: r.sha, bytes: r.bytes, configSha256: r.configSha, configBytes: r.configBytes });
        changed = true;
      }
    } catch (err) {
      failures++;
      console.log(`   ! ${v.id} FAILED: ${err?.message ?? err}`);
    }
  }
  if (WRITE_HASHES && changed) {
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('Recorded sizes + sha256 hashes in assets/voices-manifest.json');
  }
  if (failures) {
    console.log(`${failures} item(s) failed. Re-run this script to retry; the game works without voice (TTS off).`);
    process.exitCode = 1;
  } else {
    console.log('Done: Piper TTS is ready.');
  }
  if (TEST && !(await testSynthesis(manifest))) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Voice fetch failed:', err?.message ?? err);
  process.exit(1);
});
