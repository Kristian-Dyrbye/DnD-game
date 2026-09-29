/**
 * Pure helpers for scripts/check-deps.mjs. Plain JavaScript (no TypeScript, no dependencies)
 * because it runs before `npm install`. Tested by tests/check-deps.test.ts.
 */

export const MIN_NODE_MAJOR = 20;
export const GAME_PORT = 3210;
export const OLLAMA_URL = 'http://127.0.0.1:11434';
/** Keep in sync with src/shared/settings.ts (a test checks this). */
export const DEFAULT_MODEL = 'qwen3:4b';

/** "v22.4.1" → 22 */
export function nodeMajor(version) {
  const m = /^v?(\d+)/.exec(String(version));
  return m ? Number(m[1]) : 0;
}

export function nodeIsSupported(version) {
  return nodeMajor(version) >= MIN_NODE_MAJOR;
}

/** Model from userdata/settings.json text, or the default if missing/invalid. */
export function configuredModel(settingsText) {
  try {
    const model = JSON.parse(settingsText)?.llm?.model;
    return typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** True if `model` is in the /api/tags response. "llama3.2" matches "llama3.2:latest". */
export function modelInstalled(tagsJson, model) {
  const norm = (s) => (s.includes(':') ? s : `${s}:latest`);
  const names = (tagsJson?.models ?? []).map((m) => norm(String(m.name)));
  return names.includes(norm(model));
}

/** One line of console output with a status symbol (plain ASCII so every Windows console shows it). */
export function line(status, text) {
  const tag = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[ .. ]' }[status] ?? '[    ]';
  return `${tag} ${text}`;
}

/**
 * What the launcher should do, given the checks.
 * @returns {{ exitCode: number, messages: string[] }}
 */
export function startDecision(c) {
  const messages = [];
  if (!c.nodeOk) {
    return { exitCode: 1, messages: [line('fail', `Node.js ${MIN_NODE_MAJOR}+ is required (found ${c.nodeVersion}). Install it from https://nodejs.org`)] };
  }
  if (c.gameAlreadyRunning) {
    return { exitCode: 3, messages: [line('info', 'The game is already running. Opening it in your browser.')] };
  }
  if (!c.depsInstalled) {
    return { exitCode: 1, messages: [line('fail', 'Game files are not installed yet. Please run Setup.bat first.')] };
  }
  messages.push(line('ok', `Node.js ${c.nodeVersion}`));
  if (!c.ollamaInstalled) {
    messages.push(line('warn', 'Ollama is not installed. The game will use simple template narration. Run Setup.bat to add the AI Dungeon Master.'));
  } else if (!c.ollamaRunning) {
    messages.push(line('warn', 'Ollama is installed but not running. Starting it...'));
  } else if (!c.modelInstalled) {
    messages.push(line('warn', `AI model ${c.model} is not downloaded. Run Setup.bat (the game falls back to template narration).`));
  } else {
    messages.push(line('ok', `AI Dungeon Master ready (${c.model})`));
  }
  return { exitCode: 0, messages };
}
