import { describe, expect, it } from 'vitest';
import demo from '../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../data/world/lore.json';
import { sfxForEvent } from '../client/audio/audioLogic';
import { parseCommand, type ServerEvent } from '../shared/protocol';
import { adventureActionPort } from './adventure/sessionActions';
import { validateAdventure } from './adventure/validate';
import { formatCoins } from './adventure/runner';
import { buildCharacter } from './character/builder';
import { toBuildInput } from './character/creator';
import { quickBuild } from './character/quickBuild';
import { Rng } from './core/rng';
import { loadSrd } from './data/srdBundle';
import { ENGINE_CATALOGS, ENGLISH_MESSAGES, messages, missingEngineKeys, type EngineKey } from './i18n';
import { GameSession } from './session/GameSession';
import { createDefaultRegistry } from './systems';
import { LoreSchema } from './world/lore';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('engine message catalog', () => {
  it('has every English key in Danish, with the same placeholders', () => {
    expect(missingEngineKeys('da')).toEqual([]);
    for (const [key, text] of Object.entries(ENGINE_CATALOGS.en) as [EngineKey, string][]) {
      expect(placeholders(ENGINE_CATALOGS.da[key]!), key).toEqual(placeholders(text));
    }
  });

  it('formats coins and plurals per language', () => {
    expect(formatCoins(1234)).toBe('12 gp 3 sp 4 cp');
    expect(formatCoins(0)).toBe('0 cp');
    expect(formatCoins(1234, messages('da'))).toBe('12 gm 3 sm 4 km');
    expect(ENGLISH_MESSAGES.mn('travel.doneDays', 1, { name: 'Ravensgate' })).toBe('You travel to Ravensgate (1 day).');
    expect(messages('da').mn('travel.doneDays', 3, { name: 'Ravensgate' })).toBe('Du rejser til Ravensgate (3 dage).');
  });

  it('parses the set_language command', () => {
    expect(parseCommand('{"type":"set_language","language":"da"}')).toEqual({ ok: true, command: { type: 'set_language', language: 'da' } });
    expect(parseCommand('{"type":"set_language","language":"xx"}').ok).toBe(false);
  });

  it('plays the same sound effects for Danish and English lines', () => {
    const log = (text: string): ServerEvent => ({ type: 'log', entry: { id: 1, kind: 'system', text } });
    const da = messages('da');
    expect(sfxForEvent(log(da.m('shop.bought', { qty: 1, item: 'rope', coins: '1 gm' })))).toBe('coin');
    expect(sfxForEvent(log(da.m('job.complete', { name: 'Ulve' })))).toBe('quest_complete');
    expect(sfxForEvent(log(da.mn('travel.doneDays', 2, { name: 'Ravensgate' })))).toBe('footstep_dirt');
    expect(sfxForEvent(log(ENGLISH_MESSAGES.m('travel.done', { name: 'Ravensgate' })))).toBe('footstep_dirt');
  });
});

describe('session language', () => {
  async function playing(language?: 'en' | 'da') {
    const session = new GameSession({
      actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, travelEvents: { chancePerDay: 0, events: [] } }),
      systems: createDefaultRegistry({ lore }),
      newSeed: () => 'lang',
    });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    if (language) await session.handle({ type: 'set_language', language });
    const hero = buildCharacter(toBuildInput(quickBuild('ranger', db, Rng.fromSeed('r'))), db);
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    return { session, events };
  }
  const lines = (events: ServerEvent[]) => events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : []));

  it('writes engine lines in English by default and in Danish after set_language', async () => {
    const en = await playing();
    await en.session.handle({ type: 'travel', to: 'ravensgate', pace: 'normal' });
    expect(lines(en.events).some((t) => t.startsWith('You travel to Ravensgate'))).toBe(true);

    const da = await playing('da');
    await da.session.handle({ type: 'travel', to: 'ravensgate', pace: 'normal' });
    expect(lines(da.events).some((t) => t.startsWith('Du rejser til Ravensgate'))).toBe(true);
    await da.session.handle({ type: 'travel', to: 'atlantis', pace: 'normal', reqId: 'u' });
    expect(da.events.at(-1)).toEqual({ type: 'error', message: 'Ukendt sted', reqId: 'u' });
    await da.session.handle({ type: 'combat_flee', reqId: 'f' });
    expect(da.events.at(-1)).toEqual({ type: 'error', message: 'Der er ingen kamp i gang.', reqId: 'f' });
  });

  it('keeps old lines in the language they were written in', async () => {
    const { session, events } = await playing('da');
    await session.handle({ type: 'travel', to: 'ravensgate', pace: 'normal' });
    await session.handle({ type: 'set_language', language: 'en' });
    await session.handle({ type: 'travel', to: 'millbrook', pace: 'fast' });
    const log = session.current.log.map((e) => e.text);
    expect(log.some((t) => t.startsWith('Du rejser til Ravensgate'))).toBe(true);
    expect(log.some((t) => t.startsWith('You travel to Millbrook'))).toBe(true);
    expect(lines(events).length).toBeGreaterThan(0);
  });

  it('localizes session errors before a game runs', async () => {
    const session = new GameSession();
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'set_language', language: 'da' });
    await session.handle({ type: 'say', text: 'hej', reqId: 'x' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Der kører intet spil', reqId: 'x' });
  });
});
