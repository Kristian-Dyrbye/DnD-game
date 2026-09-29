/**
 * LLM benchmark (A010): runs the game's two kinds of calls — streamed narration and JSON intent
 * parsing — against candidate Ollama models and reports JSON validity, sensible intents, tokens per
 * second, time to first token and resident memory. Writes userdata/bench-llm.json and prints a table
 * with the recommended default.
 *
 *   node scripts/bench-llm.mjs                      # default candidates (pulled ones only)
 *   node scripts/bench-llm.mjs qwen3:4b phi4-mini   # specific models
 *   node scripts/bench-llm.mjs --pull               # pull missing candidates first
 *
 * Needs Ollama running on http://127.0.0.1:11434 (Start Game.bat starts it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { INTENT_SCHEMA, INTENT_TASKS, NARRATION_TASKS, parseIntentReply, pickBest, scoreModel } from './bench-llm-lib.mjs';

const BASE = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const DEFAULT_CANDIDATES = ['qwen3:4b', 'llama3.2:3b', 'gemma3:4b', 'phi4-mini'];
const args = process.argv.slice(2);
const pull = args.includes('--pull');
const wanted = args.filter((a) => !a.startsWith('--'));

async function api(p, body) {
  const res = await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res;
}

const thinkFlag = (model) => (/^qwen3|deepseek-r1/.test(model) ? { think: false } : {});

async function chatStream(model, messages) {
  const t0 = performance.now();
  const res = await api('/api/chat', { model, messages, stream: true, ...thinkFlag(model), options: { temperature: 0.8, num_ctx: 4096, num_predict: 300 } });
  let first = 0;
  let evalCount = 0;
  let evalNs = 0;
  let text = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.message?.content) {
        if (!first) first = performance.now() - t0;
        text += j.message.content;
      }
      if (j.done) {
        evalCount = j.eval_count ?? 0;
        evalNs = j.eval_duration ?? 0;
      }
    }
  }
  return { firstMs: first, tokensPerSecond: evalNs ? evalCount / (evalNs / 1e9) : 0, text };
}

async function chatJson(model, messages) {
  const res = await api('/api/chat', { model, messages, stream: false, format: INTENT_SCHEMA, ...thinkFlag(model), options: { temperature: 0.1, num_ctx: 4096, num_predict: 120 } });
  const j = await res.json();
  return j.message?.content ?? '';
}

async function memoryOf(model) {
  try {
    const ps = await (await api('/api/ps')).json();
    const m = (ps.models ?? []).find((x) => x.name === model || x.model === model);
    return m ? Math.round((m.size_vram || m.size || 0) / 1048576) : undefined;
  } catch {
    return undefined;
  }
}

async function benchModel(model) {
  const r = { model, jsonValid: 0, jsonTotal: 0, intentSensible: 0, tokensPerSecond: 0, firstTokenMs: 0 };
  try {
    await chatStream(model, [{ role: 'user', content: 'Say ready.' }]); // load the model (not timed)
    const narr = [];
    for (const t of NARRATION_TASKS) narr.push(await chatStream(model, t.messages));
    r.tokensPerSecond = Math.round((narr.reduce((s, n) => s + n.tokensPerSecond, 0) / narr.length) * 10) / 10;
    r.firstTokenMs = Math.round(narr.reduce((s, n) => s + n.firstMs, 0) / narr.length);
    r.sample = narr[0].text.slice(0, 300);
    for (const t of INTENT_TASKS) {
      r.jsonTotal++;
      const action = parseIntentReply(await chatJson(model, t.messages));
      if (action) r.jsonValid++;
      if (action && t.expect.includes(action)) r.intentSensible++;
    }
    r.memoryMB = await memoryOf(model);
  } catch (err) {
    r.error = err.message;
  }
  r.score = scoreModel(r);
  return r;
}

async function main() {
  let installed;
  try {
    installed = ((await (await api('/api/tags')).json()).models ?? []).map((m) => m.name);
  } catch {
    console.error(`Ollama is not reachable at ${BASE}. Start it (Start Game.bat) and try again.`);
    process.exit(1);
  }
  const candidates = wanted.length ? wanted : DEFAULT_CANDIDATES;
  if (pull) for (const m of candidates.filter((c) => !installed.includes(c))) {
    console.log(`Pulling ${m}…`);
    await api('/api/pull', { name: m, stream: false });
    installed.push(m);
  }
  const toRun = candidates.filter((c) => installed.includes(c) || installed.includes(`${c}:latest`));
  if (!toRun.length) {
    console.error(`None of ${candidates.join(', ')} is installed. Pull one (ollama pull qwen3:4b) or use --pull.`);
    process.exit(1);
  }
  const results = [];
  for (const m of toRun) {
    process.stdout.write(`Benchmarking ${m}… `);
    const r = await benchModel(m);
    results.push(r);
    console.log(r.error ? `error: ${r.error}` : `score ${r.score}`);
  }
  console.log('\nmodel               score  json   sensible  tok/s  first-token  memory');
  for (const r of results) console.log(`${r.model.padEnd(20)}${String(r.score).padStart(5)}  ${r.jsonValid}/${r.jsonTotal}    ${String(r.intentSensible).padStart(2)}/${r.jsonTotal}    ${String(r.tokensPerSecond).padStart(5)}  ${String(r.firstTokenMs).padStart(8)} ms  ${r.memoryMB ?? '?'} MB`);
  const best = pickBest(results);
  if (best) console.log(`\nRecommended default: ${best.model}. Set it in Settings → AI (or keep the current one if it's close).`);
  const out = path.join(process.cwd(), 'userdata', 'bench-llm.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results, recommended: best?.model }, null, 2));
  console.log(`Results written to ${out}`);
}

main();
