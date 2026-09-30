import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { AdventureError, availableActions, getProgress, perform, startAdventure, type RunContext } from './runner';
import type { Adventure } from './schema';
import { adventureActionPort } from './sessionActions';
import { LuckyRng, solveAdventure } from './solver';
import { validateAdventure } from './validate';

const db = loadSrd();
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
const adventure = (raw: unknown = demo): Adventure => {
  const r = validateAdventure(structuredClone(raw), db);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
/** Every d20 rolls a 1. */
class UnluckyRng extends Rng {
  constructor() {
    super([1, 2, 3, 4]);
  }
  override next(): number {
    return 0;
  }
}
const ctx = (rng: Rng = Rng.fromSeed(1)): RunContext => {
  const c: RunContext = { state: newGameState(hero(), 'heroic', 1), adventure: adventure(), rng, db };
  startAdventure(c);
  return c;
};
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
const TALK = 'talk.mayor_hobb.mill_talk';

describe('conversations in the runner', () => {
  it('opens a talk: the NPC line, only its options plus a way out, other actions closed meanwhile', () => {
    const c = ctx();
    expect(availableActions(c).find((a) => a.id === TALK)).toEqual({ id: TALK, label: 'Ask Mayor Hobb about the old mill', kind: 'talk' });
    const t0 = c.state.time;
    const r = perform(c, TALK);
    expect(r.dialogue).toEqual([{ speaker: 'Mayor Hobb', text: expect.stringMatching(/^Friend! You've seen the notice/) }]);
    expect(r.facts).toEqual([]);
    expect(c.state.time).toBe(t0 + 10);
    // press is hidden until the Insight check noticed his nerves
    expect(ids(c)).toEqual(['dlg.greet.miller', 'dlg.greet.sense', 'dlg.greet.leave', 'dlg.bye']);
    expect(availableActions(c).find((a) => a.id === 'dlg.greet.sense')?.check).toBe('Insight DC 12');
    expect(() => perform(c, 'exit.to_mill')).toThrow(AdventureError);
    expect(() => perform(c, TALK)).toThrow(AdventureError);
  });

  it('follows `next`, hides once-per-talk options, and ends on an option without `next` or on leaving', () => {
    const c = ctx();
    perform(c, TALK);
    const miller = perform(c, 'dlg.greet.miller');
    expect(miller.dialogue?.[0]?.text).toMatch(/^Aldo\?/);
    expect(ids(c)).toEqual(['dlg.miller.back', 'dlg.bye']);
    perform(c, 'dlg.miller.back');
    expect(ids(c)).not.toContain('dlg.greet.miller');
    const bye = perform(c, 'dlg.greet.leave');
    expect(bye.dialogue).toBeUndefined();
    expect(getProgress(c.state)?.talk).toBeUndefined();
    expect(ids(c)).toContain('exit.to_mill');
    // A new talk starts fresh: once-per-talk options are back.
    perform(c, TALK);
    expect(ids(c)).toContain('dlg.greet.miller');
    perform(c, 'dlg.bye');
    expect(getProgress(c.state)?.talk).toBeUndefined();
  });

  it('checks branch the tree: success unlocks options and goes to `next`, failure to `nextOnFail`', () => {
    const win = ctx(new LuckyRng());
    perform(win, TALK);
    const sense = perform(win, 'dlg.greet.sense');
    expect(sense.rolls[0]?.success).toBe(true);
    expect(sense.facts[0]).toMatch(/hiding something about the grain/);
    expect(win.state.flags['adv.millbrook_demo.hobb_nervous']).toBe(true);
    expect(ids(win)).toContain('dlg.greet.press');
    const coins = win.state.hero.coins;
    const press = perform(win, 'dlg.greet.press');
    expect(press.dialogue?.[0]?.text).toMatch(/^All right, all right!/);
    expect(win.state.hero.coins).toBe(coins + 500);
    expect(win.state.flags['adv.millbrook_demo.hobb_confessed']).toBe(true);

    const lose = ctx(new LuckyRng());
    perform(lose, TALK);
    perform(lose, 'dlg.greet.sense');
    lose.rng = new UnluckyRng();
    const bluster = perform(lose, 'dlg.greet.press');
    expect(bluster.rolls[0]?.success).toBe(false);
    expect(bluster.facts).toEqual(['The mayor puffs himself up and turns red.']);
    expect(bluster.dialogue?.[0]?.text).toMatch(/^How dare you!/);
    // The bluster node has no options: the talk is over.
    expect(getProgress(lose.state)?.talk).toBeUndefined();
    expect(lose.state.flags['adv.millbrook_demo.hobb_confessed']).toBeUndefined();
  });

  it('once conversations, conditions, speakers and a goto that ends the talk', () => {
    const raw = structuredClone(demo) as typeof demo & { npcs: Record<string, unknown>[] };
    raw.npcs.push({
      id: 'guard',
      name: 'Sergeant Pell',
      statBlock: 'guard',
      personality: 'Gruff.',
      voice: 'Short sentences.',
      conversations: [
        {
          id: 'escort',
          once: true,
          start: 'a',
          nodes: [
            { id: 'a', text: 'Need an escort?', options: [{ id: 'yes', label: 'Yes', outcome: { text: 'He walks you to the mill.', goto: 'old_mill' }, next: 'b' }] },
            { id: 'b', speaker: 'mayor_hobb', text: 'Off you go, friend!', options: [] },
          ],
        },
      ],
    });
    (raw.chapters[0]!.scenes[0]!.npcs as string[]).push('guard');
    const c: RunContext = { state: newGameState(hero(), 'heroic', 1), adventure: adventure(raw), rng: Rng.fromSeed(1), db };
    startAdventure(c);
    const talk = availableActions(c).find((a) => a.id === 'talk.guard.escort');
    expect(talk?.label).toBe('Talk to Sergeant Pell');
    perform(c, 'talk.guard.escort');
    const go = perform(c, 'dlg.a.yes');
    expect(go.entered).toEqual(['old_mill']);
    expect(go.dialogue).toBeUndefined();
    expect(getProgress(c.state)?.talk).toBeUndefined();
    perform(c, 'exit.back');
    expect(ids(c)).not.toContain('talk.guard.escort');
  });
});

describe('conversation validation and solving', () => {
  const broken = () => {
    const raw = structuredClone(demo) as typeof demo & { npcs: { conversations: { start: string; nodes: Record<string, unknown>[] }[] }[] };
    const conv = raw.npcs[0]!.conversations[0]!;
    return { raw, conv };
  };

  it('reports bad node refs and speakers, and warns about unreachable nodes', () => {
    const { raw, conv } = broken();
    conv.start = 'nowhere';
    conv.nodes.push({ id: 'orphan', text: 'Nobody gets here.', speaker: 'ghost', options: [{ id: 'x', label: 'x', next: 'missing' }] });
    const r = validateAdventure(raw, db);
    expect(r.errors).toContain('npc mayor_hobb conversation mill_talk: start node "nowhere" does not exist');
    expect(r.errors).toContain('npc mayor_hobb conversation mill_talk node orphan: unknown speaker "ghost"');
    expect(r.errors).toContain('npc mayor_hobb conversation mill_talk node orphan option x: next node "missing" does not exist');

    const ok = broken();
    ok.conv.nodes.push({ id: 'orphan', text: 'Nobody gets here.' });
    const w = validateAdventure(ok.raw, db);
    expect(w.ok).toBe(true);
    expect(w.warnings).toContain('npc mayor_hobb conversation mill_talk: node "orphan" is unreachable from the start');
  });

  it('checks outcomes inside conversations and counts their gotos/endings for reachability', () => {
    const { raw, conv } = broken();
    conv.nodes.push({ id: 'bad', text: '…', options: [{ id: 'y', label: 'y', outcome: { goto: 'atlantis', encounter: 'kraken' } }] });
    const r = validateAdventure(raw, db);
    expect(r.errors).toContain('npc mayor_hobb conversation mill_talk node bad option y: goto unknown scene "atlantis"');
    expect(r.errors).toContain('npc mayor_hobb conversation mill_talk node bad option y: unknown encounter "kraken"');
  });

  it('the solver can finish an adventure whose only way on is a conversation', () => {
    const raw = {
      formatVersion: 1,
      id: 'talk_only',
      name: 'Talk only',
      kind: 'test',
      levelRange: [1, 2],
      summary: 'Persuade the gatekeeper.',
      start: { chapter: 'c', scene: 'gate' },
      chapters: [{ id: 'c', name: 'C', summary: 'C', start: 'gate', scenes: [{ id: 'gate', name: 'Gate', seed: 'A gate.', npcs: ['keeper'] }] }],
      npcs: [
        {
          id: 'keeper',
          name: 'Keeper',
          statBlock: 'commoner',
          personality: 'Stubborn.',
          voice: 'Slow.',
          conversations: [
            {
              id: 'plea',
              start: 'ask',
              nodes: [
                { id: 'ask', text: 'Why should I open?', options: [{ id: 'charm', label: 'Charm him', check: { skill: 'persuasion', dc: 15 }, next: 'soft', nextOnFail: 'ask' }] },
                { id: 'soft', text: 'Fine, fine.', options: [{ id: 'thanks', label: 'Thank him', outcome: { ending: 'through' } }] },
              ],
            },
          ],
        },
      ],
      endings: [{ id: 'through', name: 'Through', text: 'You pass.' }],
    };
    const adv = adventure(raw);
    const r = solveAdventure({ state: newGameState(hero(), 'heroic', 1), adventure: adv, db }, 'through');
    expect(r.ok).toBe(true);
    expect(r.path).toEqual(['talk.keeper.plea', 'dlg.ask.charm', 'dlg.soft.thanks']);
  });
});

describe('conversations through the session', () => {
  it('emits the dialogue view, authored option buttons, NPC lines and the hero replies', async () => {
    const adv = adventure();
    const session = new GameSession({ actions: adventureActionPort(new Map([[adv.id, adv]]), adv.id, db), newSeed: () => 's' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    const last = <T extends ServerEvent['type']>(type: T) => events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type).at(-1);
    expect(last('dialogue')?.view).toBeNull();

    await session.handle({ type: 'choose', actionId: TALK });
    expect(last('dialogue')?.view).toEqual({ npcId: 'mayor_hobb', npc: 'Mayor Hobb', speaker: 'Mayor Hobb', text: expect.stringMatching(/^Friend!/) });
    expect(last('suggestions')?.actions.map((a) => a.id)).toEqual(['dlg.greet.miller', 'dlg.greet.sense', 'dlg.greet.leave', 'dlg.bye']);
    expect(last('suggestions')?.actions[1]?.label).toBe('Watch his face as he talks about the mill (Insight DC 12)');
    const npcLine = session.current.log.at(-1)!;
    expect(npcLine).toMatchObject({ kind: 'dialogue', speaker: 'Mayor Hobb' });

    await session.handle({ type: 'choose', actionId: 'dlg.greet.miller' });
    const tail = session.current.log.slice(-2);
    expect(tail[0]).toMatchObject({ kind: 'player', text: '"What happened to the miller?"' });
    expect(tail[1]).toMatchObject({ kind: 'dialogue', speaker: 'Mayor Hobb', text: expect.stringMatching(/^Aldo\?/) });

    // Free text matches an option's keywords.
    await session.handle({ type: 'say', text: 'Tell me more about the mill' });
    expect(last('dialogue')?.view?.text).toMatch(/^Friend!/);

    await session.handle({ type: 'choose', actionId: 'dlg.bye' });
    expect(last('dialogue')?.view).toBeNull();
    expect(last('suggestions')?.actions.map((a) => a.id)).toContain('exit.to_mill');
  });
});
