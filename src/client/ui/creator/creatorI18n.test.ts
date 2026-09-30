import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scoreProblems } from '../../../engine/character/abilityScores';
import { CREATOR_STEPS, creationChoices, newCreatorState, stepLabel, stepProblems, type CreatorState } from '../../../engine/character/creator';
import { quickBuild } from '../../../engine/character/quickBuild';
import { Rng } from '../../../engine/core/rng';
import { loadSrd } from '../../../engine/data/srdBundle';
import { CATALOGS, translator, type MessageKey } from '../../../shared/i18n';
import { OUTFITS } from '../../../engine/appearance/appearance';
import { applyLanguage } from '../i18n';
import { CLASS_INFO, classText } from './classInfo';

const db = loadSrd();
const DA = translator('da');

describe('creator texts in Danish', () => {
  it('step names and step problems follow the translator (English stays the default)', () => {
    expect(stepLabel('abilities')).toBe('Ability Scores');
    expect(stepLabel('abilities', DA)).toBe('Evneværdier');
    const s = newCreatorState();
    expect(stepProblems(s, 'class', db)).toEqual(['Choose a class']);
    expect(stepProblems(s, 'class', db, DA)).toEqual(['Vælg en klasse']);
    expect(stepProblems({ ...s, speciesId: 'human' }, 'species', db, DA)).toEqual(['Vælg en størrelse']);
    expect(stepProblems({ ...s, classId: 'wizard' }, 'spells', db, DA)).toEqual(['Vælg 3 småbesværgelser', 'Vælg 4 besværgelser på niveau 1']);
    expect(stepProblems(s, 'identity', db, DA)).toEqual(['Skriv et navn']);
  });

  it('every step has a label in both languages', () => {
    for (const step of CREATOR_STEPS) {
      expect(CATALOGS.en[`creator.step.${step}`]).toBeTruthy();
      expect(CATALOGS.da[`creator.step.${step}`]).toBeTruthy();
    }
  });

  it('ability score problems and class options are translated', () => {
    expect(scoreProblems(undefined, {}, undefined, DA)).toEqual(['Vælg en metode']);
    expect(scoreProblems('point_buy', { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 }, undefined, DA)).toEqual(['Pointkøbet koster 36/27']);
    const cleric: CreatorState = { ...newCreatorState(), classId: 'cleric', backgroundId: 'acolyte' };
    const order = creationChoices(cleric, db, DA).find((c) => c.key === 'divine_order')!;
    expect(order.label).toBe('en guddommelig orden');
    expect(order.options.map((o) => o.label)).toEqual(['Beskytter', 'Undergører']);
    const mi = creationChoices(cleric, db, DA).find((c) => c.key === 'feat_bg_cantrips')!;
    expect(mi.label).toBe('Magisk indviet: småbesværgelser (Cleric)');
    expect(stepProblems({ ...cleric, classSkills: ['history', 'insight'] }, 'skills', db, DA)).toContain('Vælg en guddommelig orden (1)');
  });

  it('a finished quick build has no problems in Danish either', () => {
    const s = quickBuild('bard', db, Rng.fromSeed('da'));
    for (const step of CREATOR_STEPS) if (step !== 'review') expect(stepProblems(s, step, db, DA)).toEqual([]);
  });

  it('class blurbs and outfit names exist for every class/outfit in both languages', () => {
    for (const id of db.classes.keys()) {
      expect(CLASS_INFO[id], id).toBeDefined();
      for (const part of ['role', 'blurb'] as const) {
        const key = `class.${id}.${part}` as MessageKey;
        expect(CATALOGS.en[key], key).toBeTruthy();
        expect(CATALOGS.da[key], key).toBeTruthy();
      }
    }
    for (const o of OUTFITS) expect(CATALOGS.da[`outfit.${o}`]).toBeTruthy();
    applyLanguage('da');
    expect(classText('fighter', 'role')).toBe('Våbenekspert');
    applyLanguage('en');
    expect(classText('fighter', 'role')).toBe('Weapon expert');
  });
});

describe('creator screens use the catalog', () => {
  const dir = join(process.cwd(), 'src/client/ui/creator');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  it('no plain English text between JSX tags or in visible attributes', () => {
    const found: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      // Text between tags: `>Some words<` or a line that is only words inside JSX.
      for (const m of src.matchAll(/>([^<>{}\n]*[A-Za-z]{2}[^<>{}\n]*)</g)) found.push(`${f}: ${m[1]!.trim()}`);
      for (const m of src.matchAll(/^\s+([A-Z][a-z]+(?: [a-z]+)*)\s*$/gm)) found.push(`${f}: ${m[1]}`);
      for (const m of src.matchAll(/\b(?:aria-label|placeholder|title)="([^"]*[A-Za-z][^"]*)"/g)) found.push(`${f}: ${m[1]}`);
    }
    expect(found).toEqual([]);
  });
});
