/**
 * B001: the campaign picker. `new_game.campaign` names the first chapter to start; the default is the
 * starter arc; an uninstalled campaign is refused; the state and save meta carry the campaign; the
 * in-page (web) host honours it too; the campaign table and UI catalogs agree.
 */
import { describe, expect, it } from 'vitest';
import { bundledFlagRegistry, loadBundledAdventures } from '../src/host/bundled';
import { createGameHost, STARTING_ADVENTURE, worldTables, type GameHost } from '../src/host/gameHost';
import { createInPageHost } from '../src/host/inPage';
import { MemorySaves } from '../src/host/memorySaves';
import { CAMPAIGNS, campaignKeys, campaignOf, DEFAULT_CAMPAIGN } from '../src/host/campaigns';
import { continueWorld, newGameState } from '../src/engine/session/GameSession';
import { getProgress } from '../src/engine/adventure/runner';
import { loadSrd } from '../src/engine/data/srdBundle';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { parseCommand, type ServerEvent } from '../src/shared/protocol';
import { InPageTransport } from '../src/client/net/transport';
import { en } from '../src/shared/i18n/en';
import { da } from '../src/shared/i18n/da';

type Of<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>;

const db = loadSrd();
const tables = worldTables();
const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(7))), db);

function host(): { host: GameHost; events: ServerEvent[]; of: <T extends ServerEvent['type']>(t: T) => Of<T>[]; saves: MemorySaves } {
  const saves = new MemorySaves();
  const h = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, saves, sessionPorts: { newSeed: () => 'campaign-test' } });
  const events: ServerEvent[] = [];
  h.on((e) => events.push(e));
  return { host: h, events, saves, of: (t) => events.filter((e): e is Of<typeof t> => e.type === t) };
}

describe('campaign table', () => {
  it('lists the starter arc as the default and the Hollow Crown (not playable until its chapter 0 exists)', () => {
    expect(DEFAULT_CAMPAIGN.adventure).toBe(STARTING_ADVENTURE);
    expect(CAMPAIGNS.map((c) => c.id)).toEqual(['seven_teeth', 'hollow_crown']);
    const crown = CAMPAIGNS.find((c) => c.id === 'hollow_crown')!;
    // Flip `playable` in src/host/campaigns.ts when B004 lands arc2/ch0_hollow_coin.json.
    expect(crown.playable).toBe(adventures.has(crown.adventure));
    expect(campaignOf('millbrook_disappearances')?.id).toBe('seven_teeth');
    expect(campaignOf('millbrook_demo')).toBeUndefined();
  });

  it('has a name and blurb in English and Danish for every campaign', () => {
    for (const c of CAMPAIGNS) {
      const keys = campaignKeys(c.id);
      for (const cat of [en, da] as Record<string, string>[]) {
        expect(cat[keys.name], `${keys.name}`).toBeTruthy();
        expect(cat[keys.blurb], `${keys.blurb}`).toBeTruthy();
      }
    }
    expect(en[campaignKeys('seven_teeth').name as keyof typeof en]).toBe('The Seven Teeth of Vashkul');
    expect(en[campaignKeys('hollow_crown').name as keyof typeof en]).toBe('The Hollow Crown');
  });

  it('the protocol accepts `campaign` on new_game', () => {
    const r = parseCommand(JSON.stringify({ type: 'new_game', hero, mode: 'heroic', campaign: 'millbrook_demo' }));
    expect(r.ok && r.command.type === 'new_game' && r.command.campaign).toBe('millbrook_demo');
  });
});

describe('new_game with a campaign (game host)', () => {
  it('starts the default campaign when none is given', async () => {
    const { host: h, of } = host();
    expect(h.campaigns.map((c) => c.id)).toContain('seven_teeth');
    await h.send({ type: 'new_game', hero, mode: 'heroic' });
    await h.idle();
    expect(of('error')).toEqual([]);
    expect(getProgress(h.session.current)?.adventureId).toBe(STARTING_ADVENTURE);
    expect(h.session.current.campaign).toBeUndefined();
    expect(h.session.saveMeta().campaign).toBeUndefined();
  });

  it('starts the chosen campaign (first chapter adventure id) and records it in the state and save meta', async () => {
    const { host: h, of, saves } = host();
    await h.send({ type: 'new_game', hero, mode: 'heroic', campaign: 'millbrook_demo' });
    await h.idle();
    expect(of('error')).toEqual([]);
    expect(getProgress(h.session.current)?.adventureId).toBe('millbrook_demo');
    expect(h.session.current.campaign).toBe('millbrook_demo');
    expect(of('saved').at(-1)!.meta.campaign).toBe('millbrook_demo');
    // The campaign survives a save/load round trip.
    await h.send({ type: 'save', slot: 'slot-1' });
    const listed = saves.list().find((e) => e.ok && e.meta.slotId === 'slot-1');
    expect(listed && listed.ok && listed.meta.campaign).toBe('millbrook_demo');
    await h.send({ type: 'load', slot: 'slot-1' });
    await h.idle();
    expect(of('error')).toEqual([]);
    expect(h.session.current.campaign).toBe('millbrook_demo');
    expect(getProgress(h.session.current)?.adventureId).toBe('millbrook_demo');
  });

  it('refuses an uninstalled campaign without touching the running game', async () => {
    const { host: h, of } = host();
    await h.send({ type: 'new_game', hero, mode: 'heroic', campaign: 'millbrook_demo' });
    await h.idle();
    const before = h.session.current.campaignId;
    await h.send({ type: 'new_game', hero, mode: 'heroic', campaign: 'arc9_not_written', reqId: 'r1' });
    await h.idle();
    expect(of('error').map((e) => [e.message, e.reqId])).toEqual([['Campaign "arc9_not_written" is not installed', 'r1']]);
    expect(h.session.current.campaignId).toBe(before);
    expect(getProgress(h.session.current)?.adventureId).toBe('millbrook_demo');
  });

  it('a Hardcore successor keeps the world’s campaign', () => {
    const old = newGameState(hero, 'hardcore', 'a', 'millbrook_demo');
    const fresh = newGameState(hero, 'hardcore', 'b');
    expect(continueWorld(old, fresh).campaign).toBe('millbrook_demo');
    // A world started before B001 (no campaign) takes the new hero's choice.
    expect(continueWorld(newGameState(hero, 'hardcore', 'c'), newGameState(hero, 'hardcore', 'd', 'millbrook_demo')).campaign).toBe('millbrook_demo');
  });
});

describe('new_game with a campaign (in-page web host)', () => {
  it('starts the chosen campaign through the InPage transport', async () => {
    let h: GameHost | undefined;
    const transport = new InPageTransport(async () => (h = createInPageHost({ saves: new MemorySaves(), sessionPorts: { newSeed: () => 'inpage-campaign' } })));
    const events: ServerEvent[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
    transport.send({ type: 'new_game', hero, mode: 'heroic', campaign: 'millbrook_demo' });
    const start = Date.now();
    while (!h) {
      if (Date.now() - start > 10_000) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
    await transport.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const snap = events.filter((e): e is Of<'snapshot'> => e.type === 'snapshot').at(-1)!;
    expect(snap.state.campaign).toBe('millbrook_demo');
    expect(getProgress(h!.session.current)?.adventureId).toBe('millbrook_demo');
    expect(h!.campaigns.map((c) => c.adventure)).toContain(STARTING_ADVENTURE);
  });
});
