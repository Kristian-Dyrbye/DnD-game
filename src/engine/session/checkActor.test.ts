/** C004: who rolls — check actions, exits and conversation options take an `actor` (a player-made hero). */
import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent, SuggestedAction } from '../../shared/protocol';
import { parseCommand } from '../../shared/protocol';
import { adventureActionPort } from '../adventure/sessionActions';
import { availableActions, checkBonus, getProgress, perform, type RunContext } from '../adventure/runner';
import type { Adventure, Check } from '../adventure/schema';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema } from '../party/companions';
import { LoreSchema } from '../world/lore';
import { GameSession } from './GameSession';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const built = (cls: string, name: string) => ({ ...buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(name))), db), name });

function adventure(): Adventure {
  const raw = structuredClone(demo) as unknown as { chapters: { scenes: { actions: Record<string, unknown>[] }[] }[] };
  const actions = raw.chapters[0]!.scenes[0]!.actions;
  actions.push({ id: 'hire', label: 'Hire', once: true, outcome: { recruit: 'nettle' } });
  actions.push({ id: 'heave', label: 'Heave the cart', check: { skill: 'athletics', dc: 10, group: true, success: { text: 'It moves.' }, failure: { text: 'It sticks.' } } });
  return validateAdventure(raw, db).adventure!;
}

function session() {
  const adv = adventure();
  const s = new GameSession({ actions: adventureActionPort(new Map([[adv.id, adv]]), adv.id, db, { lore, companions: roster }), newSeed: () => 'actor' });
  const events: ServerEvent[] = [];
  s.on((e) => events.push(e));
  const errors = () => events.filter((e): e is Extract<ServerEvent, { type: 'error' }> => e.type === 'error').map((e) => e.message);
  const buttons = () => events.filter((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions').at(-1)!.actions;
  const ctx = (): RunContext => ({ state: s.current, adventure: adv, rng: Rng.fromSeed('x'), db });
  return { s, adv, events, errors, buttons, ctx };
}

async function duo() {
  const t = session();
  await t.s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
  await t.s.handle({ type: 'add_hero', hero: built('wizard', 'Wren') });
  return t;
}

const checkOf = (adv: Adventure, poi: string, action: string): Check => adv.chapters[0]!.scenes[0]!.pois.find((p) => p.id === poi)!.actions.find((a) => a.id === action)!.check!;

describe('check actor (C004)', () => {
  it('solo play lists no actors (buttons unchanged)', async () => {
    const { s, ctx, buttons } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    expect(availableActions(ctx()).some((a) => a.actors)).toBe(false);
    expect(buttons().some((b) => b.actors)).toBe(false);
  });

  it('with two heroes, check actions list both heroes with their bonuses (hero first); talks list who may open them', async () => {
    const { s, adv, ctx, buttons } = await duo();
    const read = availableActions(ctx()).find((a) => a.id === 'notice_board.read')!;
    const check = checkOf(adv, 'notice_board', 'read');
    expect(read.actors).toEqual([
      { id: 'hero', name: 'Mira', bonus: checkBonus(s.current.hero, check) },
      { id: 'hero-2', name: 'Wren', bonus: checkBonus(s.current.companions[0]!, check) },
    ]);
    const talk = availableActions(ctx()).find((a) => a.id === 'talk.mayor_hobb.mill_talk')!;
    expect(talk.actors).toEqual([{ id: 'hero', name: 'Mira' }, { id: 'hero-2', name: 'Wren' }]);
    // Plain actions (no check) and group checks have no chooser.
    expect(availableActions(ctx()).find((a) => a.id === 'hire')!.actors).toBeUndefined();
    expect(availableActions(ctx()).find((a) => a.id === 'heave')!.actors).toBeUndefined();
    // The suggestion buttons carry the chooser data to the client.
    const b = buttons().find((x: SuggestedAction) => x.id === 'notice_board.read')!;
    expect(b.actors?.map((a) => a.id)).toEqual(['hero', 'hero-2']);
  });

  it('choose with an actor rolls for that hero (named in the roll); without one the hero rolls', async () => {
    const { s, adv, errors } = await duo();
    const check = checkOf(adv, 'notice_board', 'read');
    await s.handle({ type: 'choose', actionId: 'notice_board.read', actor: 'hero-2' });
    expect(errors()).toEqual([]);
    const roll = s.current.rolls.at(-1)!;
    expect(roll.label.startsWith('Wren: ')).toBe(true);
    expect(roll.modifier).toBe(checkBonus(s.current.companions[0]!, check));
  });

  it('the hero who opens a talk keeps it: option checks are theirs unless a reply names another hero', async () => {
    const { s, ctx, errors } = await duo();
    await s.handle({ type: 'choose', actionId: 'talk.mayor_hobb.mill_talk', actor: 'hero-2' });
    expect(getProgress(s.current)!.talk?.actor).toBe('hero-2');
    // The opener comes first in the reply's chooser.
    const sense = availableActions(ctx()).find((a) => a.id === 'dlg.greet.sense')!;
    expect(sense.actors?.map((a) => a.id)).toEqual(['hero-2', 'hero']);
    await s.handle({ type: 'choose', actionId: 'dlg.greet.sense' });
    expect(s.current.rolls.at(-1)!.label.startsWith('Wren: ')).toBe(true);
    expect(errors()).toEqual([]);
  });

  it('a reply may name another hero; a talk opened by the hero has no actor', async () => {
    const { s, ctx } = await duo();
    await s.handle({ type: 'choose', actionId: 'talk.mayor_hobb.mill_talk' });
    expect(getProgress(s.current)!.talk?.actor).toBeUndefined();
    expect(availableActions(ctx()).find((a) => a.id === 'dlg.greet.sense')!.actors?.[0]!.id).toBe('hero');
    await s.handle({ type: 'choose', actionId: 'dlg.greet.sense', actor: 'hero-2' });
    expect(s.current.rolls.at(-1)!.label.startsWith('Wren: ')).toBe(true);
  });

  it('refuses a companion, a downed hero or an unknown id as actor (in the session language) and does nothing', async () => {
    const { s, errors } = await duo();
    await s.handle({ type: 'choose', actionId: 'hire' });
    expect(s.current.companions.map((c) => c.id)).toContain('nettle');
    const rolls = s.current.rolls.length;
    await s.handle({ type: 'choose', actionId: 'notice_board.read', actor: 'nettle' });
    await s.handle({ type: 'choose', actionId: 'notice_board.read', actor: 'nobody' });
    s.current.companions.find((c) => c.id === 'hero-2')!.hp = 0;
    s.language = 'da';
    await s.handle({ type: 'choose', actionId: 'notice_board.read', actor: 'hero-2' });
    expect(errors()).toEqual(["That character can't attempt this now.", "That character can't attempt this now.", 'Den figur kan ikke forsøge det nu.']);
    expect(s.current.rolls.length).toBe(rolls);
    // The once-only action was not used up by the refusals.
    await s.handle({ type: 'choose', actionId: 'notice_board.read' });
    expect(s.current.rolls.length).toBe(rolls + 1);
  });

  it('a downed extra hero drops out of the chooser (one hero left = no chooser)', async () => {
    const { s, ctx } = await duo();
    s.current.companions[0]!.hp = 0;
    expect(availableActions(ctx()).find((a) => a.id === 'notice_board.read')!.actors).toBeUndefined();
  });

  it('group checks are unchanged: every conscious member rolls whatever actor is sent', async () => {
    const { ctx } = await duo();
    const a = perform(ctx(), 'heave');
    const b = perform(ctx(), 'heave', { actor: 'hero-2' });
    expect(a.rolls.map((r) => r.label.split(':')[0])).toEqual(['Athletics', 'Wren']);
    expect(b.rolls.map((r) => r.label.split(':')[0])).toEqual(['Athletics', 'Wren']);
  });

  it('checkBonus counts exhaustion; the protocol accepts choose with an actor', async () => {
    const { s, adv } = await duo();
    const check = checkOf(adv, 'notice_board', 'read');
    const before = checkBonus(s.current.hero, check);
    s.current.hero.exhaustion = 1;
    expect(checkBonus(s.current.hero, check)).toBe(before - 2);
    expect(parseCommand(JSON.stringify({ type: 'choose', actionId: 'x', actor: 'hero-2' })).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ type: 'choose', actionId: 'x', actor: '' })).ok).toBe(false);
  });
});
