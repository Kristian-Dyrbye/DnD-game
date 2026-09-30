/**
 * Real-model playtest (A115b): plays the starter arc and the start of chapter 1 through the whole
 * server (buildApp) with the REAL Ollama model from settings (default llama3.2:3b) and the mock TTS.
 * Story choices follow the starter smoke-test policy; on the first visit of each scene the hero also
 * types a free-text line with a known intended action, so intent parsing can be scored. Every LLM
 * call is recorded (RecordingLlm) and the run waits for background calls (suggestions, summary,
 * banter) before the next command, like a player reading the text.
 *
 *   npx tsx scripts/playtest-llm.ts [model] [--ch1-steps=10] [--lang=da]
 *
 * Writes userdata/playtest-llm.json (summary + every call) and userdata/playtest-llm.md (transcript);
 * with --lang=da (A150) the session plays in Danish (Danish probes, the language's default model) and
 * writes userdata/playtest-llm-da.{json,md}.
 * Needs Ollama on http://127.0.0.1:11434. Takes 30–60 minutes on a laptop CPU.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app';
import type { ServerEvent } from '../src/shared/protocol';
import { modelFor, SettingsSchema } from '../src/shared/settings';
import { isLanguage, type Language } from '../src/shared/i18nCore';
import { applyOverlay } from '../src/shared/contentI18n';
import { messages } from '../src/engine/i18n';
import { createLlmProvider } from '../src/llm/provider';
import { RecordingLlm, summarizeCalls } from '../src/llm/recording';
import { MockTts } from '../src/tts/mock';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { activeFight } from '../src/engine/adventure/fights';
import { wholeSentences } from '../src/engine/adventure/narration';
import { intentContext } from '../src/engine/adventure/intent';
import { getProgress, type RunContext } from '../src/engine/adventure/runner';
import { loadAdventures, loadFlagRegistry, loadTranslations } from '../src/server/adventures';
import { CompanionRosterSchema } from '../src/engine/party/companions';
import companionsJson from '../data/companions.json';
import { scoreProbe } from './playtest-score';
import type { GameSession } from '../src/engine/session/GameSession';
import type { Flags } from '../src/engine/world/flags';
import { combatStep } from '../tests/helpers/combatPolicy';

const args = process.argv.slice(2);
const model = args.find((a) => !a.startsWith('--'));
const ch1Steps = Number(args.find((a) => a.startsWith('--ch1-steps='))?.split('=')[1] ?? 10);
const langArg = args.find((a) => a.startsWith('--lang='))?.split('=')[1] ?? 'en';
if (!isLanguage(langArg)) throw new Error(`Unknown --lang=${langArg}`);
const lang: Language = langArg;
const suffix = lang === 'en' ? '' : `-${lang}`;
const db = loadSrd();
const S = 'arc.starter.';

/** Free-text probes: what the player types on the first visit, and the action ids that count as understood. */
const PROBES: Record<string, { text: string; expect: string[] }[]> = {
  millbrook_arrival: [
    { text: 'I walk over to the old well and look down it carefully', expect: ['well.examine'] },
    { text: 'I sing a loud song to cheer up the villagers', expect: [] },
  ],
  plough_tavern_talk: [
    { text: 'I try to convince the reeve that he must help me find the missing people', expect: ['persuade_reeve'] },
    { text: 'I ask the barkeep what rumours she has heard lately', expect: [] },
  ],
  gallows_hill_trail: [{ text: 'I kneel and search the muddy ground for footprints', expect: ['track'] }],
  barrow_sheaf_crypt: [{ text: 'I try to break the chains that hold the prisoners', expect: ['free_corwin', 'slip_chains', 'free_fast', 'free_tools'] }],
  barrow_shrine_rest: [{ text: 'I relight the flame in the little shrine', expect: ['rekindle', 'rekindle_nature'] }],
  marrows_goods_and_oath: [{ text: 'I ask Sir Corwin to come with me on the road south', expect: ['recruit', 'recruit_cruel'] }],
};

/** Danish probes (A150): same scenes and expected actions, written the way a Danish player would. */
const PROBES_DA: typeof PROBES = {
  millbrook_arrival: [
    { text: 'Jeg går hen til den gamle brønd og kigger forsigtigt ned i den', expect: ['well.examine'] },
    { text: 'Jeg synger en høj sang for at muntre landsbyboerne op', expect: [] },
  ],
  plough_tavern_talk: [
    { text: 'Jeg prøver at overbevise fogeden om, at han må hjælpe mig med at finde de forsvundne', expect: ['persuade_reeve'] },
    { text: 'Jeg spørger værtinden, hvilke rygter hun har hørt på det seneste', expect: [] },
  ],
  gallows_hill_trail: [{ text: 'Jeg knæler og leder efter fodspor i den mudrede jord', expect: ['track'] }],
  barrow_sheaf_crypt: [{ text: 'Jeg prøver at bryde lænkerne, der holder fangerne', expect: ['free_corwin', 'slip_chains', 'free_fast', 'free_tools'] }],
  barrow_shrine_rest: [{ text: 'Jeg tænder flammen i det lille alter igen', expect: ['rekindle', 'rekindle_nature'] }],
  marrows_goods_and_oath: [{ text: 'Jeg spørger Ser Corwin, om han vil drage med mig mod syd', expect: ['recruit', 'recruit_cruel'] }],
};

/** Same story policy as tests/starterSmoke.test.ts. */
function nextChoice(scene: string, flags: Flags, offered: string[]): string | undefined {
  const f = (k: string) => flags[`${S}${k}`];
  const first = (...ids: string[]) => ids.find((id) => offered.includes(id));
  switch (scene) {
    case 'millbrook_arrival':
      if (!f('altar_won')) return first('well.examine', f('barrow_key') ? 'exit.hill' : 'exit.tavern');
      if (!f('slept')) return first('exit.tavern');
      if (!f('oath_done')) return first('wait_evening', 'wait_night', 'exit.shop');
      return first('exit.road');
    case 'plough_tavern_talk':
      if (f('altar_won')) return f('slept') ? first('exit.out') : first('sleep_free', 'sleep_paid', 'sleep_barred', 'exit.out');
      return first('persuade_reeve', 'intimidate_reeve', 'deposit', 'exit.out');
    case 'gallows_hill_trail':
      return first('track', 'ford_athletics', 'ford_acrobatics', 'sneak', 'exit.barrow', 'exit.force', 'exit.back');
    case 'barrow_of_the_first_sheaf':
      return first('exit.crypt');
    case 'barrow_sheaf_crypt':
      return first('slip_chains', 'free_corwin', 'bind_wounds', 'exit.altar');
    case 'barrow_tithe_altar':
      return first('rematch', 'free_fast', 'free_tools', 'chase', 'exit.shrine');
    case 'barrow_shrine_rest':
      return first('rekindle', 'rekindle_nature', 'rest_safe', 'rest_cold', 'exit.home');
    case 'marrows_goods_and_oath':
      return first('return_ring', 'recruit', 'recruit_cruel', 'go_alone', 'exit.green');
    case 'road_south':
      return first('to_ravensgate');
    case 'road_ravensgate':
      return first('arrive');
    case 'road_brightwater':
      return first('pay', 'talk_down', 'fight', 'hand_over', 'keep');
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-llm-playtest-'));
  const cfg = SettingsSchema.parse({}).llm;
  const llm = new RecordingLlm(createLlmProvider({ ...cfg, model: model ?? modelFor(cfg, lang), useMock: false }));
  const status = await llm.status();
  if (!status.reachable || !status.modelAvailable) throw new Error(`Ollama not ready: ${JSON.stringify(status)}`);
  console.log(`Playtest with ${status.model}`);
  const app = (await buildApp({ userDataDir: dir, savesDir: dir, services: { llm, tts: new MockTts() }, sessionPorts: { newSeed: () => 'llm-playtest-1' } })) as FastifyInstance & { session: GameSession };
  await app.ready();
  const session = app.session;
  const events: ServerEvent[] = [];
  const entries = new Map<number, { kind: string; speaker?: string; text: string }>();
  session.on((e) => {
    events.push(e);
    if (e.type === 'log') entries.set(e.entry.id, { kind: e.entry.kind, ...(e.entry.speaker && { speaker: e.entry.speaker }), text: e.entry.text });
    if (e.type === 'narration' && e.phase === 'end') {
      const old = entries.get(e.entryId);
      entries.set(e.entryId, { kind: old?.kind ?? 'narration', text: e.text });
    }
  });
  const t0 = performance.now();
  const commandMs: { command: string; ms: number; scene: string }[] = [];
  const probes: { scene: string; text: string; expect: string[]; intent: unknown; refined: unknown; actionId?: string; rawUnderstood: boolean | null; understood: boolean | null; ms: number }[] = [];
  // A122: probes are scored like sessionActions.say scores them (refined intent), so the script
  // needs the same adventures + flag registry to rebuild the scene's intent context.
  const advDir = path.join('data', 'adventures');
  const flagRegistry = loadFlagRegistry(advDir);
  const roster = CompanionRosterSchema.parse(companionsJson);
  const { adventures } = loadAdventures(advDir, db, flagRegistry, roster);
  const overlays = loadTranslations(path.join('data', 'i18n')).translations[lang] ?? {};
  const probeContext = () => {
    const english = adventures.get(getProgress(session.current)!.adventureId);
    if (!english) return undefined;
    // The session's own view: the adventure in the session language, and its messages.
    const adventure = lang === 'en' ? english : applyOverlay(english, overlays[english.id]);
    const ctx: RunContext = { state: structuredClone(session.current), adventure, rng: Rng.fromSeed('probe'), db, flags: flagRegistry, companions: roster, msgs: messages(lang) };
    return intentContext(ctx);
  };
  const suggestionSets: { scene: string; ideas: string[] }[] = [];

  /** Wait until background LLM calls are done (cap 180 s), then note the free-text ideas offered. */
  const settle = async (scene: string) => {
    await sleep(300);
    const until = performance.now() + 180_000;
    while (llm.pending > 0 && performance.now() < until) await sleep(250);
    const last = [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    const ideas = (last?.actions ?? []).filter((a) => a.say).map((a) => a.label);
    if (ideas.length) suggestionSets.push({ scene, ideas });
  };
  const run = async (cmd: Parameters<GameSession['handle']>[0], label: string) => {
    const scene = cmd.type === 'new_game' ? 'start' : (getProgress(session.current)?.sceneId ?? '?');
    const start = performance.now();
    await session.handle(cmd);
    const ms = performance.now() - start;
    commandMs.push({ command: label, ms: Math.round(ms), scene });
    console.log(`${((performance.now() - t0) / 1000).toFixed(0).padStart(5)} s  ${scene.padEnd(26)} ${label.padEnd(40).slice(0, 40)} ${(ms / 1000).toFixed(1)} s`);
    return ms;
  };

  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('smoke'))), db);
  if (lang !== 'en') await session.handle({ type: 'set_language', language: lang });
  await run({ type: 'new_game', hero, mode: 'heroic' }, 'new_game');
  await settle('start');

  const probed = new Set<string>();
  let ch1Taken = 0;
  const chosenInCh1 = new Set<string>();
  for (let step = 0; step < 400; step++) {
    const p = getProgress(session.current)!;
    if (activeFight(session.current)) {
      await run(combatStep(session, db), 'combat');
      continue;
    }
    const scene = p.sceneId;
    if (!probed.has(scene)) {
      probed.add(scene);
      const generic = lang === 'da' ? 'Jeg ser mig grundigt omkring og spørger dem, der er her, hvad der foregår' : 'I look around carefully and ask whoever is here what is going on';
      for (const probe of (lang === 'da' ? PROBES_DA : PROBES)[scene] ?? (p.adventureId !== 'millbrook_disappearances' ? [{ text: generic, expect: [] }] : [])) {
        const before = llm.calls.length;
        const ictx = probeContext();
        const ms = await run({ type: 'say', text: probe.text }, `say: ${probe.text}`);
        await settle(scene);
        const call = llm.calls.slice(before).find((c) => c.task === 'intent' && !c.error);
        if (ictx) {
          const s = scoreProbe(call?.reply, probe.text, ictx, probe.expect);
          probes.push({ scene, text: probe.text, expect: probe.expect, intent: s.raw, refined: s.refined, ...(s.actionId && { actionId: s.actionId }), rawUnderstood: s.rawUnderstood, understood: s.understood, ms: Math.round(ms) });
        }
        if (activeFight(session.current) || getProgress(session.current)!.sceneId !== scene) break;
      }
      continue;
    }
    const offered = ([...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions')?.actions ?? []).filter((a) => !a.say).map((a) => a.id!);
    let choice: string | undefined;
    // A probe may open a conversation (A131): leave it when the policy has nothing to pick there.
    if (p.adventureId === 'millbrook_disappearances') choice = nextChoice(scene, session.current.flags, offered) ?? offered.find((id) => id === 'dlg.bye');
    else {
      if (ch1Taken >= ch1Steps) break;
      ch1Taken++;
      choice = offered.find((id) => !id.startsWith('exit.') && !chosenInCh1.has(id)) ?? offered.find((id) => !chosenInCh1.has(id)) ?? offered[0];
      if (choice) chosenInCh1.add(choice);
    }
    if (!choice) {
      console.log(`stuck in ${scene}; offered: ${offered.join(', ')}`);
      break;
    }
    await run({ type: 'choose', actionId: choice }, `choose ${choice}`);
    await settle(scene);
  }
  await settle('end');

  // A118: story narrations that finished, were cut but kept whole sentences, or fell back to templates.
  const narrations = (combat: boolean) => {
    const list = llm.calls.filter((c) => c.task === 'narrate' && c.prompt.includes('moments of the fight') === combat);
    const partial = list.filter((c) => c.error !== undefined && wholeSentences(c.reply)).length;
    const failed = list.filter((c) => c.error !== undefined).length - partial;
    return { calls: list.length, complete: list.length - failed - partial, partial, failed, completeRate: list.length ? Math.round(((list.length - failed) / list.length) * 100) / 100 : null };
  };
  const report = {
    model: status.model,
    lang,
    minutes: Math.round((performance.now() - t0) / 600) / 100,
    reachedAdventure: getProgress(session.current)?.adventureId,
    errors: events.filter((e) => e.type === 'error'),
    narration: { story: narrations(false), combat: narrations(true) },
    tasks: summarizeCalls(llm.calls),
    probeScore: (() => {
      const scored = probes.filter((p) => p.understood !== null);
      return { scored: scored.length, raw: scored.filter((p) => p.rawUnderstood).length, refined: scored.filter((p) => p.understood).length };
    })(),
    probes,
    suggestionSets,
    slowestCommands: [...commandMs].sort((a, b) => b.ms - a.ms).slice(0, 15),
    calls: llm.calls.map((c) => ({ ...c, prompt: c.prompt.slice(-300) })),
  };
  fs.mkdirSync('userdata', { recursive: true });
  fs.writeFileSync(path.join('userdata', `playtest-llm${suffix}.json`), JSON.stringify(report, null, 2));
  const md = [...entries.values()].map((e) => (e.kind === 'narration' ? e.text : `*[${e.kind}${e.speaker ? ` ${e.speaker}` : ''}]* ${e.text}`)).join('\n\n');
  fs.writeFileSync(path.join('userdata', `playtest-llm${suffix}.md`), `# Playtest transcript (${status.model}, ${lang})\n\n${md}\n`);
  console.log(JSON.stringify({ ...report, calls: undefined, suggestionSets: suggestionSets.length }, null, 2));
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
