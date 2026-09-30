/** A141e: world-module lines and errors in English (unchanged) and Danish. */
import { describe, expect, it } from 'vitest';
import loreJson from '../../../data/world/lore.json';
import shopsJson from '../../../data/world/shops.json';
import sidequestsJson from '../../../data/tables/sidequests.json';
import { SideQuestTablesSchema } from '../adventure/sidequestTables';
import { acceptOffer, offerSources } from '../adventure/sideQuests';
import { mendYourself, repairAtSmith } from '../character/armorWear';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { equipItem, unequipItem } from '../character/inventory';
import { quickBuild } from '../character/quickBuild';
import { rollScars, scarDescription, scarText } from '../character/scars';
import type { Scar } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages, missingEngineKeys } from '../i18n';
import { newGameState } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { clockSystem } from '../systems/clockSystem';
import { MINUTES_PER_DAY } from './clock';
import { changeReputation, describeChange } from './factions';
import { LoreSchema } from './lore';
import { buy, haggle, sell, ShopTableSchema } from './shops';
import { travel } from './travel';
import { weatherChangeText, weatherEffects, type WeatherState } from './weather';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const table = ShopTableSchema.parse(shopsJson);
const da = messages('da');

function game() {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('w'))), db);
  const state = newGameState(hero, 'heroic', 'world-i18n');
  createDefaultRegistry({ lore }).init(state);
  state.time = 10 * 60;
  return state;
}

describe('world messages (A141e)', () => {
  it('the Danish engine catalog is complete', () => {
    expect(missingEngineKeys('da')).toEqual([]);
  });

  it('travel errors', () => {
    const state = game();
    const far = lore.locations.find((l) => !(state.extensions.map as { known: string[] }).known.includes(l.id))!;
    expect(travel({ state, lore, rng: Rng.fromSeed('t') }, far.id, 'normal').error).toBe('You do not know the way there yet.');
    expect(travel({ state, lore, rng: Rng.fromSeed('t'), msgs: da }, far.id, 'normal').error).toBe('Du kender ikke vejen dertil endnu.');
  });

  it('shop errors', () => {
    const state = game();
    const shop = table.shops.find((s) => s.hours)!;
    expect(buy({ state, db, lore, table }, 'nope', 'rope', 1)).toEqual({ ok: false, error: 'No such shop.' });
    expect(buy({ state, db, lore, table, msgs: da }, 'nope', 'rope', 1)).toEqual({ ok: false, error: 'Den butik findes ikke.' });
    state.time = shop.hours!.to * 60 + 30 < 24 * 60 ? shop.hours!.to * 60 + 30 : 3 * 60;
    expect(haggle({ state, db, lore, table, msgs: da, rng: Rng.fromSeed('h') }, shop.id)).toEqual({ ok: false, error: `${shop.name} har lukket lige nu.` });
    expect(sell({ state, db, lore, table }, shop.id, 'x', 1)).toEqual({ ok: false, error: `${shop.name} is closed right now.` });
  });

  it('equipment and repair errors + texts', () => {
    const state = game();
    const hero = state.hero;
    expect(equipItem(hero, 'nope', db, undefined, da)).toEqual({ ok: false, error: 'Det har du ikke.' });
    const loose = hero.inventory.find((i) => !i.equipped)!;
    expect(unequipItem(hero, loose.uid, db)).toEqual({ ok: false, error: 'That is not equipped.' });
    expect(unequipItem(hero, loose.uid, db, da)).toEqual({ ok: false, error: 'Det er ikke taget på.' });
    const armor = hero.inventory.find((i) => i.equipped === 'armor')!;
    expect(repairAtSmith(hero, armor.uid, db, da)).toEqual({ ok: false, error: 'Det behøver ingen reparation.' });
    armor.wear = 60;
    const mended = mendYourself(hero, armor.uid, da);
    expect(mended.ok && mended.text).toBe('Du bruger dagen på at banke buler ud og sy flængede remme.');
    const fixed = repairAtSmith({ ...hero, coins: 100_000 }, armor.uid, db);
    expect(fixed.ok && fixed.text).toBe('The smith hammers out the dents and patches the straps.');
  });

  it('reputation lines', () => {
    const state = game();
    const faction = lore.factions.find((f) => f.defaultReputation === 0)!;
    const [small] = changeReputation(state, faction.id, 5, lore);
    expect(describeChange(small!, lore)).toBe(`${faction.name}: +5 reputation`);
    expect(describeChange(small!, lore, da)).toBe(`${faction.name}: +5 omdømme`);
    const [big] = changeReputation(state, faction.id, 20, lore);
    expect(describeChange(big!, lore)).toBe(`${faction.name}: +20 reputation (now Friendly)`);
    expect(describeChange(big!, lore, da)).toBe(`${faction.name}: +20 omdømme (nu Venlig)`);
  });

  it('side-quest sources and errors', () => {
    const state = game();
    const deps = { tables: SideQuestTablesSchema.parse(sidequestsJson), lore, db };
    const town = lore.locations.find((l) => l.tags.includes('quest_board') && l.tags.includes('tavern'))!;
    expect(offerSources(state, deps, town.id).map((s) => s.label)).toEqual(expect.arrayContaining(['the quest board', 'the tavern']));
    expect(offerSources(state, deps, town.id, da).map((s) => s.label)).toEqual(expect.arrayContaining(['opslagstavlen', 'kroen']));
    expect(() => acceptOffer(state, 'nope', da)).toThrow('Det job er ikke længere til at få.');
    expect(() => acceptOffer(state, 'nope')).toThrow('That job is no longer on offer.');
  });

  it('scar texts', () => {
    const scar: Scar = { id: 'scar-1', location: 'left_cheek', cause: 'crit', description: 'Scimitar of the Goblin', origin: 'The Old Mill', at: 0 };
    expect(scarText(scar)).toBe('Left cheek: Scimitar of the Goblin (The Old Mill)');
    expect(scarText(scar, da)).toBe('Venstre kind: Scimitar of the Goblin (The Old Mill)');
    expect(scarText({ ...scar, origin: undefined } as unknown as Scar, da)).toBe('Venstre kind: Scimitar of the Goblin');
    expect(scarDescription({ sourceName: 'Goblin', weapon: 'Scimitar' })).toBe('Scimitar of the Goblin');
    expect(scarDescription({ sourceName: 'Goblin', weapon: 'Scimitar' }, da)).toBe('Scimitar fra Goblin');
    expect(scarDescription({ sourceName: 'Young Red Dragon', damageType: 'fire' }, da)).toBe('ild fra Young Red Dragon');
    expect(scarDescription({ sourceName: 'Ogre' }, da)).toBe('slag fra Ogre');
    const hero = game().hero;
    const { party, lines } = rollScars([hero], [{ targetId: hero.id, cause: 'down', sourceName: 'Ogre', weapon: 'Greatclub' }], { next: () => 0, pick: <T>(a: readonly T[]) => a[0]! } as unknown as Rng, 'Barrow', 5, da);
    expect(party[0]!.scars.at(-1)!.description).toBe('Greatclub fra Ogre');
    expect(lines[0]).toContain('Greatclub fra Ogre (Barrow)');
  });

  it('weather descriptions and change lines', () => {
    expect(weatherEffects({ kind: 'heat', wind: 'breezy' }).description).toBe('Oppressive heat, breezy');
    expect(weatherEffects({ kind: 'heat', wind: 'breezy' }, da).description).toBe('Trykkende hede, blæsende');
    expect(weatherEffects({ kind: 'fog', wind: 'strong' }, da).description).toBe('Tæt tåge og hård vind');
    const base: WeatherState = { kind: 'clear', wind: 'calm', regionId: lore.regions[0]!.id, block: 0 };
    expect(weatherChangeText(base, { ...base, kind: 'fog', wind: 'strong' })).toBe('Fog rolls in, thick and grey. A strong wind blows.');
    expect(weatherChangeText(base, { ...base, kind: 'fog', wind: 'strong' }, da)).toBe('Tågen ruller ind, tyk og grå. En hård vind blæser.');
    expect(weatherChangeText(base, { ...base, wind: 'strong' }, da)).toBe('Vinden tager kraftigt til.');
  });

  it('clock lines through the registry in the session language', () => {
    const clock = clockSystem(lore.calendar);
    const from = 10 * 60;
    const to = MINUTES_PER_DAY + 6 * 60;
    const [en] = clock.onTimeAdvance!(game(), from, to);
    expect(en!.text).toMatch(/^A new day begins \(day 2\)\. It is .+\. Dawn breaks\.$/);
    const state = game();
    const events = createDefaultRegistry({ lore }).advanceTime(state, to - state.time, da);
    expect(events.find((e) => e.systemId === 'clock')!.text).toMatch(/^En ny dag begynder \(dag 2\)\. Det er .+\. Dagen gryr\.$/);
    expect(clock.onTimeAdvance!(game(), 10 * 60, 19 * 60, da)[0]!.text).toBe('Skumringen falder på.');
  });
});
