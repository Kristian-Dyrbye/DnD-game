/** A141c: roll math lines and the core combat log in English (unchanged) and Danish; narration moments in both. */
import { describe, expect, it } from 'vitest';
import { combatMoments, pickMoments } from '../adventure/combatNarration';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import type { Character } from '../core/creature';
import { formatD20Test } from '../core/dice';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages } from '../i18n';
import { attackRoll } from '../rules/damage';
import { rollDeathSave } from '../rules/death';
import { savingThrow, skillCheck } from '../rules/checks';
import type { CombatContext } from './combatState';
import { playerAct, setupEncounter, type Encounter } from './encounter';

const db = loadSrd();
const da = messages('da');

/** Rng whose d20s come from a list (then repeat the last). */
function faces(...values: number[]): Rng {
  const r = Rng.fromSeed('x');
  let i = 0;
  r.int = (min: number, max: number) => Math.min(max, Math.max(min, values[Math.min(i++, values.length - 1)]!));
  return r;
}

const hero = (): Character => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('i18n'))), db);

describe('roll math lines (A141c)', () => {
  it('formatD20Test words follow the language; English unchanged', () => {
    const t = { d20: { mode: 'advantage' as const, rolls: [7, 14], natural: 14 }, modifiers: [{ value: 5, label: 'Persuasion' }], total: 19, target: { kind: 'DC' as const, value: 15 } };
    expect(formatD20Test({ ...t, outcome: 'Success' })).toBe('d20 (adv: 7, 14 → 14) + 5 (Persuasion) = 19 vs DC 15 — Success');
    expect(formatD20Test({ ...t, outcome: da.m('roll.success') }, da)).toBe('d20 (fordel: 7, 14 → 14) + 5 (Persuasion) = 19 mod SG 15 — Succes');
    expect(formatD20Test({ ...t, target: { kind: 'AC', value: 12 } }, da)).toContain('mod RK 12');
  });

  it('checks, saves, attack rolls and death saves', () => {
    const h = hero();
    expect(skillCheck(h, 'athletics', { rng: faces(20), dc: 5 }).text).toMatch(/vs DC 5 — Success$/);
    expect(skillCheck(h, 'athletics', { rng: faces(20), dc: 5, msgs: da }).text).toMatch(/mod SG 5 — Succes$/);
    expect(savingThrow(h, 'wis', { rng: faces(1), dc: 30, msgs: da }).text).toMatch(/mod SG 30 — Fiasko$/);
    expect(savingThrow(h, 'str', { rng: faces(1), dc: 10, autoFail: 'Paralyzed', msgs: da }).text).toMatch(/Automatisk fiasko \(Lammet\)$/);
    const atk = (face: number, msgs = messages('en')) => attackRoll({ rng: faces(face), label: 'Longsword', modifiers: [{ value: 5, label: 'Strength' }], targetAc: 15, msgs }).text;
    expect(atk(20)).toMatch(/vs AC 15 — Critical Hit!$/);
    expect(atk(20, da)).toMatch(/mod RK 15 — Kritisk træffer!$/);
    expect(atk(12, da)).toMatch(/— Træffer$/);
    expect(atk(1, da)).toMatch(/— Forbi \(naturlig 1\)$/);
    const down: Character = { ...h, hp: 0, deathSaves: { successes: 2, failures: 0, stable: false } };
    expect(rollDeathSave(down, faces(15)).text).toMatch(/vs DC 10 — Third success: Stable/);
    expect(rollDeathSave(down, faces(15), [], 'normal', da).text).toMatch(/mod SG 10 — Tredje succes: stabil/);
    expect(rollDeathSave(down, faces(20), [], 'normal', da).text).toMatch(/Naturlig 20: får 1 LP igen!$/);
  });
});

function fight(lang: 'en' | 'da'): { enc: Encounter; ctx: CombatContext } {
  const ctx: CombatContext = { rng: Rng.fromSeed('combat-i18n'), db, msgs: messages(lang) };
  const enc = setupEncounter({ hero: hero(), monsters: [{ id: 'goblin_warrior', count: 2 }], db }, ctx);
  return { enc, ctx };
}

/** Moves next to the nearest goblin and attacks until the fight ends (bounded). */
function playOut(enc: Encounter, ctx: CombatContext): void {
  for (let i = 0; i < 60 && enc.status === 'ongoing'; i++) {
    const foe = Object.values(enc.state.creatures).find((c) => c.id !== enc.heroId && c.hp > 0);
    if (!foe) break;
    const err = playerAct(enc, ctx, { kind: 'attack', targetId: foe.id });
    if (err) {
      const t = enc.state.grid.tokens[foe.id]!;
      const me = enc.state.grid.tokens[enc.heroId]!;
      const step = { x: me.x + Math.sign(t.x - me.x), y: me.y + Math.sign(t.y - me.y) };
      if (playerAct(enc, ctx, { kind: 'move', path: [step] })) playerAct(enc, ctx, { kind: 'end_turn' });
    }
  }
}

describe('combat log (A141c)', () => {
  it('English fight log keeps its lines', () => {
    const { enc, ctx } = fight('en');
    expect(enc.log[0]).toBe('Roll for initiative!');
    expect(enc.log.some((l) => / initiative: d20/.test(l))).toBe(true);
    expect(enc.log.some((l) => /'s turn \(round 1\)\.$/.test(l))).toBe(true);
    expect(playerAct({ ...enc, status: 'won' }, ctx, { kind: 'end_turn' })).toBe('The fight is over.');
  });

  it('Danish fight log: initiative, turns, attacks, damage, victory — no English line heads', () => {
    const { enc, ctx } = fight('da');
    expect(enc.log[0]).toBe('Slå for initiativ!');
    expect(enc.log.some((l) => / initiativ: d20/.test(l))).toBe(true);
    playOut(enc, ctx);
    const log = enc.log.join('\n');
    expect(log).toMatch(/^Tur: .+ \(runde 1\)\.$/m);
    expect(log).toMatch(/angriber .+ med .+: d20/);
    expect(log).toMatch(/ tager \d+ skade/);
    // A141f: AI plans, moves, shared initiative and crit damage too.
    expect(log).toMatch(/^Goblinkriger \d (angriber|rykker ind på) \S+\.$/m); // A149c: Danish monster names
    expect(log).toMatch(/ bevæger sig \d+ fod/);
    expect(log).not.toMatch(/ attacks | takes \d+ damage|'s turn|Round \d+ begins| vs (DC|AC) | — (Hit|Miss|Success|Failure)\b| initiative: | moves \d+ ft|closes in on|Critical! /);
    if (enc.status === 'won') expect(enc.log.at(-1)).toBe('Sejr!');
    expect(playerAct({ ...enc, status: 'won' }, ctx, { kind: 'end_turn' })).toBe('Kampen er slut.');
  });
});

describe('combat narration moments in any language (A141c)', () => {
  const EN = [
    'Roll for initiative!',
    'Ogre attacks Sabine with Greatclub: d20 (adv: 18, 15 → 18) + 6 (Greatclub) = 24 vs AC 17 — Critical Hit!',
    'Sabine takes 7 damage (half) — 2d6: [3, 4] = 7 — falls unconscious!',
    'Mira casts Fireball (level 3)',
    'Victory!',
  ];
  const DA = [
    'Slå for initiativ!',
    'Ogre angriber Sabine med Greatclub: d20 (fordel: 18, 15 → 18) + 6 (Greatclub) = 24 mod RK 17 — Kritisk træffer!',
    'Sabine tager 7 skade (halv) — 2d6: [3, 4] = 7 — falder bevidstløs om!',
    'Sabine angriber Goblin 1 med Longsword: d20: 3 + 5 = 8 mod RK 15 — Forbi',
    'Mira kaster Fireball (niveau 3)',
    'Goblin 1 tager 9 skade — 1d8: [9] = 9 — dør!',
    'Sejr!',
  ];

  it('Danish lines become Danish facts', () => {
    expect(combatMoments(DA, da).map((m) => m.fact)).toEqual([
      'Våbnene drages: kampen begynder.',
      'Ogre rammer Sabine kritisk med Greatclub.',
      'Sabine segner bevidstløs.',
      'Sabine hugger efter Goblin 1 med Longsword men rammer forbi.',
      'Mira kaster Fireball.',
      'Goblin 1 falder død om.',
      'Den sidste fjende falder: kampen er vundet.',
    ]);
    expect(pickMoments(DA, 'key', da)).not.toContain('Mira kaster Fireball.');
  });

  it('lines from the other language are still recognised (language switched mid-fight)', () => {
    expect(combatMoments(EN, da).map((m) => m.fact)).toEqual([
      'Våbnene drages: kampen begynder.',
      'Ogre rammer Sabine kritisk med Greatclub.',
      'Sabine segner bevidstløs.',
      'Mira kaster Fireball.',
      'Den sidste fjende falder: kampen er vundet.',
    ]);
    expect(combatMoments(DA).map((m) => m.fact)[1]).toBe('Ogre lands a critical hit on Sabine with Greatclub.');
  });
});
