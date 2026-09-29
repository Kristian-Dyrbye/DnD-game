/**
 * Dependency checker used by the Windows launchers.
 *   node scripts/check-deps.mjs --start   (Start Game.bat) quick checks, starts Ollama if needed
 *   node scripts/check-deps.mjs --setup   (Setup.bat) installs packages, builds, installs Ollama, pulls the model
 * Options: --no-ollama-install  never offer to install Ollama (non-interactive runs)
 * Exit codes: 0 ok, 1 fatal problem, 3 game already running (launcher just opens the browser).
 * Plain JS with no dependencies: it must run before `npm install`.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MODEL,
  GAME_PORT,
  OLLAMA_URL,
  configuredModel,
  line,
  modelInstalled,
  nodeIsSupported,
  startDecision,
} from './check-deps-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === 'win32';

async function getJson(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function run(cmd, cmdArgs, opts = {}) {
  const shell = opts.shell ?? isWindows;
  // On Windows a shell is needed to find npm.cmd / winget on PATH; pass one quoted command string.
  const res = shell
    ? spawnSync([cmd, ...cmdArgs].map(quote).join(' '), { cwd: ROOT, stdio: 'inherit', shell: true })
    : spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
  return res.status === 0;
}

function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function findOllama() {
  const probe = spawnSync(isWindows ? 'where' : 'which', ['ollama'], { encoding: 'utf8' });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  // Fresh installs aren't on this console's PATH yet; check the default install folder.
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
  return local && fs.existsSync(local) ? local : null;
}

function readModel() {
  try {
    return configuredModel(fs.readFileSync(path.join(ROOT, 'userdata', 'settings.json'), 'utf8'));
  } catch {
    return DEFAULT_MODEL;
  }
}

async function ensureOllamaRunning(ollamaPath) {
  if (await getJson(`${OLLAMA_URL}/api/tags`)) return true;
  const child = spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await getJson(`${OLLAMA_URL}/api/tags`)) return true;
  }
  return false;
}

async function ask(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
  rl.close();
  return answer === '' || answer === 'y' || answer === 'yes';
}

async function start() {
  const model = readModel();
  const ollamaPath = findOllama();
  let tags = ollamaPath ? await getJson(`${OLLAMA_URL}/api/tags`) : null;
  const checks = {
    nodeVersion: process.version,
    nodeOk: nodeIsSupported(process.version),
    gameAlreadyRunning: Boolean(await getJson(`http://127.0.0.1:${GAME_PORT}/api/health`, 800)),
    depsInstalled: fs.existsSync(path.join(ROOT, 'node_modules', 'fastify')),
    ollamaInstalled: Boolean(ollamaPath),
    ollamaRunning: Boolean(tags),
    modelInstalled: modelInstalled(tags, model),
    model,
  };
  const decision = startDecision(checks);
  decision.messages.forEach((m) => console.log(m));
  if (decision.exitCode !== 0) return decision.exitCode;

  if (ollamaPath && !checks.ollamaRunning) {
    if (await ensureOllamaRunning(ollamaPath)) {
      tags = await getJson(`${OLLAMA_URL}/api/tags`);
      console.log(line('ok', 'Ollama started.'));
      if (!modelInstalled(tags, model)) console.log(line('warn', `AI model ${model} is not downloaded. Run Setup.bat.`));
    } else {
      console.log(line('warn', 'Could not start Ollama. The game will use template narration.'));
    }
  }

  if (!fs.existsSync(path.join(ROOT, 'dist', 'client', 'index.html'))) {
    console.log(line('info', 'Building the game (first run only)...'));
    if (!run('npm', ['run', 'build', '--silent'])) {
      console.log(line('fail', 'Build failed. Run Setup.bat again.'));
      return 1;
    }
  }
  return 0;
}

async function setup() {
  console.log('\n=== Solo D&D setup ===\n');
  if (!nodeIsSupported(process.version)) {
    console.log(line('fail', `Node.js 20+ is required (found ${process.version}). Install it from https://nodejs.org`));
    return 1;
  }
  console.log(line('ok', `Node.js ${process.version}`));

  console.log(line('info', 'Installing game packages (this can take a few minutes)...'));
  if (!run('npm', ['install', '--no-audit', '--no-fund'])) {
    console.log(line('fail', 'npm install failed. Check your internet connection and run Setup.bat again.'));
    return 1;
  }
  console.log(line('ok', 'Packages installed.'));

  console.log(line('info', 'Building the game...'));
  if (!run('npm', ['run', 'build', '--silent'])) {
    console.log(line('fail', 'Build failed.'));
    return 1;
  }
  console.log(line('ok', 'Game built.'));

  let ollamaPath = findOllama();
  if (!ollamaPath && !args.has('--no-ollama-install')) {
    const hasWinget = spawnSync('where', ['winget']).status === 0;
    if (hasWinget && (await ask('The AI Dungeon Master needs Ollama. Install it now?'))) {
      run('winget', ['install', '--id', 'Ollama.Ollama', '-e', '--accept-source-agreements', '--accept-package-agreements']);
      ollamaPath = findOllama();
    }
  }
  if (!ollamaPath) {
    console.log(line('warn', 'Ollama is not installed. Get it from https://ollama.com/download, then run Setup.bat again.'));
    console.log(line('info', 'You can still play: the game uses template narration without it.'));
  } else if (!(await ensureOllamaRunning(ollamaPath))) {
    console.log(line('warn', 'Ollama is installed but would not start. Restart your PC and run Setup.bat again.'));
  } else {
    const model = readModel();
    const tags = await getJson(`${OLLAMA_URL}/api/tags`);
    if (modelInstalled(tags, model)) {
      console.log(line('ok', `AI model ${model} is already downloaded.`));
    } else {
      console.log(line('info', `Downloading AI model ${model} (about 2.5 GB, one time only)...`));
      if (run(ollamaPath, ['pull', model], { shell: false })) console.log(line('ok', `AI model ${model} downloaded.`));
      else console.log(line('warn', `Could not download ${model}. Check your connection and run Setup.bat again.`));
    }
  }

  console.log(line('info', 'Downloading 3D models (about 50 MB, one time only)...'));
  if (run('node', [path.join('scripts', 'assets-fetch.mjs')], { shell: false })) console.log(line('ok', '3D models ready.'));
  else console.log(line('warn', 'Some 3D models could not be downloaded. The game will use simple shapes; run Setup.bat again later.'));

  // Narration voices (Piper) are added by a later build step.
  console.log('\nSetup finished. Start the game with "Start Game.bat".\n');
  return 0;
}

const mode = args.has('--setup') ? setup : start;
process.exitCode = await mode();
