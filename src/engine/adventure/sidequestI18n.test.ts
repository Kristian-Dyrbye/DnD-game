/**
 * A143d: generated side quests speak the session language (glue text from the engine catalog,
 * names from the translated tables), and placeholders that start a sentence are capitalised.
 */
import { describe, expect, it } from 'vitest';
import flagsJson from '../../../data/adventures/flags.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages } from '../i18n';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { worldTables } from '../../host/gameHost';
import { contentByLanguage } from '../../host/translations';
import { BUNDLED_TRANSLATIONS } from '../../host/bundled';
import { fillPlaceholders, generateSideQuest } from './sidequestGen';
import { generateValidSideQuest } from './sidequestCheck';

const db = loadSrd();
const registry = FlagRegistry.fromJson(flagsJson);
const en = worldTables();
const da = contentByLanguage(new Map(), en, BUNDLED_TRANSLATIONS)('da').tables;

function state(level = 3) {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
  hero.classes[0]!.level = level;
  return newGameState(hero, 'heroic', 'sq-i18n');
}

const PROSE_KEYS = new Set(['text', 'label', 'name', 'seed', 'summary']);

/** Every player-facing string inside the generated adventure (not ids, keywords or developer flag docs). */
function texts(adventure: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key = ''): void => {
    if (typeof v === 'string') return void (PROSE_KEYS.has(key) && out.push(v));
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(adventure);
  return out;
}

const ENGLISH_GLUE = [/approaches you with a job/, /Accept the job/, /Set out for/, /Head back to/, /Return to/, /Admit to/, /Force the issue/, /nightfall tomorrow/, /\d+ gp\)/, /Job done/, /Job failed/, /is waiting for news/, /driven off/, /retreat to safety/, /will trouble no one/, /Hear out/, /Slip past the watch/, /Push through the storm/, /Steel is drawn/, /come for you/, /harder than it looked/, /too late/];

describe('placeholders', () => {
  it('capitalises a value that starts the text or a sentence, nowhere else', () => {
    const v = { antagonist: 'a maddened owlbear', patron: 'Old Maudie', bird: 'ørnen' };
    expect(fillPlaceholders('{antagonist} expected company.', v)).toBe('A maddened owlbear expected company.');
    expect(fillPlaceholders('It is over quickly. {antagonist} will run no more.', v)).toBe('It is over quickly. A maddened owlbear will run no more.');
    expect(fillPlaceholders('Confront {antagonist}', v)).toBe('Confront a maddened owlbear');
    expect(fillPlaceholders('"Go!" {antagonist} hears it.', v)).toBe('"Go!" A maddened owlbear hears it.');
    expect(fillPlaceholders('{bird} letter.', v)).toBe('Ørnen letter.');
    expect(fillPlaceholders('Hand {unknown} over', v)).toBe('Hand {unknown} over');
  });

  it('English twists no longer read "The a …" (sentence-start placeholders in the source)', () => {
    for (let i = 0; i < 120; i++) {
      const q = generateSideQuest({ tables: en.sideQuests, lore: en.lore, db, state: state(1 + (i % 8)), rng: Rng.fromSeed(i), locationId: ['millbrook', 'ravensgate', 'port_sorrel'][i % 3]!, flags: registry, threadChance: 0 });
      for (const t of texts(q.adventure)) {
        expect(t).not.toMatch(/\bThe (a|an|the) /);
        expect(t).not.toMatch(/(^|[.!?] )\p{Ll}/u);
      }
    }
  });
});

describe('side quests in Danish', () => {
  it('generates valid Danish jobs with no English glue', () => {
    let made = 0;
    for (let i = 0; i < 40; i++) {
      const res = generateValidSideQuest({ tables: da.sideQuests, lore: da.lore, db, state: state(1 + (i % 8)), rng: Rng.fromSeed(i), locationId: ['millbrook', 'ravensgate', 'port_sorrel'][i % 3]!, flags: registry, msgs: messages('da') });
      if (!res) continue;
      made++;
      for (const t of texts(res.adventure as unknown as Record<string, unknown>)) for (const re of ENGLISH_GLUE) expect(t).not.toMatch(re);
    }
    expect(made).toBeGreaterThan(30);
  });

  it('uses the Danish catalog lines, coins and keywords', () => {
    const q = generateSideQuest({ tables: da.sideQuests, lore: da.lore, db, state: state(3), rng: Rng.fromSeed(5), locationId: 'millbrook', flags: registry, msgs: messages('da') });
    const all = texts(q.adventure);
    expect(all).toContain('Tag jobbet');
    expect(all).toContain('Job udført');
    expect(all.some((t) => t.endsWith('kommer hen til dig med et job: ' + (q.adventure.summary as string) + '.'))).toBe(true);
    const accept = JSON.stringify(q.adventure).match(/"keywords":\["accept","yes","job","accepter","ja","jobbet","opgaven"\]/);
    expect(accept).not.toBeNull();
    // A bribe price is in Danish coins when the quest type has a bribe approach.
    const bribes = all.filter((t) => /\(\d+ (gp|gm)\)$/.test(t));
    for (const b of bribes) expect(b).toMatch(/\(\d+ gm\)$/);
  });

  it('English output keeps its old wording', () => {
    const q = generateSideQuest({ tables: en.sideQuests, lore: en.lore, db, state: state(3), rng: Rng.fromSeed(5), locationId: 'millbrook', flags: registry });
    const all = texts(q.adventure);
    expect(all).toContain('Accept the job');
    expect(all).toContain('Job done');
    expect(all.some((t) => /approaches you with a job: /.test(t))).toBe(true);
  });
});
