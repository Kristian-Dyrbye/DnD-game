/** A141f: the rest of the combat log (AI plans, actions, movement, action economy, attack checks) in English (unchanged) and Danish. */
import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character, type Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages, type Messages } from '../i18n';
import { rollDamage } from '../rules/damage';
import { monsterToCreature } from '../rules/monsters';
import { dash, disengage, dodge, escapeGrapple, grapple, help, moveCreature, ready, shove, triggerReadied } from './actions';
import { takeAiTurn } from './ai';
import { characterAttackProfile, checkAttack } from './attack';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, placeToken } from './grid';
import { spend, standUp, startCombat } from './turns';

const db = loadSrd();
const da = messages('da');

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}

const hero = (): Character =>
  CharacterSchema.parse({
    id: 'hero',
    name: 'Brenna',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 30,
    hp: 30,
    ac: 16,
    speed: { walk: 30 },
    classes: [{ classId: 'fighter', level: 3 }],
    speciesId: 'human',
    backgroundId: 'soldier',
    skills: { athletics: 'proficient' },
    proficiencies: { weapons: ['simple', 'martial'] },
    inventory: [
      { uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand' },
      { uid: 'bow', itemId: 'longbow', quantity: 1 },
    ],
  });
const goblin = (id: string): Creature => monsterToCreature(db.monsters.get('goblin_warrior')!, id, 'Goblin');

/** Hero at (2,2), goblin at `gx`,2 (and an ally at 2,3); the given creature's turn. */
function setup(gx = 3, turnOf = 'hero'): CombatState {
  const list = [
    { c: hero(), side: 'party' as const, x: 2, y: 2 },
    { c: { ...hero(), id: 'ally', name: 'Mira' } as Character, side: 'party' as const, x: 2, y: 3 },
    { c: goblin('g1'), side: 'enemy' as const, x: gx, y: 2 },
  ];
  const grid = createGrid(20, 20);
  for (const p of list) placeToken(grid, { id: p.c.id, x: p.x, y: p.y, size: p.c.size });
  const turns = startCombat(list.map((p, i) => ({ id: p.c.id, side: p.side, initiative: 20 - i, dexMod: 0 })));
  const idx = turns.order.findIndex((e) => e.id === turnOf);
  return { grid, turns: { ...turns, round: 1, currentIndex: idx, turnActive: true }, creatures: Object.fromEntries(list.map((p) => [p.c.id, p.c])) };
}

const ctx = (msgs?: Messages, ...faces: number[]): CombatContext => ({ rng: fixed(...faces), db, ...(msgs && { msgs }) });
const text = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const err = (r: { ok: boolean; error?: string }) => (r.ok ? '' : r.error);

describe('combat actions (A141f)', () => {
  it('English lines are unchanged', () => {
    expect(text(dash(setup(), ctx(), 'hero'))).toBe('Brenna Dashes (action).');
    expect(text(disengage(setup(), ctx(), 'hero', { bonus: true }))).toBe('Brenna Disengages (Bonus Action).');
    expect(text(dodge(setup(), ctx(), 'hero'))).toBe('Brenna takes the Dodge action.');
    expect(text(moveCreature(setup(8), ctx(), 'hero', [{ x: 1, y: 2 }, { x: 0, y: 2 }]))).toBe('Brenna moves 10 ft.');
    const used = spend(spend(setup().turns, 'hero', 'action').state, 'hero', 'action');
    expect(err(used)).toBe('action already used this turn');
  });

  it('Dash, Disengage, Dodge, Help in Danish', () => {
    expect(text(dash(setup(), ctx(da), 'hero'))).toBe('Brenna spurter (handling).');
    expect(text(disengage(setup(), ctx(da), 'hero', { bonus: true }))).toBe('Brenna trækker sig ud (bonushandling).');
    expect(text(dodge(setup(), ctx(da), 'hero'))).toBe('Brenna undviger.');
    expect(text(help(setup(), ctx(da), 'hero', { mode: 'attack', targetId: 'g1' }))).toBe('Brenna distraherer Goblin: næste allierede angreb mod den har fordel.');
    expect(err(help(setup(8), ctx(da), 'hero', { mode: 'attack', targetId: 'g1' }))).toBe('Goblin skal være inden for 5 fod for at kunne distraheres');
    expect(text(help(setup(), ctx(da), 'hero', { mode: 'check', allyId: 'ally', skill: 'athletics' }))).toMatch(/^Brenna hjælper Mira med athletics: fordel på næste prøve\.$/);
  });

  it('action economy and movement errors in Danish', () => {
    const s = setup();
    const once = spend(s.turns, 'hero', 'action', s.creatures.hero, undefined, da);
    expect(err(spend(once.state, 'hero', 'action', s.creatures.hero, undefined, da))).toBe('Handlingen er allerede brugt i denne tur');
    expect(err(spend(s.turns, 'g1', 'action', s.creatures.g1, undefined, da))).toBe('Det er ikke Goblin, der har turen');
    expect(standUp(s.turns, 'hero', s.creatures.hero!, undefined, da)).toMatchObject({ ok: false, error: 'Brenna ligger ikke ned (Prone)' });
    expect(err(moveCreature(setup(), ctx(da), 'hero', [{ x: 3, y: 2 }]))).toMatch(/^Skridt 0 til \(3,2\) er blokeret$/);
  });

  it('moves and Opportunity Attacks in Danish', () => {
    expect(text(moveCreature(setup(8), ctx(da), 'hero', [{ x: 1, y: 2 }, { x: 0, y: 2 }]))).toBe('Brenna bevæger sig 10 fod.');
    const s = setup(3, 'g1');
    const log = text(moveCreature(s, ctx(da, 15, 3), 'g1', [{ x: 4, y: 2 }, { x: 5, y: 2 }]));
    expect(log).toMatch(/^Brenna laver et lejlighedsangreb mod Goblin\.$/m);
    expect(log).toMatch(/^Goblin bevæger sig 0 fod og bliver standset\.$/m);
  });

  it('Grapple, Shove, escape in Danish', () => {
    const g = grapple(setup(), ctx(da, 1), 'hero', 'g1');
    expect(text(g)).toMatch(/^Brenna prøver at gribe Goblin — d20: 1 .* mod SG 13 — Fiasko\nGoblin bliver grebet af Brenna \(Grappled, flugt-SG 13\)\.$/);
    const esc = escapeGrapple({ ...g.state, turns: { ...g.state.turns, currentIndex: g.state.turns.order.findIndex((e) => e.id === 'g1') } }, ctx(da, 20), 'g1');
    expect(text(esc)).toMatch(/^Goblin prøver at vride sig fri — .*\nGoblin slipper fri\.$/);
    expect(text(shove(setup(), ctx(da, 1), 'hero', 'g1', { effect: 'prone' }))).toMatch(/Goblin bliver skubbet omkuld \(Prone\)\.$/);
    expect(text(shove(setup(), ctx(da, 1), 'hero', 'g1', { effect: 'push' }))).toMatch(/Goblin bliver skubbet 5 fod\.$/);
  });

  it('Ready and its trigger in Danish', () => {
    const r = ready(setup(), ctx(da), 'hero', da.m('act.trigger.reach'), { kind: 'attack', profileId: 'weapon:ls:melee' });
    expect(text(r)).toBe('Brenna holder klar: "en fjende kommer inden for nærkampsrækkevidde".');
    const t = triggerReadied(r.state, ctx(da, 15, 3), 'hero', { targetId: 'g1' });
    expect(text(t).split('\n')[0]).toBe('Klargjort handling udløses (Brenna): "en fjende kommer inden for nærkampsrækkevidde".');
  });

  it('attack checks and crit damage in Danish', () => {
    const profile = characterAttackProfile(setup().creatures.hero as Character, db, 'bow')!;
    const sword = characterAttackProfile(setup().creatures.hero as Character, db, 'ls')!;
    expect(checkAttack(setup(8), ctx(da), 'hero', 'g1', sword).error).toBe('Goblin er uden for rækkevidde (30 fod > 5 fod)');
    expect(checkAttack(setup(3), ctx(da), 'hero', 'g1', profile).disadvantage).toContain('Fjende inden for 5 fod (Goblin)');
    expect(checkAttack(setup(3), ctx(), 'hero', 'g1', profile).disadvantage).toContain('Enemy within 5 ft (Goblin)');
    expect(rollDamage(fixed(3, 4), [{ dice: '1d8', type: 'slashing' }], { crit: true, msgs: da }).text).toMatch(/^Kritisk! 2d8 huggende/);
    expect(rollDamage(fixed(3, 4), [{ dice: '1d8', type: 'slashing' }], { crit: true }).text).toMatch(/^Critical! 2d8 slashing/);
  });

  it('AI plan lines in Danish', () => {
    const near = takeAiTurn(setup(3, 'g1'), ctx(da, 10, 3), 'g1');
    expect(near.events[0]!.text).toMatch(/^Goblin angriber (Brenna|Mira)\.$/);
    const far = takeAiTurn(setup(19, 'g1'), ctx(da, 10, 3), 'g1');
    expect(far.events[0]!.text).toMatch(/^Goblin (rykker ind på|angriber) (Brenna|Mira)( \(spurt\))?\.$/);
    expect(takeAiTurn(setup(3, 'g1'), ctx(undefined, 10, 3), 'g1').events[0]!.text).toMatch(/^Goblin attacks (Brenna|Mira)\.$/);
  });
});
