/** A141h: class feature log/problem texts in English (unchanged) and Danish. */
import { describe, expect, it } from 'vitest';
import { featureInCombat } from '../../combat/castAction';
import type { CombatContext, CombatState } from '../../combat/combatState';
import { createGrid, placeToken } from '../../combat/grid';
import { startCombat } from '../../combat/turns';
import type { Character, Creature } from '../../core/creature';
import { Rng } from '../../core/rng';
import { loadSrd } from '../../data/srdBundle';
import { messages } from '../../i18n';
import { autoLevelTo } from '../../party/companions';
import { savingThrow } from '../../rules/checks';
import { monsterToCreature } from '../../rules/monsters';
import { buildCharacter } from '../builder';
import { toBuildInput } from '../creator';
import { quickBuild } from '../quickBuild';
import { useInspiration } from './bard';
import { tacticalMind } from './fighter';
import { FeatureError, featureActions, useFeatureAction } from './index';
import { cunningStrike, reliableTalent } from './rogue';

const db = loadSrd();
const da = messages('da');

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}

const hero = (classId: string, level: number): Character => ({
  ...autoLevelTo(buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(classId))), db), level, db),
  id: 'me',
  name: 'Brenna',
  hp: 1,
});
const monster = (srdId: string, id: string, name: string): Creature => monsterToCreature(db.monsters.get(srdId)!, id, name);

/** English line heads that must not show up in a Danish log. */
const ENGLISH = /\b(uses|regains|takes careful aim|surges|presents|is turned|Wisdom save|channels|flies into|attacks recklessly|inspires|lays hands|is knocked|keeps its footing|Success|Failure|No .* left|doesn't have)\b/;

describe('class feature texts (A141h)', () => {
  it('stay English by default', () => {
    const f = hero('fighter', 3);
    expect(useFeatureAction(f, db, 'second_wind', { rng: fixed(4) }).log[0]).toBe('Brenna uses Second Wind and regains 7 HP (1d10: 4 + 3).');
    const spent = { ...f, resources: { ...f.resources, second_wind: { ...f.resources.second_wind!, current: 0 } } };
    expect(featureActions(spent, db).find((a) => a.action.id === 'second_wind')?.problem).toBe('No Second Wind left');
  });

  it('fighter, barbarian, rogue and bard action lines in Danish', () => {
    const f = hero('fighter', 3);
    const lines = [
      ...useFeatureAction(f, db, 'second_wind', { rng: fixed(4), msgs: da }).log,
      ...useFeatureAction(f, db, 'action_surge', { rng: fixed(), msgs: da }).log,
    ];
    const b = hero('barbarian', 3);
    lines.push(...useFeatureAction(b, db, 'rage', { rng: fixed(), msgs: da }).log, ...useFeatureAction(b, db, 'reckless_attack', { rng: fixed(), msgs: da }).log);
    const r = hero('rogue', 3);
    lines.push(...useFeatureAction(r, db, 'steady_aim', { rng: fixed(), msgs: da }).log);
    const bard = hero('bard', 3);
    lines.push(...useFeatureAction(bard, db, 'bardic_inspiration', { rng: fixed(), target: f, msgs: da }).log);
    expect(lines).toContain('Brenna bruger Second Wind og genvinder 7 LP (1d10: 4 + 3).');
    expect(lines.some((l) => l.startsWith('Brenna går amok i raseri!'))).toBe(true);
    for (const l of lines) expect(l).not.toMatch(ENGLISH);
  });

  it('problems and errors in Danish', () => {
    const f = hero('fighter', 3);
    const spent = { ...f, resources: { ...f.resources, second_wind: { ...f.resources.second_wind!, current: 0 } } };
    expect(featureActions(spent, db, da).find((a) => a.action.id === 'second_wind')?.problem).toBe('Ingen Second Wind tilbage');
    expect(() => useFeatureAction(spent, db, 'second_wind', { rng: fixed(), msgs: da })).toThrow(new FeatureError('Ingen Second Wind tilbage'));
    expect(() => useFeatureAction(f, db, 'rage', { rng: fixed(), msgs: da })).toThrow('Brenna har ikke rage');
  });

  it('Turn Undead and Divine Spark in Danish (saves too)', () => {
    const c = hero('cleric', 5);
    const zombies = [monster('zombie', 'z1', 'Zombie'), monster('zombie', 'z2', 'Zombie 2')];
    const turn = useFeatureAction(c, db, 'turn_undead', { rng: fixed(1, 1, 3, 3), targets: zombies, msgs: da });
    expect(turn.log[0]).toMatch(/^Brenna løfter sit hellige symbol: Turn Undead \(SG \d+\)\.$/);
    expect(turn.log.some((l) => l.includes('Visdom-redningsslag'))).toBe(true);
    expect(turn.log.some((l) => l.endsWith('er drevet bort i 1 minut.'))).toBe(true);
    const spark = useFeatureAction(c, db, 'divine_spark', { rng: fixed(5, 5), target: zombies[0]!, msgs: da });
    expect(spark.log[0]).toBe('Brenna kanaliserer en Divine Spark.');
    for (const l of [...turn.log, ...spark.log]) expect(l).not.toMatch(ENGLISH);
  });

  it('Cunning Strike, Reliable Talent, Tactical Mind and Bardic Inspiration results in Danish', () => {
    const r = hero('rogue', 7);
    const orc = monster('goblin_warrior', 'o', 'Ork');
    const trip = cunningStrike(r, orc, 'trip', fixed(1), da)!;
    expect(trip.text).toBe('Ork bliver slået omkuld');
    expect(trip.save!.text).toContain('Fiasko');
    const f = hero('fighter', 3);
    const failed = savingThrow(orc, 'wis', { rng: fixed(2), dc: 20, msgs: da });
    const tm = tacticalMind(f, failed, fixed(1), da)!;
    expect(tm.result.text).toMatch(/\(Taktisk sans\) = \d+ — Fiasko \(anvendelsen refunderes\)$/);
    expect(reliableTalent(r, failed, true, da).text).toContain('(Reliable Talent: d20 tæller som 10 → ');
    const inspired = { ...orc, effects: [{ id: 'bi-1', key: 'bardic_inspiration', sourceId: 'b', data: { die: 'd6' } }] } as Creature;
    expect(useInspiration(inspired, failed, fixed(1), da)!.result.text).toMatch(/\(Bardisk inspiration\) = \d+ — Fiasko$/);
  });

  it('featureInCombat passes the session language', () => {
    const f = hero('fighter', 3);
    const orc = monster('goblin_warrior', 'o', 'Ork');
    const grid = createGrid(10, 10);
    placeToken(grid, { id: f.id, x: 1, y: 1, size: f.size });
    placeToken(grid, { id: orc.id, x: 5, y: 5, size: orc.size });
    const turns = startCombat([
      { id: f.id, side: 'party', initiative: 20, dexMod: 0 },
      { id: orc.id, side: 'enemy', initiative: 5, dexMod: 0 },
    ]);
    const state: CombatState = { grid, turns: { ...turns, round: 1, currentIndex: 0, turnActive: true }, creatures: { [f.id]: f, [orc.id]: orc } };
    const ctx: CombatContext = { rng: fixed(4), db, msgs: da };
    const res = featureInCombat(state, ctx, { actorId: f.id, actionId: 'second_wind' });
    expect(res.ok).toBe(true);
    expect(res.events.map((e) => e.text)).toEqual(['Brenna bruger Second Wind og genvinder 7 LP (1d10: 4 + 3).']);
  });
});
