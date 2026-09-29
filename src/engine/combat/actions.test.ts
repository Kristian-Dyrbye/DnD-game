import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character, type Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { addEffect, hasEffect } from '../rules/activeEffects';
import { applyCondition, hasCondition } from '../rules/conditions';
import { monsterToCreature } from '../rules/monsters';
import { dodgeSaveModes, hideDc, isHidden } from './actionEffects';
import { dash, disengage, dodge, escapeGrapple, grapple, help, hide, moveCreature, ready, searchFor, settleGrapples, shove, triggerReadied } from './actions';
import { attackProfiles, checkAttack, characterAttackProfile, pushAway, resolveAttack } from './attack';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, placeToken, setEdge } from './grid';
import { startCombat } from './turns';

const db = loadSrd();

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}

function hero(id = 'hero', over: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    id,
    name: id === 'hero' ? 'Brenna' : id,
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
    proficiencies: { weapons: ['simple', 'martial'] },
    inventory: [
      { uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand' },
      { uid: 'bow', itemId: 'longbow', quantity: 1 },
      { uid: 'maul', itemId: 'maul', quantity: 1 },
      { uid: 'rapier', itemId: 'rapier', quantity: 1 },
      { uid: 'gs', itemId: 'greatsword', quantity: 1 },
      { uid: 'axe', itemId: 'greataxe', quantity: 1 },
      { uid: 'hammer', itemId: 'warhammer', quantity: 1 },
      { uid: 'dg', itemId: 'dagger', quantity: 1, equipped: 'off_hand' },
    ],
    ...over,
  });
}

const goblin = (id: string): Creature => monsterToCreature(db.monsters.get('goblin_warrior')!, id, id);
const ogre = (id: string): Creature => monsterToCreature(db.monsters.get('ogre')!, id, id);

interface Placed {
  c: Creature;
  side: 'party' | 'enemy';
  x: number;
  y: number;
}

function setup(list: Placed[], turnOf?: string, width = 20): CombatState {
  const grid = createGrid(width, 20);
  for (const p of list) placeToken(grid, { id: p.c.id, x: p.x, y: p.y, size: p.c.size });
  const turns = startCombat(list.map((p, i) => ({ id: p.c.id, side: p.side, initiative: 20 - i, dexMod: 0 })));
  const idx = turns.order.findIndex((e) => e.id === (turnOf ?? list[0]!.c.id));
  return { grid, turns: { ...turns, round: 1, currentIndex: idx, turnActive: true }, creatures: Object.fromEntries(list.map((p) => [p.c.id, p.c])) };
}

const ctx = (...faces: number[]): CombatContext => ({ rng: fixed(...faces), db });
const P = (uid: string, mode: 'melee' | 'ranged' = 'melee') => `weapon:${uid}:${mode}`;

describe('attack roll pipeline', () => {
  it('hit: visible math line and damage', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const r = resolveAttack(s, ctx(14, 6), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hit).toBe(true);
    expect(r.events[0]!.text).toContain('d20: 14 + 3 (Strength) + 2 (Proficiency) = 19 vs AC 15 — Hit');
    expect(r.damage).toBe(9);
    expect(r.state.creatures.g1!.hp).toBe(1);
    expect(s.creatures.g1!.hp).toBe(10); // input untouched
  });

  it('natural 1 misses, natural 20 crits (dice doubled) and kills', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const miss = resolveAttack(s, ctx(1), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    expect(miss.ok && miss.hit).toBe(false);
    const crit = resolveAttack(s, ctx(20, 4, 5), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    expect(crit.ok && crit.crit).toBe(true);
    if (!crit.ok) return;
    expect(crit.damage).toBe(12); // (4 + 5) + 3
    expect(crit.state.creatures.g1!.dead).toBe(true);
  });

  it('long range gives Disadvantage; beyond long range is refused', () => {
    const s = setup(
      [
        { c: hero(), side: 'party', x: 0, y: 0 },
        { c: goblin('near'), side: 'enemy', x: 10, y: 0 },
        { c: goblin('far'), side: 'enemy', x: 40, y: 0 },
        { c: goblin('gone'), side: 'enemy', x: 150, y: 0 },
      ],
      undefined,
      160,
    );
    const bow = characterAttackProfile(s.creatures.hero as Character, db, 'bow')!;
    expect(checkAttack(s, ctx(), 'hero', 'near', bow).disadvantage).toEqual([]);
    expect(checkAttack(s, ctx(), 'hero', 'far', bow).disadvantage).toContain('Long range');
    const gone = checkAttack(s, ctx(), 'hero', 'gone', bow);
    expect(gone.ok).toBe(false);
    expect(gone.error).toMatch(/out of range/);
    const ls = characterAttackProfile(s.creatures.hero as Character, db, 'ls')!;
    expect(checkAttack(s, ctx(), 'hero', 'near', ls).error).toMatch(/out of reach/);
  });

  it('ranged attack with a hostile within 5 ft has Disadvantage unless that enemy is Incapacitated', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('adj'), side: 'enemy', x: 1, y: 1 },
      { c: goblin('far'), side: 'enemy', x: 8, y: 0 },
    ]);
    const bow = characterAttackProfile(s.creatures.hero as Character, db, 'bow')!;
    expect(checkAttack(s, ctx(), 'hero', 'far', bow).disadvantage.some((d) => d.startsWith('Enemy within 5 ft'))).toBe(true);
    const stunned = { ...s, creatures: { ...s.creatures, adj: applyCondition(s.creatures.adj!, { condition: 'incapacitated' }).creature } };
    expect(checkAttack(stunned, ctx(), 'hero', 'far', bow).disadvantage).toEqual([]);
  });

  it('cover from a creature in the way adds +2 AC; a wall gives Total Cover', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 5 },
      { c: hero('ally'), side: 'party', x: 3, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 6, y: 5 },
    ]);
    const bow = characterAttackProfile(s.creatures.hero as Character, db, 'bow')!;
    const c = checkAttack(s, ctx(), 'hero', 'g1', bow);
    expect(c.cover).toBe('half');
    expect(c.ac).toBe(17);
    const walled = setup([
      { c: hero(), side: 'party', x: 0, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 6, y: 5 },
    ]);
    for (let y = 0; y < 20; y++) setEdge(walled.grid, 3, y, 'E', { kind: 'wall' } as never);
    expect(checkAttack(walled, ctx(), 'hero', 'g1', bow).error).toMatch(/Total Cover/);
  });

  it('Extra Attack: level 5 fighter makes two attacks per action; a third is refused', () => {
    const s = setup([
      { c: hero('hero', { classes: [{ classId: 'fighter', level: 5 }], proficiencyBonus: 3 }), side: 'party', x: 0, y: 0 },
      { c: ogre('o'), side: 'enemy', x: 1, y: 0 },
    ]);
    const a1 = resolveAttack(s, ctx(2), { attackerId: 'hero', targetId: 'o', profile: P('ls') });
    expect(a1.ok && a1.attacksLeft).toBe(1);
    if (!a1.ok) return;
    const a2 = resolveAttack(a1.state, ctx(2), { attackerId: 'hero', targetId: 'o', profile: P('ls') });
    expect(a2.ok && a2.attacksLeft).toBe(0);
    if (!a2.ok) return;
    const a3 = resolveAttack(a2.state, ctx(2), { attackerId: 'hero', targetId: 'o', profile: P('ls') });
    expect(a3.ok).toBe(false);
    if (!a3.ok) expect(a3.error).toMatch(/already used/);
    // level 3: only one
    const s3 = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: ogre('o'), side: 'enemy', x: 1, y: 0 },
    ]);
    const b1 = resolveAttack(s3, ctx(2), { attackerId: 'hero', targetId: 'o', profile: P('ls') });
    expect(b1.ok && b1.attacksLeft).toBe(0);
    if (b1.ok) expect(resolveAttack(b1.state, ctx(2), { attackerId: 'hero', targetId: 'o' }).ok).toBe(false);
  });

  it("attacks only on the attacker's turn (except reactions)", () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ], 'g1');
    const r = resolveAttack(s, ctx(15), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    expect(r.ok).toBe(false);
  });

  it('monster stat-block attacks resolve with printed bonus and damage', () => {
    const s = setup([
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
      { c: hero(), side: 'party', x: 0, y: 0 },
    ]);
    expect(attackProfiles(s.creatures.g1!, db).map((p) => p.id)).toEqual(['monster:Scimitar', 'monster:Shortbow']);
    const r = resolveAttack(s, ctx(12, 3), { attackerId: 'g1', targetId: 'hero', profile: 'monster:Scimitar' });
    expect(r.ok && r.hit).toBe(true);
    if (!r.ok) return;
    expect(r.events[0]!.text).toContain('d20: 12 + 4 (Scimitar) = 16 vs AC 16 — Hit');
    expect(r.state.creatures.hero!.hp).toBe(25);
  });
});

describe('weapon mastery', () => {
  const base = (masteries: string[]) =>
    setup([
      { c: hero('hero', { weaponMasteries: masteries }), side: 'party', x: 5, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 6, y: 5 },
      { c: goblin('g2'), side: 'enemy', x: 6, y: 6 },
    ]);

  it('Topple: failed Con save → Prone', () => {
    const r = resolveAttack(base(['maul']), ctx(15, 1, 1, 2), { attackerId: 'hero', targetId: 'g1', profile: P('maul') });
    expect(r.ok && r.hit).toBe(true);
    if (!r.ok) return;
    expect(hasCondition(r.state.creatures.g1!, 'prone')).toBe(true);
    expect(r.events.some((e) => e.text.includes('Topple'))).toBe(true);
  });

  it('Vex: Advantage on the next attack against that target', () => {
    const r = resolveAttack(base(['rapier']), ctx(15, 1), { attackerId: 'hero', targetId: 'g1', profile: P('rapier') });
    expect(r.ok && r.hit).toBe(true);
    if (!r.ok) return;
    const rapier = characterAttackProfile(r.state.creatures.hero as Character, db, 'rapier')!;
    expect(checkAttack(r.state, ctx(), 'hero', 'g1', rapier).advantage).toContain('Vex');
    expect(checkAttack(r.state, ctx(), 'hero', 'g2', rapier).advantage).not.toContain('Vex');
  });

  it("Sap: the target's next attack has Disadvantage", () => {
    const r = resolveAttack(base(['longsword']), ctx(15, 1), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    if (!r.ok) throw new Error(r.error);
    const scim = attackProfiles(r.state.creatures.g1!, db)[0]!;
    expect(checkAttack(r.state, ctx(), 'g1', 'hero', scim).disadvantage).toContain('Sapped');
  });

  it('Graze: a miss deals the ability modifier', () => {
    const r = resolveAttack(base(['greatsword']), ctx(2), { attackerId: 'hero', targetId: 'g1', profile: P('gs') });
    expect(r.ok && r.hit).toBe(false);
    if (!r.ok) return;
    expect(r.damage).toBe(3);
    expect(r.state.creatures.g1!.hp).toBe(7);
  });

  it('Cleave: second target within 5 ft of the first, once per turn, no ability mod to damage', () => {
    const r = resolveAttack(base(['greataxe']), ctx(15, 1), { attackerId: 'hero', targetId: 'g1', profile: P('axe') });
    expect(r.ok && r.cleaveAvailable).toBe(true);
    if (!r.ok) return;
    const c = resolveAttack(r.state, ctx(15, 4), { attackerId: 'hero', targetId: 'g2', profile: P('axe'), kind: 'cleave', cleaveFromId: 'g1' });
    expect(c.ok && c.damage).toBe(4);
    if (!c.ok) return;
    const again = resolveAttack(c.state, ctx(15, 4), { attackerId: 'hero', targetId: 'g2', profile: P('axe'), kind: 'cleave', cleaveFromId: 'g1' });
    expect(again.ok).toBe(false);
  });

  it('Push: target moves 10 ft straight away', () => {
    const r = resolveAttack(base(['warhammer']), ctx(15, 1), { attackerId: 'hero', targetId: 'g1', profile: P('hammer') });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.grid.tokens.g1).toMatchObject({ x: 8, y: 5 });
  });

  it('Nick: the Light extra attack inside the Attack action, once per turn; Light bonus attack adds no ability mod', () => {
    const s = base(['dagger']);
    const nickFirst = resolveAttack(s, ctx(15, 2), { attackerId: 'hero', targetId: 'g1', profile: P('dg'), kind: 'nick' });
    expect(nickFirst.ok).toBe(false); // Attack action not taken yet
    const a = resolveAttack(s, ctx(2), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    if (!a.ok) throw new Error(a.error);
    const n = resolveAttack(a.state, ctx(15, 2), { attackerId: 'hero', targetId: 'g1', profile: P('dg'), kind: 'nick' });
    if (!n.ok) throw new Error(n.error);
    expect(n.damage).toBe(2);
    expect(n.state.turns.budgets.hero!.bonusAction).toBe(true);
    expect(resolveAttack(n.state, ctx(15, 2), { attackerId: 'hero', targetId: 'g1', profile: P('dg'), kind: 'nick' }).ok).toBe(false);
    const lb = resolveAttack(a.state, ctx(15, 2), { attackerId: 'hero', targetId: 'g1', profile: P('dg'), kind: 'light_bonus' });
    expect(lb.ok && lb.damage).toBe(2);
    expect(resolveAttack(a.state, ctx(15, 2), { attackerId: 'hero', targetId: 'g1', profile: P('ls'), kind: 'light_bonus' }).ok).toBe(false);
  });

  it('no mastery without the weapon mastery known', () => {
    const r = resolveAttack(base([]), ctx(15, 1, 1, 2), { attackerId: 'hero', targetId: 'g1', profile: P('maul') });
    if (!r.ok) throw new Error(r.error);
    expect(hasCondition(r.state.creatures.g1!, 'prone')).toBe(false);
  });
});

describe('Dash, Disengage, Dodge and the action economy', () => {
  it('Dash then Attack is refused (one action); Dash as a bonus action is allowed', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const d = dash(s, ctx(), 'hero');
    if (!d.ok) throw new Error(d.error);
    expect(d.state.turns.budgets.hero!.dashes).toBe(1);
    const a = resolveAttack(d.state, ctx(15), { attackerId: 'hero', targetId: 'g1', profile: P('ls') });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toMatch(/action already used/);
    const b = dash(d.state, ctx(), 'hero', { bonus: true });
    expect(b.ok && b.state.turns.budgets.hero!.dashes).toBe(2);
    expect(disengage(d.state, ctx(), 'hero').ok).toBe(false);
  });

  it('Dodge: attackers it can see have Disadvantage; Dex save Advantage; lost while Incapacitated', () => {
    const s = setup([
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
      { c: hero(), side: 'party', x: 0, y: 0 },
    ]);
    const d = dodge(s, ctx(), 'g1');
    if (!d.ok) throw new Error(d.error);
    const ls = characterAttackProfile(d.state.creatures.hero as Character, db, 'ls')!;
    expect(checkAttack(d.state, ctx(), 'hero', 'g1', ls).disadvantage).toContain('Dodge');
    expect(dodgeSaveModes(d.state.creatures.g1!, 'dex').advantage).toEqual(['Dodge']);
    const inc = { ...d.state, creatures: { ...d.state.creatures, g1: applyCondition(d.state.creatures.g1!, { condition: 'incapacitated' }).creature } };
    expect(checkAttack(inc, ctx(), 'hero', 'g1', ls).disadvantage).not.toContain('Dodge');
  });
});

describe('Help', () => {
  it('distracting an enemy gives the next ally attack Advantage, used once', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: hero('ally'), side: 'party', x: 1, y: 1 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const h = help(s, ctx(), 'hero', { mode: 'attack', targetId: 'g1' });
    if (!h.ok) throw new Error(h.error);
    const ls = characterAttackProfile(h.state.creatures.ally as Character, db, 'ls')!;
    expect(checkAttack(h.state, ctx(), 'ally', 'g1', ls).advantage.some((a) => a.startsWith('Help'))).toBe(true);
    const a = resolveAttack(h.state, ctx(3, 3, 1), { attackerId: 'ally', targetId: 'g1', profile: ls, kind: 'free' });
    if (!a.ok) throw new Error(a.error);
    expect(a.roll?.mode).toBe('advantage');
    expect(checkAttack(a.state, ctx(), 'ally', 'g1', ls).advantage.some((x) => x.startsWith('Help'))).toBe(false);
  });

  it('assisting a check needs proficiency and grants Advantage on that skill', () => {
    const s = setup([
      { c: hero('hero', { skills: { athletics: 'proficient' } }), side: 'party', x: 0, y: 0 },
      { c: hero('ally'), side: 'party', x: 1, y: 1 },
    ]);
    expect(help(s, ctx(), 'hero', { mode: 'check', allyId: 'ally', skill: 'stealth' }).ok).toBe(false);
    const h = help(s, ctx(), 'hero', { mode: 'check', allyId: 'ally', skill: 'athletics' });
    expect(h.ok && hasEffect(h.state.creatures.ally!, 'help_check')).toBe(true);
  });
});

describe('Hide and Search', () => {
  it('needs concealment from every enemy; DC 15 Stealth; success → Invisible with the total recorded', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 5, y: 0 },
    ]);
    const blocked = hide(s, ctx(20), 'hero');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.state.turns.budgets.hero!.action).toBe(true);
    const failed = hide(s, ctx(12), 'hero', { heavilyObscured: true });
    expect(failed.ok && failed.success).toBe(false);
    const ok = hide(s, ctx(13), 'hero', { heavilyObscured: true });
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.success).toBe(true);
    const h = ok.state.creatures.hero!;
    expect(hasCondition(h, 'invisible')).toBe(true);
    expect(hideDc(h)).toBe(15);
    // attacking reveals
    const a = resolveAttack({ ...ok.state, turns: { ...ok.state.turns, budgets: { ...ok.state.turns.budgets, hero: { ...ok.state.turns.budgets.hero!, action: true } } } }, ctx(2), {
      attackerId: 'hero',
      targetId: 'g1',
      profile: P('bow', 'ranged'),
    });
    if (!a.ok) throw new Error(a.error);
    expect(a.events[0]!.text).toContain('Invisible (attacker)');
    expect(isHidden(a.state.creatures.hero!)).toBe(false);
  });

  it('behind a wall (total cover) the hider may Hide; Search finds it with Perception ≥ total', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 5, y: 5 },
    ]);
    for (let y = 0; y < 20; y++) setEdge(s.grid, 2, y, 'E', { kind: 'wall' } as never);
    const ok = hide(s, ctx(14), 'hero');
    if (!ok.ok) throw new Error(ok.error);
    expect(hideDc(ok.state.creatures.hero!)).toBe(16);
    const goblinTurn = { ...ok.state, turns: { ...ok.state.turns, currentIndex: 1 } };
    const miss = searchFor(goblinTurn, ctx(5), 'g1', 'hero');
    expect(miss.ok && miss.found).toBe(false);
    const found = searchFor(goblinTurn, ctx(20), 'g1', 'hero');
    if (!found.ok) throw new Error(found.error);
    expect(found.found).toBe(true);
    expect(hasCondition(found.state.creatures.hero!, 'invisible')).toBe(false);
  });
});

describe('Grapple and Shove', () => {
  it('Grapple: size limit, better save chosen, Grappled on a failure, escape', () => {
    const huge = { ...ogre('huge'), size: 'huge' as const };
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: ogre('o'), side: 'enemy', x: 1, y: 0 },
      { c: huge, side: 'enemy', x: 0, y: 3 },
    ]);
    const tooBig = grapple(s, ctx(1), 'hero', 'huge');
    expect(tooBig.ok).toBe(false);
    const g = grapple(s, ctx(5), 'hero', 'o');
    if (!g.ok) throw new Error(g.error);
    expect(g.success).toBe(true);
    expect(g.events[0]!.text).toContain('Strength save');
    expect(g.events[0]!.text).toContain('vs DC 13');
    const o = g.state.creatures.o!;
    expect(hasCondition(o, 'grappled')).toBe(true);
    expect(g.state.turns.budgets.hero!.action).toBe(false);
    // ogre's turn: escape with Athletics (Str 19)
    const ogreTurn = { ...g.state, turns: { ...g.state.turns, currentIndex: 1 } };
    const esc = escapeGrapple(ogreTurn, ctx(10), 'o');
    if (!esc.ok) throw new Error(esc.error);
    expect(esc.success).toBe(true);
    expect(hasCondition(esc.state.creatures.o!, 'grappled')).toBe(false);
  });

  it('grapple ends when the grappler is Incapacitated or too far', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const g = grapple(s, ctx(1), 'hero', 'g1');
    if (!g.ok) throw new Error(g.error);
    const moved = { ...g.state, grid: pushAway(g.state.grid, 'hero', 'g1', 10).grid };
    const settled = settleGrapples(moved, ctx());
    expect(hasCondition(settled.state.creatures.g1!, 'grappled')).toBe(false);
  });

  it('Shove: Prone or pushed 5 ft on a failed save', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const prone = shove(s, ctx(1), 'hero', 'g1', { effect: 'prone' });
    expect(prone.ok && hasCondition(prone.state.creatures.g1!, 'prone')).toBe(true);
    const push = shove(s, ctx(1), 'hero', 'g1', { effect: 'push' });
    if (!push.ok) throw new Error(push.error);
    expect(push.state.grid.tokens.g1).toMatchObject({ x: 2, y: 0 });
    expect(s.grid.tokens.g1).toMatchObject({ x: 1, y: 0 });
    const saved = shove(s, ctx(20), 'hero', 'g1', { effect: 'prone' });
    expect(saved.ok && saved.success).toBe(false);
  });
});

describe('Opportunity Attacks and movement', () => {
  const start = () =>
    setup([
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
      { c: hero(), side: 'party', x: 0, y: 0 },
    ]);

  it('leaving reach provokes: the hero attacks with its Reaction', () => {
    const r = moveCreature(start(), ctx(15, 5), 'g1', [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.triggers).toHaveLength(1);
    expect(r.events.some((e) => e.text.includes('Opportunity Attack'))).toBe(true);
    expect(r.state.turns.budgets.hero!.reaction).toBe(false);
    expect(r.state.creatures.g1!.hp).toBe(2);
    expect(r.state.grid.tokens.g1).toMatchObject({ x: 3, y: 0 });
    expect(r.state.turns.budgets.g1!.movementSpentFt).toBe(10);
  });

  it('a killing Opportunity Attack halts the move', () => {
    const r = moveCreature(start(), ctx(20, 8, 8), 'g1', [{ x: 2, y: 0 }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.halted).toBe(true);
    expect(r.state.creatures.g1!.dead).toBe(true);
    expect(r.state.grid.tokens.g1).toMatchObject({ x: 1, y: 0 });
  });

  it('Disengage avoids it', () => {
    const d = disengage(start(), ctx(), 'g1', { bonus: true });
    if (!d.ok) throw new Error(d.error);
    const r = moveCreature(d.state, ctx(15, 5), 'g1', [{ x: 2, y: 0 }]);
    expect(r.ok && r.triggers).toEqual([]);
  });
});

describe('Ready', () => {
  it('stores a trigger; the Reaction resolves one attack', () => {
    const s = setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 1, y: 0 },
    ]);
    const r = ready(s, ctx(), 'hero', 'the goblin comes within reach', { kind: 'attack', profileId: P('ls') });
    if (!r.ok) throw new Error(r.error);
    const goblinTurn = { ...r.state, turns: { ...r.state.turns, currentIndex: 1 } };
    const t = triggerReadied(goblinTurn, ctx(15, 4), 'hero', { targetId: 'g1' });
    if (!t.ok) throw new Error(t.error);
    expect(t.attack?.hit).toBe(true);
    expect(t.state.turns.budgets.hero!.reaction).toBe(false);
    expect(hasEffect(t.state.creatures.hero!, 'readied')).toBe(false);
    expect(triggerReadied(t.state, ctx(), 'hero', { targetId: 'g1' }).ok).toBe(false);
  });

  it('dodge effect helper ignores unrelated abilities', () => {
    const c = addEffect(goblin('g'), { key: 'dodge' });
    expect(dodgeSaveModes(c, 'str').advantage).toEqual([]);
  });
});
