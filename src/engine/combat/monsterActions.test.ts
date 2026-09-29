import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character, type Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { hasCondition } from '../rules/conditions';
import { actionRiders, monsterToCreature } from '../rules/monsters';
import { escapeGrapple, releaseGrapple } from './actions';
import { resolveAttack } from './attack';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, placeToken } from './grid';
import { monsterSaveAction, multiattackSaveActions } from './monsterActions';
import { influence, study, useMagicItem, usableMagicItems, utilize } from './otherActions';
import { planTurn, takeAiTurn } from './ai';
import { startCombat } from './turns';

const db = loadSrd();

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}

const ctx = (...faces: number[]): CombatContext => ({ rng: fixed(...faces), db });

function hero(id = 'hero', over: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    id,
    name: id === 'hero' ? 'Brenna' : id,
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 14 },
    proficiencyBonus: 2,
    maxHp: 30,
    hp: 30,
    ac: 16,
    speed: { walk: 30 },
    classes: [{ classId: 'fighter', level: 3 }],
    speciesId: 'human',
    backgroundId: 'soldier',
    proficiencies: { weapons: ['simple', 'martial'] },
    skills: { persuasion: 'proficient', history: 'proficient' },
    inventory: [{ uid: 'pot', itemId: 'potion_of_healing', quantity: 2 }],
    ...over,
  });
}

const monster = (statId: string, id: string): Creature => monsterToCreature(db.monsters.get(statId)!, id, id);

interface Placed {
  c: Creature;
  side: 'party' | 'enemy';
  x: number;
  y: number;
}

function setup(list: Placed[], turnOf?: string): CombatState {
  const grid = createGrid(20, 20);
  for (const p of list) placeToken(grid, { id: p.c.id, x: p.x, y: p.y, size: p.c.size });
  const turns = startCombat(list.map((p, i) => ({ id: p.c.id, side: p.side, initiative: 20 - i, dexMod: 0 })));
  const idx = turns.order.findIndex((e) => e.id === (turnOf ?? list[0]!.c.id));
  return { grid, turns: { ...turns, round: 1, currentIndex: idx, turnActive: true }, creatures: Object.fromEntries(list.map((p) => [p.c.id, p.c])) };
}

const action = (statId: string, name: string) => db.monsters.get(statId)!.actions.find((a) => a.name === name)!;

describe('stat-block riders (parsing)', () => {
  it('reads Grappled + escape DC, size limits, follow-up saves, durations', () => {
    expect(actionRiders(action('bugbear_warrior', 'Grab'))).toEqual([{ condition: 'grappled', maxSize: 'medium', escapeDc: 12 }]);
    expect(actionRiders(action('brown_bear', 'Claw'))).toEqual([{ condition: 'prone', maxSize: 'large' }]);
    expect(actionRiders(action('ghoul', 'Claw'))).toEqual([{ condition: 'paralyzed', untilEndOfNextTurn: true, save: { ability: 'con', dc: 10 }, excludeTypes: ['undead'] }]);
    expect(actionRiders(action('giant_constrictor_snake', 'Constrict'))).toEqual([{ condition: 'grappled', maxSize: 'large', escapeDc: 14 }]);
    expect(actionRiders(action('mummy', 'Dreadful Glare'))).toEqual([{ condition: 'frightened', untilEndOfNextTurn: true }]);
    // "until the web is destroyed" isn't modelled: skipped rather than permanent.
    expect(actionRiders(action('giant_spider', 'Web'))).toEqual([]);
  });

  it('Multiattack save parts are found', () => {
    expect(multiattackSaveActions(monster('giant_constrictor_snake', 's'), ctx())).toEqual(['Constrict']);
    expect(multiattackSaveActions(monster('brown_bear', 'b'), ctx())).toEqual([]);
  });
});

describe('stat-block riders on a hit', () => {
  it('a bear Claw knocks a Medium target Prone, not a Gargantuan one', () => {
    const s = setup([
      { c: monster('brown_bear', 'bear'), side: 'enemy', x: 0, y: 0 },
      { c: hero(), side: 'party', x: 1, y: 0 },
    ]);
    const r = resolveAttack(s, ctx(18, 3), { attackerId: 'bear', targetId: 'hero', profile: 'monster:Claw' });
    if (!r.ok) throw new Error(r.error);
    expect(r.hit).toBe(true);
    expect(hasCondition(r.state.creatures.hero!, 'prone')).toBe(true);
    const huge = { ...s, creatures: { ...s.creatures, hero: { ...s.creatures.hero!, size: 'gargantuan' as const } } };
    const r2 = resolveAttack(huge, ctx(18, 3), { attackerId: 'bear', targetId: 'hero', profile: 'monster:Claw' });
    expect(r2.ok && hasCondition(r2.state.creatures.hero!, 'prone')).toBe(false);
  });

  it('a bugbear Grab grapples with the printed escape DC; escaping and releasing work', () => {
    const s = setup([
      { c: monster('bugbear_warrior', 'bug'), side: 'enemy', x: 0, y: 0 },
      { c: hero(), side: 'party', x: 1, y: 0 },
    ]);
    const r = resolveAttack(s, ctx(18, 3, 3), { attackerId: 'bug', targetId: 'hero', profile: 'monster:Grab' });
    if (!r.ok) throw new Error(r.error);
    const h = r.state.creatures.hero!;
    expect(hasCondition(h, 'grappled')).toBe(true);
    expect(h.effects.find((e) => e.key === 'grappled_by')?.data.dc).toBe(12);
    expect(r.events.some((e) => e.text.includes('escape DC 12'))).toBe(true);
    const heroTurn = { ...r.state, turns: { ...r.state.turns, currentIndex: 1 } };
    const esc = escapeGrapple(heroTurn, ctx(15), 'hero');
    expect(esc.ok && esc.success).toBe(true);
    expect(hasCondition(releaseGrapple(r.state, 'bug', 'hero').creatures.hero!, 'grappled')).toBe(false);
  });

  it('a ghoul Claw paralyzes on a failed Con save (1 round); Undead are unaffected', () => {
    const s = setup([
      { c: monster('ghoul', 'gh'), side: 'enemy', x: 0, y: 0 },
      { c: hero(), side: 'party', x: 1, y: 0 },
      { c: monster('zombie', 'z'), side: 'party', x: 0, y: 1 },
    ]);
    const r = resolveAttack(s, ctx(18, 2, 2), { attackerId: 'gh', targetId: 'hero', profile: 'monster:Claw' });
    if (!r.ok) throw new Error(r.error);
    const par = r.state.creatures.hero!.conditions.find((c) => c.condition === 'paralyzed');
    expect(par?.roundsLeft).toBe(1);
    expect(r.events.some((e) => e.kind === 'save' && e.text.includes('Constitution save'))).toBe(true);
    const saved = resolveAttack(s, ctx(18, 2, 19), { attackerId: 'gh', targetId: 'hero', profile: 'monster:Claw' });
    expect(saved.ok && hasCondition(saved.state.creatures.hero!, 'paralyzed')).toBe(false);
    const undead = resolveAttack(s, ctx(18, 2, 1), { attackerId: 'gh', targetId: 'z', profile: 'monster:Claw' });
    expect(undead.ok && hasCondition(undead.state.creatures.z!, 'paralyzed')).toBe(false);
  });
});

describe('single-target save actions', () => {
  it('Constrict is one part of the snake’s Multiattack: damage + Grappled on a failure, range checked', () => {
    const s = setup([
      { c: monster('giant_constrictor_snake', 'snake'), side: 'enemy', x: 0, y: 0 },
      { c: hero(), side: 'party', x: 2, y: 0 },
      { c: hero('far'), side: 'party', x: 8, y: 0 },
    ]);
    expect(monsterSaveAction(s, ctx(), 'snake', 'Constrict', 'far').ok).toBe(false); // beyond 10 ft
    const bite = resolveAttack(s, ctx(18, 3, 3), { attackerId: 'snake', targetId: 'hero', profile: 'monster:Bite' });
    if (!bite.ok) throw new Error(bite.error);
    expect(bite.state.turns.budgets.snake!.attacksLeft).toBe(1);
    const c = monsterSaveAction(bite.state, ctx(2, 4, 4), 'snake', 'Constrict', 'hero');
    if (!c.ok) throw new Error(c.error);
    expect(c.saved).toBe(false);
    expect(c.damage).toBeGreaterThan(0);
    expect(hasCondition(c.state.creatures.hero!, 'grappled')).toBe(true);
    expect(c.state.turns.budgets.snake!.attacksLeft).toBe(0);
    // The Attack action is used up now.
    expect(monsterSaveAction(c.state, ctx(2), 'snake', 'Constrict', 'hero').ok).toBe(false);
  });

  it('Dreadful Glare frightens on a failure; a success does nothing', () => {
    const s = setup([
      { c: monster('mummy', 'mum'), side: 'enemy', x: 0, y: 0 },
      { c: hero(), side: 'party', x: 5, y: 0 },
    ]);
    const fail = monsterSaveAction(s, ctx(2), 'mum', 'Dreadful Glare', 'hero');
    if (!fail.ok) throw new Error(fail.error);
    expect(fail.state.creatures.hero!.conditions.find((c) => c.condition === 'frightened')?.roundsLeft).toBe(1);
    const ok = monsterSaveAction(s, ctx(19), 'mum', 'Dreadful Glare', 'hero');
    expect(ok.ok && ok.saved).toBe(true);
    expect(ok.ok && hasCondition(ok.state.creatures.hero!, 'frightened')).toBe(false);
  });

  it('the AI snake bites and constricts in one turn', () => {
    const s = setup([
      { c: monster('giant_constrictor_snake', 'snake'), side: 'enemy', x: 0, y: 0 },
      { c: hero(), side: 'party', x: 1, y: 0 },
    ]);
    const plan = planTurn(s, ctx(), 'snake');
    expect(plan.steps.map((x) => x.kind)).toEqual(['attack', 'monster_action']);
    const r = takeAiTurn(s, ctx(18, 3, 3, 2, 4, 4), 'snake');
    if (!r.ok) throw new Error(r.error);
    expect(r.events.some((e) => e.text.includes('uses Constrict'))).toBe(true);
    expect(hasCondition(r.state.creatures.hero!, 'grappled')).toBe(true);
  });
});

describe('Study, Influence, Utilize, Magic', () => {
  const two = () =>
    setup([
      { c: hero(), side: 'party', x: 0, y: 0 },
      { c: hero('ally'), side: 'party', x: 1, y: 0 },
      { c: monster('ogre', 'ogre'), side: 'enemy', x: 5, y: 0 },
    ]);

  it('Study: an Intelligence check with the chosen skill, costs the Action', () => {
    const r = study(two(), ctx(15), 'hero', { skill: 'history', topic: 'the ogre’s war paint' });
    if (!r.ok) throw new Error(r.error);
    expect(r.success).toBe(true);
    expect(r.events[0]!.text).toContain('History');
    expect(study(r.state, ctx(15), 'hero', { skill: 'history', topic: 'again' }).ok).toBe(false);
  });

  it('Influence: DC 15 or the target’s Intelligence, whichever is higher', () => {
    const s = two();
    const r = influence(s, ctx(10), 'hero', 'ogre', { skill: 'persuasion' });
    if (!r.ok) throw new Error(r.error);
    expect(r.dc).toBe(15);
    expect(r.success).toBe(false); // 10 + 2 (Cha) + 2 (PB) = 14
    const smart = { ...s, creatures: { ...s.creatures, ogre: { ...s.creatures.ogre!, abilities: { ...s.creatures.ogre!.abilities, int: 18 } } } };
    const r2 = influence(smart, ctx(10), 'hero', 'ogre', { skill: 'intimidation' });
    expect(r2.ok && r2.dc).toBe(18);
  });

  it('Utilize spends the Action', () => {
    const r = utilize(two(), ctx(), 'hero', 'the portcullis lever');
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turns.budgets.hero!.action).toBe(false);
    expect(r.events[0]!.text).toContain('portcullis lever');
  });

  it('Magic: a potion of healing is a Bonus Action, heals, is used up, can be given within 5 ft', () => {
    const s = two();
    const hurt = { ...s, creatures: { ...s.creatures, hero: { ...s.creatures.hero!, hp: 10 }, ally: { ...s.creatures.ally!, hp: 5 } } };
    expect(usableMagicItems(hurt.creatures.hero!, ctx())).toEqual([{ uid: 'pot', itemId: 'potion_of_healing', name: 'Potion of Healing', bonusAction: true }]);
    const r = useMagicItem(hurt, ctx(3, 3), 'hero', 'pot', 'ally');
    if (!r.ok) throw new Error(r.error);
    expect(r.state.creatures.ally!.hp).toBe(13); // 3 + 3 + 2
    expect(r.state.turns.budgets.hero!.bonusAction).toBe(false);
    expect(r.state.turns.budgets.hero!.action).toBe(true);
    expect((r.state.creatures.hero as Character).inventory.find((i) => i.uid === 'pot')?.quantity).toBe(1);
    expect(useMagicItem(hurt, ctx(3, 3), 'hero', 'pot', 'ogre').ok).toBe(false); // too far
  });
});
