/**
 * Live progress feed for run-loop.bat.
 * Reads `claude -p --output-format stream-json --verbose` from stdin, prints a compact
 * human-readable feed (tool calls, Claude's messages, errors, final summary) to the console,
 * and writes the same feed to <log>.log plus the raw events to <log>.jsonl.
 *
 * Usage: claude -p ... --output-format stream-json --verbose | node scripts/loop-watch.mjs logs\run_1
 *        node scripts/loop-watch.mjs --next      (prints the next queued assignment from brain.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', mag: '\x1b[35m', bold: '\x1b[1m', off: '\x1b[0m' };
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// --next: show which assignment the coming session will likely pick
if (process.argv[2] === '--next') {
  try {
    const lines = fs.readFileSync('brain.md', 'utf8').split(/\r?\n/);
    const pick = lines.find((l) => /^- \[in-progress/.test(l)) ?? lines.find((l) => /^- \[todo\]/.test(l));
    const todo = lines.filter((l) => /^- \[todo\]/.test(l)).length;
    const done = lines.filter((l) => /^- \[done\]/.test(l)).length;
    const state = lines.find((l) => l.startsWith('- **State:**'));
    if (state) console.log(` ${C.dim}${state.replace('- **State:** ', 'State: ')}${C.off}`);
    console.log(` Queue: ${C.green}${done} done${C.off}, ${C.yellow}${todo} todo${C.off}`);
    if (pick) console.log(` Next:  ${C.bold}${pick.replace(/^- /, '').split(' | ')[0]}${C.off}`);
  } catch { /* brain.md unreadable: print nothing */ }
  process.exit(0);
}

const base = process.argv[2] ?? path.join('logs', `run_${Date.now()}`);
const feedLog = fs.createWriteStream(`${base}.log`, { flags: 'a' });
const rawLog = fs.createWriteStream(`${base}.jsonl`, { flags: 'a' });
const start = Date.now();
let tools = 0;
let errors = 0;
const helperIds = new Set(); // tool_use ids of Agent/Task calls (subagents)

function clock() {
  const s = Math.floor((Date.now() - start) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function out(line) {
  const text = `${C.dim}[${clock()}]${C.off} ${line}`;
  console.log(text);
  feedLog.write(stripAnsi(text) + '\n');
}
function short(s, n = 110) {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}
function rel(p) {
  if (!p) return '';
  const r = path.relative(process.cwd(), String(p));
  return r && !r.startsWith('..') ? r : String(p);
}

function describeTool(name, input = {}) {
  switch (name) {
    case 'Read': return `Read ${rel(input.file_path)}`;
    case 'Write': return `${C.green}Write${C.off} ${rel(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `${C.green}Edit${C.off} ${rel(input.file_path)}`;
    case 'Glob': return `Glob ${input.pattern}`;
    case 'Grep': return `Grep "${short(input.pattern, 50)}"${input.path ? ' in ' + rel(input.path) : ''}`;
    case 'Bash': case 'PowerShell': return `${C.yellow}$${C.off} ${short(input.description || input.command, 100)}${input.description ? C.dim + '  (' + short(input.command, 60) + ')' + C.off : ''}`;
    case 'Agent': case 'Task': return `${C.mag}Helper agent:${C.off} ${short(input.description || input.prompt, 90)}`;
    case 'TodoWrite': {
      const cur = (input.todos ?? []).find((t) => t.status === 'in_progress');
      return `Todo: ${cur ? short(cur.content ?? cur.activeForm, 90) : `${(input.todos ?? []).length} items`}`;
    }
    default: return `${name} ${short(JSON.stringify(input), 80)}`;
  }
}

function handle(ev) {
  const sub = ev.parent_tool_use_id ? `${C.mag}  ↳ helper${C.off} ` : '';
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') out(`${C.cyan}Session started${C.off} ${C.dim}(model ${ev.model ?? '?'})${C.off}`);
      break;
    case 'assistant':
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_use') {
          tools++;
          if (b.name === 'Agent' || b.name === 'Task') helperIds.add(b.id);
          out(sub + describeTool(b.name, b.input));
        } else if (b.type === 'text' && b.text.trim()) {
          out(`${sub}${C.cyan}Claude:${C.off} ${short(b.text, 200)}`);
        }
      }
      break;
    case 'user':
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_result' && b.is_error) {
          errors++;
          const txt = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join(' ') : b.content;
          out(`${sub}${C.red}  ✗ ${short(txt, 150)}${C.off}`);
        } else if (b.type === 'tool_result' && helperIds.has(b.tool_use_id)) {
          out(`${C.mag}Helper finished${C.off}`);
        }
      }
      break;
    case 'result': {
      const ok = ev.subtype === 'success' && !ev.is_error;
      const mins = ((ev.duration_ms ?? Date.now() - start) / 60000).toFixed(1);
      const cost = ev.total_cost_usd != null ? `, $${ev.total_cost_usd.toFixed(2)}` : '';
      out(`${ok ? C.green + 'Session finished' : C.red + 'Session ended: ' + ev.subtype}${C.off} ${C.dim}(${mins} min, ${ev.num_turns ?? '?'} turns, ${tools} tool calls, ${errors} tool errors${cost})${C.off}`);
      if (ev.result) {
        console.log('\n' + ev.result.trim() + '\n');
        feedLog.write('\n' + ev.result.trim() + '\n');
      }
      break;
    }
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  rawLog.write(line + '\n');
  let ev;
  try { ev = JSON.parse(line); } catch { out(short(line, 200)); return; } // plain text (e.g. CLI error)
  try { handle(ev); } catch (e) { out(`${C.red}(feed error: ${e.message})${C.off}`); }
});
rl.on('close', () => { feedLog.end(); rawLog.end(); });
