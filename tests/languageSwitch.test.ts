/**
 * A143c: language leftovers of the content overlays: the clock's calendar names follow the session
 * language, the client's lore/shop names follow the UI language, and switching language re-offers
 * the suggestion buttons in the new language.
 */
import { describe, expect, it } from 'vitest';
import { BUNDLED_TRANSLATIONS, bundledFlagRegistry, loadBundledAdventures } from '../src/host/bundled';
import { createGameHost, worldTables } from '../src/host/gameHost';
import { contentByLanguage } from '../src/host/translations';
import { clockSystem, dateText } from '../src/engine/systems/clockSystem';
import { createDefaultRegistry } from '../src/engine/systems';
import { messages } from '../src/engine/i18n';
import { MINUTES_PER_DAY } from '../src/engine/world/clock';
import type { GameState } from '../src/engine/session/gameState';
import { loadSrd } from '../src/engine/data/srdBundle';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import type { ServerEvent } from '../src/shared/protocol';
import { localLore, localShops, lore as englishLore, shops as englishShops } from '../src/client/data';
import { language } from '../src/client/ui/i18n';

const db = loadSrd();
const tables = worldTables();
const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
const content = contentByLanguage(adventures, tables, BUNDLED_TRANSLATIONS);
const daLore = content('da').tables.lore;
const state = {} as GameState; // the clock reads only the times

describe('calendar names in the session language', () => {
  it('formats dates per language with that language’s lore names', () => {
    const day2 = MINUTES_PER_DAY + 8 * 60;
    expect(dateText(day2, tables.lore.calendar)).toBe('Forgeday, 2 Seedwake 1247 AR');
    expect(dateText(day2, daLore.calendar, messages('da'))).toBe('Smedjedag den 2. Frøvåg 1247 AR');
  });

  it('the clock system picks the calendar by the session language; English output is unchanged', () => {
    const sys = clockSystem((lang) => content(lang).tables.lore.calendar);
    const [da] = sys.onTimeAdvance!(state, 8 * 60, MINUTES_PER_DAY + 8 * 60, messages('da'));
    expect(da!.text).toContain('Det er Smedjedag den 2. Frøvåg 1247 AR.');
    const [en] = sys.onTimeAdvance!(state, 8 * 60, MINUTES_PER_DAY + 8 * 60, messages('en'));
    expect(en!.text).toContain('It is Forgeday, 2 Seedwake 1247 AR.');
    // A fixed calendar (old callers) still works.
    const [fixed] = clockSystem(tables.lore.calendar).onTimeAdvance!(state, 0, MINUTES_PER_DAY, messages('en'));
    expect(fixed!.text).toContain('Seedwake');
  });

  it('createDefaultRegistry passes loreFor to the clock', () => {
    const reg = createDefaultRegistry({ loreFor: (lang) => content(lang).tables.lore });
    const text = reg.timeAdvanced({ extensions: {} } as unknown as GameState, 0, MINUTES_PER_DAY, messages('da')).map((e) => e.text).join(' ');
    expect(text).toContain('Frøvåg');
  });
});

describe('client lore and shop names follow the UI language', () => {
  it('switches names with the language signal; ids stay the same', () => {
    language.value = 'en';
    expect(localLore.value).toBe(englishLore);
    expect(localShops.value).toEqual(englishShops);
    language.value = 'da';
    expect(localLore.value.calendar.months[0]!.name).toBe('Frøvåg');
    expect(localLore.value.locations.map((l) => l.id)).toEqual(englishLore.locations.map((l) => l.id));
    expect(localShops.value).toEqual(content('da').tables.shops);
    expect(localShops.value).not.toEqual(englishShops);
    language.value = 'en';
  });
});

describe('switching language re-offers the buttons', () => {
  it('sends new suggestions in the new language at once (not only after the next action)', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'millbrook_demo', sessionPorts: { newSeed: () => 'a143c' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const suggestions = () => events.filter((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    // Before a game exists a switch offers nothing.
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'set_language', language: 'en' });
    expect(suggestions()).toHaveLength(0);
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(suggestions().at(-1)!.actions.map((a) => a.label)).not.toContain('Tal med borgmester Hobb');
    const before = suggestions().length;
    await host.send({ type: 'set_language', language: 'da' });
    await host.idle();
    expect(suggestions().length).toBe(before + 1);
    expect(suggestions().at(-1)!.actions.map((a) => a.label)).toContain('Tal med borgmester Hobb');
    // The same language again (every reconnect sends it) offers nothing new.
    await host.send({ type: 'set_language', language: 'da' });
    await host.idle();
    expect(suggestions().length).toBe(before + 1);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
  });
});
