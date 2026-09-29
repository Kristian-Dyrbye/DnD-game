import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { cleanNarration, narrateInto, templateNarration, type Narrator } from './narration';
import { perform, startAdventure, type RunContext } from './runner';
import { adventureActionPort } from './sessionActions';
import { validateAdventure } from './validate';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);

async function running(narrator?: Narrator) {
  const session = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, narrator ? { narrator } : {}), newSeed: () => 's' });
  const events: ServerEvent[] = [];
  session.on((e) => events.push(e));
  await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
  return { session, events };
}

describe('templateNarration', () => {
  it('puts facts on the way before the scene and arrival facts after it', () => {
    let ctx: RunContext | undefined;
    for (let seed = 0; seed < 30 && !ctx; seed++) {
      const c: RunContext = { state: (() => { const s = new GameSession(); s.start({ campaignId: 'c', mode: 'heroic', rng: Rng.fromSeed(seed).getState(), hero: hero(), location: { name: 'x' } }); return s.current; })(), adventure, rng: Rng.fromSeed(seed), db };
      startAdventure(c);
      perform(c, 'exit.to_mill');
      const r = perform(c, 'exit.force');
      if (!r.rolls[0]!.success) continue;
      const text = templateNarration({ kind: 'scene', facts: r.facts, ctx: c, ...(r.arrivalIndex !== undefined && { arrivalIndex: r.arrivalIndex }) });
      expect(text.indexOf('The rotten hasp splinters')).toBeLessThan(text.indexOf('A low cellar'));
      expect(text.indexOf('A low cellar')).toBeLessThan(text.indexOf('Two giant rats burst'));
      ctx = c;
    }
    expect(ctx).toBeDefined();
  });

  it('joins outcome facts', () => {
    const c: RunContext = { state: undefined as never, adventure, rng: Rng.fromSeed(1) };
    expect(templateNarration({ kind: 'outcome', facts: ['A.', 'B.'], ctx: c })).toBe('A. B.');
    expect(templateNarration({ kind: 'outcome', facts: [], ctx: c })).toBe('Nothing much happens.');
  });
});

describe('narrateInto', () => {
  it('streams chunks with start/chunk/end events and logs the full text under the same id', async () => {
    const narrator: Narrator = async function* () {
      yield 'The square ';
      yield 'bustles.';
    };
    const { session, events } = await running(narrator);
    const stream = events.filter((e) => e.type === 'narration');
    expect(stream.map((e) => e.type === 'narration' && e.phase)).toEqual(['start', 'chunk', 'chunk', 'end']);
    const id = stream[0]!.type === 'narration' ? stream[0]!.entryId : -1;
    const log = events.find((e) => e.type === 'log' && e.entry.id === id);
    expect(log).toEqual({ type: 'log', entry: { id, kind: 'narration', text: 'The square bustles.' } });
    expect(session.current.log.find((e) => e.id === id)?.text).toBe('The square bustles.');
  });

  it('falls back to the template when the narrator throws mid-stream or yields nothing', async () => {
    const failing: Narrator = async function* () {
      yield 'Half a sen';
      throw new Error('Ollama died');
    };
    const { events } = await running(failing);
    const logged = events.filter((e) => e.type === 'log').map((e) => (e.type === 'log' ? e.entry.text : ''));
    expect(logged.some((t) => t.includes('mossy well'))).toBe(true);
    expect(logged.some((t) => t.includes('Half a sen'))).toBe(false);
    expect(events.some((e) => e.type === 'narration' && e.phase === 'end')).toBe(true);

    const silent: Narrator = async function* () {};
    const quiet = await running(silent);
    expect(quiet.events.some((e) => e.type === 'narration')).toBe(false);
    expect(quiet.events.some((e) => e.type === 'log' && e.entry.text.includes('mossy well'))).toBe(true);
  });

  it('passes the player action and facts to the narrator after the dice are shown', async () => {
    const jobs: { kind: string; playerAction?: string; facts: string[] }[] = [];
    const order: string[] = [];
    const narrator: Narrator = async function* (job) {
      jobs.push({ kind: job.kind, ...(job.playerAction && { playerAction: job.playerAction }), facts: job.facts });
      order.push('narrate');
      yield 'ok';
    };
    const { session } = await running(narrator);
    order.length = 0;
    session.on((e) => e.type === 'roll' && order.push('roll'));
    await session.handle({ type: 'choose', actionId: 'notice_board.read' });
    expect(jobs.at(-1)).toMatchObject({ kind: 'outcome', playerAction: 'Study the notices' });
    expect(jobs.at(-1)!.facts).toHaveLength(1);
    expect(order).toEqual(['roll', 'narrate']);
  });

  it('works directly on a session with no narrator', async () => {
    const { session } = await running();
    const c: RunContext = { state: session.current, adventure, rng: session.rng, db };
    const text = await narrateInto(session, { kind: 'outcome', facts: ['A door creaks.'], ctx: c });
    expect(text).toBe('A door creaks.');
  });
});

describe('cleanNarration', () => {
  it('removes think blocks, headings and bold markers', () => {
    expect(cleanNarration('<think>plan</think>\n# Scene\n**You** step in.\n\n\n\nRain falls.')).toBe('You step in.\n\nRain falls.');
  });
});
