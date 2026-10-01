/**
 * B002: "new hero, same world". A finished save (its story reached an ending) can start a new campaign
 * in its world: world.* and arc.main.* flags, reputation and time (+1 year) carry over, everything
 * personal starts fresh. Otherwise a campaign's fresh-world flags are written. Server-style host and
 * the in-page (web) host; refusals for unfinished saves and campaigns that don't import worlds.
 */
import { describe, expect, it } from 'vitest';
import { bundledFlagRegistry, loadBundledAdventures } from '../src/host/bundled';
import { createGameHost, worldTables, type GameHost } from '../src/host/gameHost';
import { createInPageHost } from '../src/host/inPage';
import { MemorySaves } from '../src/host/memorySaves';
import { CAMPAIGNS, campaignOf } from '../src/host/campaigns';
import { GameSession, finishedEnding, importWorld, newGameState } from '../src/engine/session/GameSession';
import { conditionContext, getProgress } from '../src/engine/adventure/runner';
import { evalCondition } from '../src/engine/adventure/conditions';
import { MINUTES_PER_DAY } from '../src/engine/world/clock';
import { loadSrd } from '../src/engine/data/srdBundle';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { parseCommand, type ServerEvent } from '../src/shared/protocol';
import type { SaveMeta } from '../src/shared/save';
import { InPageTransport } from '../src/client/net/transport';
import { finishedWorlds } from '../src/client/ui/creator/WorldPicker';

type Of<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>;

const db = loadSrd();
const tables = worldTables();
const registry = bundledFlagRegistry();
const { adventures } = loadBundledAdventures(db, registry, tables.companions);
const oldHero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(7))), db);
const newHero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed(8))), db);
const YEAR = 360 * MINUTES_PER_DAY;

function host(saves = new MemorySaves()): { host: GameHost; of: <T extends ServerEvent['type']>(t: T) => Of<T>[]; saves: MemorySaves } {
  const h = createGameHost({ srd: db, adventures, flags: registry, tables, saves, sessionPorts: { newSeed: () => 'world-test' } });
  const events: ServerEvent[] = [];
  h.on((e) => events.push(e));
  return { host: h, saves, of: (t) => events.filter((e): e is Of<typeof t> => e.type === t) };
}

/** A finished first-campaign world: the Queen dead, the Maw stirring, a money trail proven. */
function finishWorld(state: ReturnType<typeof newGameState>): void {
  Object.assign(state.flags, {
    'world.queen_alive': false,
    'world.maw_state': 'stirring',
    'world.corwin_status': 'left',
    'arc.main.money_trail_proven': true,
    'adv.millbrook_demo.reward_claimed': true,
    'arc.starter.reeve_attitude': 'friendly',
  });
  state.extensions.reputation = { ironvault_consortium: 55, crown_of_aurelmark: -10 };
  state.extensions.adventure = { ...(state.extensions.adventure as object), ending: 'campaign_sealed' };
  state.time = 40 * MINUTES_PER_DAY + 17 * 60 + 25;
  state.journal = { ...state.journal, pages: [{ id: 'p1', title: 'Old notes', body: 'x', updatedAt: 0 }] };
}

async function finishedSave(h: GameHost, slot: string): Promise<void> {
  await h.send({ type: 'new_game', hero: oldHero, mode: 'heroic', campaign: 'millbrook_demo' });
  await h.idle();
  finishWorld(h.session.current);
  await h.send({ type: 'save', slot });
}

describe('importWorld', () => {
  it('keeps world.* / arc.main.* flags and reputation, moves on a year to 08:00, starts everything personal fresh', () => {
    const old = newGameState(oldHero, 'heroic', 'old', 'millbrook_disappearances');
    finishWorld(old);
    old.extensions.map = { known: ['millbrook'] };
    const fresh = newGameState(newHero, 'hardcore', 'new', 'millbrook_demo');
    const s = importWorld(old, fresh);
    expect(s.flags).toEqual({ 'world.queen_alive': false, 'world.maw_state': 'stirring', 'world.corwin_status': 'left', 'arc.main.money_trail_proven': true });
    expect(s.extensions.reputation).toEqual({ ironvault_consortium: 55, crown_of_aurelmark: -10 });
    expect(s.extensions.map).toBeUndefined();
    expect(s.extensions.adventure).toBeUndefined();
    expect(s.extensions.worldFrom).toEqual({ campaignId: old.campaignId, campaign: 'millbrook_disappearances', ending: 'campaign_sealed', hero: oldHero.name });
    expect(s.time).toBe(40 * MINUTES_PER_DAY + YEAR + 8 * 60);
    expect(s.hero.name).toBe(newHero.name);
    expect(s.mode).toBe('hardcore');
    expect(s.campaign).toBe('millbrook_demo');
    expect(s.campaignId).toBe(fresh.campaignId);
    expect(s.journal).toEqual(fresh.journal);
    expect(s.log).toEqual([]);
    // The old state is untouched.
    (s.extensions.reputation as Record<string, number>).ironvault_consortium = 0;
    expect((old.extensions.reputation as Record<string, number>).ironvault_consortium).toBe(55);
  });

  it('a world flag the old game never wrote falls under the fresh defaults', () => {
    const old = newGameState(oldHero, 'heroic', 'old');
    old.extensions.adventure = { adventureId: 'x', sceneId: 'y', visited: [], done: [], beats: [], ending: 'e' };
    old.flags['world.maw_state'] = 'opened';
    const fresh = newGameState(newHero, 'heroic', 'new');
    fresh.flags = { 'world.maw_state': 'sealed', 'world.queen_alive': true };
    expect(importWorld(old, fresh).flags).toEqual({ 'world.maw_state': 'opened', 'world.queen_alive': true });
  });

  it('finishedEnding reads the main adventure ending', () => {
    const s = newGameState(oldHero, 'heroic', 'a');
    expect(finishedEnding(s)).toBeUndefined();
    s.extensions.adventure = { adventureId: 'x', sceneId: 'y', visited: [], done: [], beats: [], ending: 'won' };
    expect(finishedEnding(s)).toBe('won');
  });
});

describe('fresh-world defaults', () => {
  it('the Hollow Crown starts a new world with the Maw sealed, the Queen alive and the hero not outlawed; the Seven Teeth writes none', () => {
    const crown = CAMPAIGNS.find((c) => c.id === 'hollow_crown')!;
    expect(crown.importsWorld).toBe(true);
    expect(crown.freshWorld).toEqual({ 'world.maw_state': 'sealed', 'world.queen_alive': true, 'world.player_outlawed': false });
    const teeth = campaignOf('millbrook_disappearances')!;
    expect(teeth.importsWorld).toBe(false);
    expect(teeth.freshWorld).toBeUndefined();
    // Every fresh-world flag is a registry flag with an allowed value.
    for (const [id, v] of Object.entries(crown.freshWorld!)) {
      const def = registry.get(id);
      expect(def, id).toBeDefined();
      if (def?.values) expect(def.values).toContain(v);
    }
  });

  it('new_game writes the campaign’s fresh-world flags (session port)', async () => {
    const s = new GameSession({ newSeed: () => 'x', world: { freshFlags: (c) => ({ ...campaignOf(c)?.freshWorld }) } });
    await s.handle({ type: 'new_game', hero: newHero, mode: 'heroic', campaign: 'arc2_ch0_hollow_coin' });
    expect(s.current.flags).toEqual({ 'world.maw_state': 'sealed', 'world.queen_alive': true, 'world.player_outlawed': false });
    await s.handle({ type: 'new_game', hero: newHero, mode: 'heroic', campaign: 'millbrook_disappearances' });
    expect(s.current.flags).toEqual({});
  });
});

describe('new_game worldFrom (game host)', () => {
  it('save meta marks finished stories; the protocol and the picker list accept them', async () => {
    const { host: h, of, saves } = host();
    await h.send({ type: 'new_game', hero: oldHero, mode: 'heroic', campaign: 'millbrook_demo' });
    await h.idle();
    expect(of('saved').at(-1)!.meta.ending).toBeUndefined();
    await h.send({ type: 'save', slot: 'unfinished' });
    await finishedSave(h, 'finished');
    expect(of('saved').at(-1)!.meta.ending).toBe('campaign_sealed');
    const metas = saves.list().flatMap((e) => (e.ok ? [e.meta] : [])) as SaveMeta[];
    expect(finishedWorlds(metas).map((m) => m.slotId)).toEqual(['finished']);
    const r = parseCommand(JSON.stringify({ type: 'new_game', hero: newHero, mode: 'heroic', worldFrom: 'finished' }));
    expect(r.ok && r.command.type === 'new_game' && r.command.worldFrom).toBe('finished');
    expect(parseCommand(JSON.stringify({ type: 'new_game', hero: newHero, mode: 'heroic', worldFrom: '../x' })).ok).toBe(false);
  });

  it('starts a new hero in an imported world: the flags are read by conditions, the story starts fresh', async () => {
    const { host: h, of } = host();
    await finishedSave(h, 'finished');
    await h.send({ type: 'new_game', hero: newHero, mode: 'heroic', campaign: 'millbrook_demo', worldFrom: 'finished' });
    await h.idle();
    expect(of('error')).toEqual([]);
    const s = h.session.current;
    expect(s.hero.name).toBe(newHero.name);
    expect(getProgress(s)?.adventureId).toBe('millbrook_demo');
    expect(getProgress(s)?.ending).toBeUndefined();
    expect(s.flags['adv.millbrook_demo.reward_claimed']).toBeUndefined();
    expect(s.flags['arc.starter.reeve_attitude']).toBeUndefined();
    const ctx = conditionContext(s, getProgress(s), registry);
    expect(evalCondition({ flag: 'world.queen_alive', eq: false }, ctx)).toBe(true);
    expect(evalCondition({ flag: 'arc.main.money_trail_proven' }, ctx)).toBe(true);
    expect(evalCondition({ reputation: { faction: 'ironvault_consortium', gte: 50 } }, ctx)).toBe(true);
    // One year later (the host's lore calendar), the day starting at 08:00.
    expect(Math.floor(s.time / MINUTES_PER_DAY)).toBe(40 + 360);
    expect(s.time % MINUTES_PER_DAY).toBeGreaterThanOrEqual(8 * 60);
    expect(s.journal).toEqual(newGameState(newHero, 'heroic', 'z').journal);
    expect(s.log.some((l) => l.text.includes('Old notes'))).toBe(false);
    // The new game is autosaved as an unfinished story.
    expect(of('saved').at(-1)!.meta.ending).toBeUndefined();
  });

  it('refuses an unfinished save and a missing slot without touching the running game', async () => {
    const { host: h, of } = host();
    await h.send({ type: 'new_game', hero: oldHero, mode: 'heroic', campaign: 'millbrook_demo' });
    await h.idle();
    await h.send({ type: 'save', slot: 'unfinished' });
    const before = h.session.current.campaignId;
    await h.send({ type: 'new_game', hero: newHero, mode: 'heroic', campaign: 'millbrook_demo', worldFrom: 'unfinished', reqId: 'r1' });
    await h.send({ type: 'new_game', hero: newHero, mode: 'heroic', campaign: 'millbrook_demo', worldFrom: 'nope', reqId: 'r2' });
    await h.idle();
    const errors = of('error');
    expect(errors.map((e) => e.reqId)).toEqual(['r1', 'r2']);
    expect(errors[0]!.message).toBe('That save has not reached an ending yet, so its world cannot be continued');
    expect(h.session.current.campaignId).toBe(before);
    expect(h.session.current.hero.name).toBe(oldHero.name);
  });

  it('refuses an imported world for a campaign that always starts fresh (the Seven Teeth)', async () => {
    const { host: h, of } = host();
    await finishedSave(h, 'finished');
    await h.send({ type: 'new_game', hero: newHero, mode: 'heroic', worldFrom: 'finished', reqId: 'r3' });
    await h.idle();
    expect(of('error').map((e) => [e.message, e.reqId])).toEqual([['This campaign always starts in a new world', 'r3']]);
    expect(h.session.current.hero.name).toBe(oldHero.name);
  });
});

describe('new_game worldFrom (in-page web host)', () => {
  it('imports a finished browser save', async () => {
    const saves = new MemorySaves();
    const old = newGameState(oldHero, 'heroic', 'old', 'millbrook_demo');
    finishWorld(old);
    saves.save('finished', { name: 'Done', characterName: oldHero.name, level: 1, location: 'Millbrook', mode: 'heroic', playTimeMinutes: 0, ending: 'campaign_sealed' }, old);
    let h: GameHost | undefined;
    const transport = new InPageTransport(async () => (h = createInPageHost({ saves, sessionPorts: { newSeed: () => 'inpage-world' } })));
    const events: ServerEvent[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
    transport.send({ type: 'new_game', hero: newHero, mode: 'heroic', campaign: 'millbrook_demo', worldFrom: 'finished' });
    const start = Date.now();
    while (!h) {
      if (Date.now() - start > 10_000) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
    await transport.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const snap = events.filter((e): e is Of<'snapshot'> => e.type === 'snapshot').at(-1)!;
    expect(snap.state.hero.name).toBe(newHero.name);
    expect(snap.state.flags['world.queen_alive']).toBe(false);
    expect(snap.state.extensions.reputation).toMatchObject({ ironvault_consortium: 55 });
  });
});
