/** A141g: spells, zones, area effects, riders, masteries and other actions in English (unchanged) and Danish. */
import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import type { Character, Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages, type Messages } from '../i18n';
import { autoLevelTo } from '../party/companions';
import { addEffect } from '../rules/activeEffects';
import { applyMasteryOnHit } from '../rules/mastery';
import { monsterToCreature } from '../rules/monsters';
import { endOfTurnSpellEffects } from '../rules/spellHooks2';
import { slotProblem } from '../rules/spellcasting';
import { moveCreature } from './actions';
import { castInCombat, reachProblem } from './castAction';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, placeToken } from './grid';
import { study, useMagicItem } from './otherActions';
import { startCombat } from './turns';
import { escapeZone } from './zones';

const db = loadSrd();
const da = messages('da');

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}
const ctx = (msgs?: Messages, ...faces: number[]): CombatContext => ({ rng: fixed(...faces), db, ...(msgs && { msgs }) });
const text = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');

function caster(classId: string, level: number, spells: string[]): Character {
  const c = autoLevelTo(buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(classId))), db), level, db);
  if (!c.spellcasting) return { ...c, id: 'me', name: 'Brenna' };
  return { ...c, id: 'me', name: 'Brenna', spellcasting: { ...c.spellcasting, prepared: [...c.spellcasting.prepared, ...spells.map((spellId) => ({ spellId, classId }))] } };
}
const goblin = (id: string, name = 'Goblin'): Creature => monsterToCreature(db.monsters.get('goblin_warrior')!, id, name);

function setup(list: { c: Creature; side: 'party' | 'enemy'; x: number; y: number }[]): CombatState {
  const grid = createGrid(20, 20);
  for (const p of list) placeToken(grid, { id: p.c.id, x: p.x, y: p.y, size: p.c.size });
  const turns = startCombat(list.map((p, i) => ({ id: p.c.id, side: p.side, initiative: 20 - i, dexMod: 0 })));
  return { grid, turns: { ...turns, round: 1, currentIndex: 0, turnActive: true }, creatures: Object.fromEntries(list.map((p) => [p.c.id, p.c])) };
}

function turnOf(s: CombatState, id: string): CombatState {
  const idx = s.turns.order.findIndex((e) => e.id === id);
  return { ...s, turns: { ...s.turns, round: s.turns.round + 1, currentIndex: idx, turnActive: true, budgets: { ...s.turns.budgets, [id]: { action: true, bonusAction: true, reaction: true, movementSpentFt: 0, dashes: 0, disengaged: false, objectInteraction: true } } } };
}

const wizardFight = () =>
  setup([
    { c: caster('wizard', 5, ['web', 'fireball']), side: 'party', x: 0, y: 5 },
    { c: goblin('g1'), side: 'enemy', x: 12, y: 5 },
    { c: goblin('g2', 'Hobgoblin'), side: 'enemy', x: 12, y: 8 },
  ]);

/** Words of English engine lines; a Danish line head (before the roll math, whose SRD modifier labels stay English until A149) must not contain them. */
const ENGLISH_HEADS = /\b(save|takes|has the|casts|enters|fills|is immune|regains|struggles|drinks|studies|condition)\b/;
const head = (line: string) => line.split(/d20[: ]|\d+d\d+/)[0]!;

describe('spells and zones (A141g)', () => {
  it('English lines are unchanged', () => {
    const cast = castInCombat(wizardFight(), ctx(), { casterId: 'me', spellId: 'web', targetIds: [], aim: { x: 8, y: 5 } });
    if (!cast.ok) throw new Error(cast.error);
    expect(text(cast)).toMatch(/^Web fills the area\.$/m);
    const m = moveCreature(turnOf(cast.state, 'g1'), ctx(undefined, 1), 'g1', [{ x: 11, y: 5 }, { x: 10, y: 5 }]);
    expect(text(m)).toMatch(/^Goblin enters Web\.$/m);
    expect(text(m)).toMatch(/^Brenna: Web \(20-ft cube\) — 1 creature in the area$/m);
    expect(text(m)).toMatch(/^Goblin Dexterity save: d20: 1 .* — Failure$/m);
    expect(text(m)).toMatch(/^Goblin has the restrained condition \(Web\)$/m);
  });

  it('a Danish fight with a caster: Web, a goblin walking in, escaping, Fireball', () => {
    const cast = castInCombat(wizardFight(), ctx(da), { casterId: 'me', spellId: 'web', targetIds: [], aim: { x: 8, y: 5 } });
    if (!cast.ok) throw new Error(cast.error);
    const m = moveCreature(turnOf(cast.state, 'g1'), ctx(da, 1), 'g1', [{ x: 11, y: 5 }, { x: 10, y: 5 }]);
    if (!m.ok) throw new Error(m.error);
    const esc = escapeZone(turnOf(m.state, 'g1'), ctx(da, 1), 'g1', 'web:me');
    const fb = castInCombat(turnOf(esc.state, 'me'), ctx(da, 10, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1), { casterId: 'me', spellId: 'fireball', targetIds: ['g1', 'g2'], areaTargets: true });
    if (!fb.ok) throw new Error(fb.error);
    const log = [text(cast), text(m), text(esc), text(fb)].join('\n');
    expect(log).toMatch(/^Web fylder området\.$/m);
    expect(log).toMatch(/^Goblin bevæger sig ind i Web\.$/m);
    expect(log).toMatch(/^Brenna: Web \(terning på 20 fod\) — 1 skabning i området$/m);
    expect(log).toMatch(/^Goblin Behændighed-redningsslag: d20: 1 .* mod SG \d+ — Fiasko$/m);
    expect(log).toMatch(/^Goblin får tilstanden restrained \(Web\)$/m);
    expect(log).toMatch(/^Goblin kæmper mod Web — /m);
    expect(log).toMatch(/^Brenna kaster Fireball \(niveau 3\)$/m);
    expect(log).toMatch(/^Hobgoblin tager \d+ skade/m);
    for (const line of log.split('\n')) expect(head(line)).not.toMatch(ENGLISH_HEADS);
  });

  it('cast errors, reach problems and slot problems in Danish', () => {
    const s = wizardFight();
    expect(reachProblem(s, 'me', 'g1', 30, da)).toBe('Uden for rækkevidde (60 fod > 30 fod)');
    expect(reachProblem(s, 'me', 'g1', 0, da)).toBe('Kun besværgeren selv kan være mål');
    const fireball = db.spells.get('fireball')!;
    expect(slotProblem(fireball, { kind: 'slot', level: 1 }, undefined, da)).toBe('Fireball kræver en plads på niveau 3+');
    expect(slotProblem(fireball, { kind: 'slot', level: 1 }, undefined)).toBe('Fireball needs a level 3+ slot');
    expect(castInCombat(s, ctx(da), { casterId: 'g1', spellId: 'fireball', targetIds: [] })).toMatchObject({ ok: false, error: 'Goblin kan ikke kaste besværgelser' });
  });

  it('healing, Study with the default topic and a potion in Danish', () => {
    const cleric = { ...caster('cleric', 3, ['healing_word']), hp: 5 } as Character;
    const s = setup([
      { c: { ...cleric, inventory: [...cleric.inventory, { uid: 'pot', itemId: 'potion_of_healing', quantity: 1 }] } as Character, side: 'party', x: 0, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 12, y: 5 },
    ]);
    const heal = castInCombat(s, ctx(da), { casterId: 'me', spellId: 'healing_word', targetIds: ['me'] });
    expect(text(heal)).toMatch(/^Brenna får \d+ LP igen \(/m);
    expect(text(study(s, ctx(da), 'me', { skill: 'arcana' }))).toMatch(/^Brenna undersøger fjenderne og slagmarken — d20/);
    expect(text(study(s, ctx(), 'me', { skill: 'arcana' }))).toMatch(/^Brenna studies the foes and the battlefield — d20/);
    const pot = useMagicItem(s, ctx(da), 'me', 'pot');
    expect(text(pot)).toMatch(/^Brenna drikker en Potion of Healing\.\nBrenna får \d+ LP igen/);
  });

  it('weapon masteries and end-of-turn spell effects in Danish', () => {
    const hero = caster('fighter', 3, []);
    const target = goblin('g1');
    const base = { attacker: hero, target, abilityMod: 3, damageDealt: 5, rng: fixed(1), msgs: da } as const;
    expect(applyMasteryOnHit({ ...base, mastery: 'sap' }).text).toBe('Sap: Goblin har ulempe på sit næste angreb');
    expect(applyMasteryOnHit({ ...base, mastery: 'topple' }).text).toMatch(/^Topple: Goblin falder omkuld \(d20: 1 .* — Fiasko\)$/);
    expect(applyMasteryOnHit({ ...base, mastery: 'sap', msgs: undefined }).text).toBe('Sap: Goblin has Disadvantage on its next attack');
    const sleepy = addEffect(target, { key: 'sleep_pending', sourceId: 'me:sleep', data: { dc: 30 } });
    expect(endOfTurnSpellEffects(sleepy, fixed(1), da).log[0]).toMatch(/^Goblin falder i søvn \(d20: 1/);
    expect(endOfTurnSpellEffects(sleepy, fixed(1)).log[0]).toMatch(/^Goblin falls asleep \(d20: 1/);
  });
});
