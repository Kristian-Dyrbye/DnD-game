import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import flagsJson from '../../../data/adventures/flags.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import defeatsJson from '../../../data/tables/defeat-outcomes.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { rollScars } from '../character/scars';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages } from '../i18n';
import { changeApproval, CompanionRosterSchema, levelCompanionsWithHero, partingLine, recruitCompanion, setControl } from '../party/companions';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { applyDefeat, DefeatTableSchema } from './defeat';
import { fightAct } from './fights';
import { intentContext, validateIntent, type Intent } from './intent';
import { resolveIntent } from './resolve';
import { perform, startAdventure, type RunContext } from './runner';
import { duration, expireStoryConditions } from './storyConditions';
import { validateAdventure } from './validate';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const registry = FlagRegistry.fromJson(flagsJson);
const da = messages('da');
const nettle = roster.companions.find((c) => c.id === 'nettle')!;

const raw = {
  formatVersion: 1,
  id: 'i18n_test',
  name: 'I18n test',
  kind: 'test',
  levelRange: [1, 3],
  summary: 'test',
  start: { chapter: 'c1', scene: 'camp' },
  chapters: [
    {
      id: 'c1',
      name: 'C1',
      summary: 's',
      start: 'camp',
      scenes: [
        {
          id: 'camp',
          name: 'Camp',
          seed: 'A cold camp.',
          actions: [
            { id: 'recruit', label: 'Ask Nettle to come', outcome: { recruit: 'nettle', approval: [{ companion: 'nettle', delta: 25 }] } },
            { id: 'drink', label: 'Drink', outcome: { conditions: [{ condition: 'poisoned', target: 'hero', minutes: 90 }], exhaustion: 1 } },
            { id: 'fall', label: 'Fall', outcome: { damage: { dice: '1d4', type: 'bludgeoning', target: 'hero' } } },
            { id: 'sleep', label: 'Sleep', outcome: { rest: 'long' } },
            { id: 'leave', label: 'Leave', outcome: { ending: 'done' } },
          ],
        },
      ],
    },
  ],
  endings: [{ id: 'done', name: 'Done', text: 'Done.' }],
};

function danish(): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('i'))), db);
  const v = validateAdventure(structuredClone(raw), db, registry, roster);
  const adventure = v.adventure!;
  const c: RunContext = { state: newGameState(hero, 'heroic', 'i18n'), adventure, rng: Rng.fromSeed(2), db, flags: registry, companions: roster, msgs: da };
  startAdventure(c);
  return c;
}

describe('story module messages in Danish', () => {
  it('writes runner facts and party lines in the context language', () => {
    const c = danish();
    const r = perform(c, 'recruit');
    expect(r.partyLog).toEqual(['Nettle slutter sig til din gruppe.', 'Nettle bifalder varmt. (+25)']);
    const d = perform(c, 'drink');
    expect(d.facts).toContain(`${c.state.hero.name} er poisoned i 1 time 30 minutter.`);
    expect(d.facts).toContain('Udmattelse +1.');
    expect(perform(c, 'fall').facts[0]).toMatch(/ tager \d bludgeoning-skade\.$/);
    expect(perform(c, 'sleep').facts).toContain('Gruppen holder et langt hvil (8 timer) og vågner udhvilet.');
    c.state.time += 200;
    expect(expireStoryConditions(c.state, da)).toEqual([`${c.state.hero.name} er ikke længere poisoned.`]);
  });

  it('keeps English as the default', () => {
    expect(duration(90)).toBe('1 hour 30 minutes');
    expect(duration(61, da)).toBe('1 time 1 minut');
    expect(duration(120, da)).toBe('2 timer');
  });

  it('localizes companion helpers', () => {
    const c = danish();
    expect(recruitCompanion(c.state, nettle, db, da).message).toBe('Nettle slutter sig til din gruppe.');
    expect(recruitCompanion(c.state, nettle, db, da).message).toBe('Nettle er allerede med dig.');
    expect(changeApproval(c.state, nettle, -45, da)).toBe('Nettle misbilliger kraftigt. (-45) Tålmodigheden er ved at slippe op.');
    expect(partingLine(nettle, 'left', da)).toBe('Nettle forlader gruppen.');
    c.state.hero.classes[0]!.level = 2;
    expect(levelCompanionsWithHero(c.state, roster, db, da)).toEqual(['Nettle når niveau 2.']);
    expect(() => setControl(c.state, 'nobody', 'player', da)).toThrow('Den følgesvend er ikke i din gruppe.');
  });

  it('localizes free-text resolution facts', () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const hero = buildCharacter(toBuildInput(quickBuild('bard', db, Rng.fromSeed('b'))), db);
    const c: RunContext = { state: newGameState(hero, 'heroic', 1), adventure, rng: Rng.fromSeed(1), db, msgs: da };
    startAdventure(c);
    const resolve = (intent: Intent) => {
      const ictx = intentContext(c);
      return resolveIntent(c, validateIntent(intent, ictx), 'x').result.facts;
    };
    expect(resolve({ action: 'look' })).toEqual(['Du ser dig grundigt omkring.']);
    expect(resolve({ action: 'rest' })).toEqual(['Det her er ikke et sted til et ordentligt hvil.']);
    expect(resolve({ action: 'other' })).toEqual(['Der kommer ikke noget synligt ud af det.']);
    expect(resolve({ action: 'skill_check', skill: 'acrobatics' })[0]).toMatch(/^Forsøget med Akrobatik (lykkes|mislykkes)/);
    expect(resolve({ action: 'skill_check', skill: 'acrobatics' })[0]).toMatch(/^Det har du allerede prøvet \(Akrobatik\)/);
  });

  it('localizes fight and defeat lines', () => {
    const c = danish();
    expect(fightAct(c.state, { kind: 'end_turn' } as never, c.rng, db, da)).toBe('Der er ingen kamp i gang.');
    const defeats = DefeatTableSchema.parse(defeatsJson);
    c.state.hero.coins = 5000;
    const robbed = defeats.outcomes.find((o) => o.id === 'robbed_and_left')!;
    const res = applyDefeat(c.state, { ...robbed, coinsLost: 1000, coinsLostFraction: 0, loseItem: true }, { rng: Rng.fromSeed(1), msgs: da });
    expect(res.facts).toContain('Du mistede 10 gm.');
    if (res.itemLost) expect(res.facts).toContain('Noget af dit er forsvundet.');
    const hero = c.state.hero;
    const scars = rollScars([hero], [{ targetId: hero.id, cause: 'down', sourceName: 'Goblin', damageType: 'slashing' }] as never, { next: () => 0, int: (a: number) => a, pick: <T>(l: T[]) => l[0]! } as unknown as Rng, 'Camp', 0, da);
    expect(scars.lines[0]).toMatch(new RegExp(`^${hero.name} vil bære et ar: `));
  });
});
