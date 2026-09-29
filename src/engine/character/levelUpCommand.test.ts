import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import type { ServerEvent } from '../../shared/protocol';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { Rng } from '../core/rng';
import { totalLevel } from '../core/creature';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { buildCharacter } from './builder';
import { toBuildInput } from './creator';
import { maxSpellLevelAt, pendingChoices } from './leveling';
import { quickBuild } from './quickBuild';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;

async function session(classId = 'fighter') {
  const s = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db), newSeed: () => 'lvl' });
  const events: ServerEvent[] = [];
  s.on((e) => events.push(e));
  await s.handle({ type: 'new_game', hero: buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(classId))), db), mode: 'heroic' });
  return { s, events };
}

describe('level up', () => {
  it('max spell level by class level (full, half, pact, none)', () => {
    expect(maxSpellLevelAt(db, 'wizard', 1)).toBe(1);
    expect(maxSpellLevelAt(db, 'wizard', 5)).toBe(3);
    expect(maxSpellLevelAt(db, 'paladin', 5)).toBe(2);
    expect(maxSpellLevelAt(db, 'warlock', 3)).toBe(2);
    expect(maxSpellLevelAt(db, 'fighter', 5)).toBe(0);
  });

  it('refuses without enough XP, then levels up with the average HP', async () => {
    const { s, events } = await session();
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average', reqId: 'a' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Not enough XP', reqId: 'a' });
    s.current.hero.xp = 300;
    const hp0 = s.current.hero.maxHp;
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average' });
    expect(totalLevel(s.current.hero)).toBe(2);
    expect(s.current.hero.maxHp).toBeGreaterThan(hp0);
    expect(events.some((e) => e.type === 'log' && e.entry.text.startsWith('Level 2!'))).toBe(true);
  });

  it('requires the subclass choice at level 3 and accepts it', async () => {
    const { s, events } = await session();
    s.current.hero.xp = 2700;
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'roll' });
    const choices = pendingChoices(s.current.hero, db, 'fighter', 3);
    expect(choices.some((c) => c.kind === 'subclass')).toBe(true);
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average', reqId: 'b' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Choose a subclass', reqId: 'b' });
    const sub = choices.find((c) => c.kind === 'subclass')!;
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average', subclassId: sub.kind === 'subclass' ? sub.options[0]! : '' });
    expect(s.current.hero.classes[0]).toMatchObject({ level: 3, subclassId: sub.kind === 'subclass' ? sub.options[0] : '' });
  });
});
