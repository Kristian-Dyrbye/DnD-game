import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import { perform, startAdventure } from '../../engine/adventure/runner';
import { validateAdventure } from '../../engine/adventure/validate';
import { buildCharacter } from '../../engine/character/builder';
import { toBuildInput } from '../../engine/character/creator';
import { quickBuild } from '../../engine/character/quickBuild';
import { Rng } from '../../engine/core/rng';
import { loadSrd } from '../../engine/data/srdBundle';
import { newGameState } from '../../engine/session/GameSession';
import { LoreSchema } from '../../engine/world/lore';
import { estimateTokens } from './cards';
import { describeMember, gatherNarrationContext, recentLines } from './gather';
import { buildNarrationPrompt, type NarrationContext } from './narration';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;

function playing() {
  const hero = buildCharacter(toBuildInput(quickBuild('cleric', db, Rng.fromSeed('c'))), db);
  const state = newGameState(hero, 'heroic', 1);
  const ctx = { state, adventure, rng: Rng.fromSeed(1), db };
  startAdventure(ctx);
  return ctx;
}

describe('gatherNarrationContext', () => {
  it('collects party, place, time, tone, scene and relevant cards', () => {
    const { state } = playing();
    const c = gatherNarrationContext(state, lore, adventure, db);
    expect(c.party[0]).toMatch(new RegExp(`^${state.hero.name}, \\w+ Cleric 1, \\d+/\\d+ HP$`));
    expect(c.where).toBe('Millbrook Square, Millbrook, The Kingdom of Aurelmark');
    expect(c.when).toBe('day');
    expect(c.tone).toMatch(/^Region: The Kingdom of Aurelmark \(high fantasy\)/);
    expect(c.scene).toMatch(/mossy well/);
    expect(c.scene).toMatch(/Notice board:/);
    expect(c.cards.map((x) => x.id)).toEqual(expect.arrayContaining(['mayor_hobb', 'millbrook']));
    expect(c.cards.find((x) => x.id === 'mayor_hobb')?.text).toMatch(/never reveal/);
  });

  it('includes set adventure flags as plain sentences and recent exchanges', () => {
    const ctx = playing();
    perform(ctx, 'talk_mayor');
    ctx.state.log.push({ id: 90, kind: 'player', text: 'I thank the mayor.' }, { id: 91, kind: 'system', text: '+50 XP' });
    const c = gatherNarrationContext(ctx.state, lore, adventure, db);
    expect(c.flags).toEqual(['Got the mill key from the mayor.', 'The hero is pursuing: The rats in the old mill.']);
    expect(c.recent).toEqual(['Player: I thank the mayor.']);
  });

  it('describes wounded and downed members without exact numbers mattering to prose', () => {
    const { state } = playing();
    const h = structuredClone(state.hero);
    h.hp = 1;
    h.conditions = [{ condition: 'poisoned' }];
    expect(describeMember(h, db)).toMatch(/wounded \(1\/\d+ HP\), poisoned$/);
    h.hp = 0;
    expect(describeMember(h, db)).toMatch(/down \(0 HP\)/);
  });

  it('keeps only the last N story exchanges and truncates long ones', () => {
    const log = Array.from({ length: 10 }, (_, i) => ({ id: i, kind: 'narration' as const, text: i === 9 ? 'x'.repeat(500) : `line ${i}` }));
    const lines = recentLines(log, 3);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Narrator: line 7');
    expect(lines[2]!.length).toBeLessThan(340);
  });
});

describe('buildNarrationPrompt', () => {
  const base = (): NarrationContext => ({
    tone: 'Region: Test (dark fantasy).',
    party: ['Mira, human Fighter 1, 11/11 HP'],
    where: 'Mill Cellar',
    when: 'night',
    threats: [],
    flags: ['The mayor promised a reward.'],
    summary: 'Mira came to Millbrook and took the mayor’s job.',
    recent: ['Player: I open the door.', 'Narrator: The hinges shriek.'],
    cards: [{ kind: 'npc', id: 'hobb', text: 'NPC Mayor Hobb.', priority: 90 }],
    scene: 'A damp cellar.',
  });

  it('builds a system persona with tone + rules and a user message with every section and the fixed facts', () => {
    const p = buildNarrationPrompt(base(), { kind: 'outcome', playerAction: 'Force the door', facts: ['The door splinters.', 'Two rats attack.'] });
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0]!.content).toMatch(/Dungeon Master/);
    expect(p.messages[0]!.content).toMatch(/Region: Test/);
    expect(p.messages[0]!.content).toMatch(/Never invent items/);
    const user = p.messages[1]!.content;
    for (const s of ['STATE:', 'WORLD:', 'STORY SO FAR:', 'RECENT:', 'NOTES:', 'SCENE:', 'FIXED FACTS', 'TASK:']) expect(user).toContain(s);
    expect(user).toMatch(/1\. The door splinters\.\n2\. Two rats attack\./);
    expect(user).toMatch(/"Force the door"/);
    expect(p.dropped).toEqual([]);
    expect(p.tokens).toBe(estimateTokens(p.messages[0]!.content) + estimateTokens(user));
  });

  it('trims optional context to the budget but never the facts, scene or state', () => {
    const big = base();
    big.recent = Array.from({ length: 30 }, (_, i) => `Narrator: ${'long text '.repeat(20)} ${i}`);
    big.cards.push(...Array.from({ length: 10 }, (_, i) => ({ kind: 'faction' as const, id: `f${i}`, text: 'Faction '.repeat(30), priority: 50 })));
    big.summary = 'summary '.repeat(300);
    const p = buildNarrationPrompt(big, { kind: 'scene', facts: ['The cellar is dark.'] }, 900);
    expect(p.tokens).toBeLessThanOrEqual(900);
    expect(p.dropped.length).toBeGreaterThan(0);
    const user = p.messages[1]!.content;
    expect(user).toContain('1. The cellar is dark.');
    expect(user).toContain('A damp cellar.');
    expect(user).toContain('Mira, human Fighter 1');
    // Present NPC cards (priority 90) outlive faction cards.
    expect(user).toContain('NPC Mayor Hobb.');
    expect(user).not.toContain('Player: I open the door.');
  });

  it('omits empty sections', () => {
    const c = { ...base(), flags: [], summary: '', recent: [], cards: [], tone: undefined };
    delete c.tone;
    const p = buildNarrationPrompt(c, { kind: 'scene', facts: [] });
    expect(p.messages[1]!.content).not.toMatch(/WORLD:|STORY SO FAR:|RECENT:|NOTES:|FIXED FACTS/);
  });
});
