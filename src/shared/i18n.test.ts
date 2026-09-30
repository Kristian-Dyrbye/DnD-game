import { describe, expect, it } from 'vitest';
import { CATALOGS, LANGUAGES, format, isLanguage, missingKeys, pluralForm, translate, translatePlural, translator, type Catalog, type Language } from './i18n';
import { en } from './i18n/en';
import { defaultSettings, patchSettings, salvageSettings } from './settings';
import { llmIndicator, ttsIndicator } from './status';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n catalogs', () => {
  it('Danish has every English key', () => {
    expect(missingKeys('da')).toEqual([]);
  });

  it('no catalog has keys English lacks, and every text keeps the same placeholders', () => {
    for (const lang of LANGUAGES) {
      const cat: Catalog = CATALOGS[lang];
      for (const [key, text] of Object.entries(cat)) {
        expect(key in en, `${lang}: unknown key ${key}`).toBe(true);
        expect(placeholders(text!), `${lang}: ${key}`).toEqual(placeholders(en[key as keyof typeof en]));
        expect(text!.trim(), `${lang}: ${key} empty`).not.toBe('');
      }
    }
  });

  it('plural keys come in one/other pairs', () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith('.one')) expect(`${key.slice(0, -4)}.other` in en, key).toBe(true);
      if (key.endsWith('.other')) expect(`${key.slice(0, -6)}.one` in en, key).toBe(true);
    }
  });
});

describe('translate', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('Day {day}, {x}', { day: 3 })).toBe('Day 3, {x}');
    expect(translate('en', 'fallen.title', { name: 'Brin' })).toBe('Brin has fallen');
    expect(translate('da', 'fallen.title', { name: 'Brin' })).toBe('Brin er faldet');
  });

  it('falls back to English when a catalog misses a key', () => {
    const saved = CATALOGS.da['title.newGame'];
    delete CATALOGS.da['title.newGame'];
    try {
      expect(translate('da', 'title.newGame')).toBe('New Game');
    } finally {
      CATALOGS.da['title.newGame'] = saved!;
    }
  });

  it('picks plural forms per language', () => {
    expect(pluralForm('en', 1)).toBe('one');
    expect(pluralForm('en', 0)).toBe('other');
    expect(pluralForm('da', 1)).toBe('one');
    expect(pluralForm('da', 2)).toBe('other');
    expect(translatePlural('en', 'status.voices', 1)).toBe('1 voice installed.');
    expect(translatePlural('da', 'status.voices', 4)).toBe('4 stemmer installeret.');
  });

  it('isLanguage guards stored values', () => {
    expect(isLanguage('da')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe('language setting', () => {
  it('defaults to English, so older settings files load unchanged', () => {
    expect(defaultSettings().gameplay.language).toBe('en');
    expect(salvageSettings({ gameplay: { objectiveHint: true } }).gameplay).toEqual({ objectiveHint: true, language: 'en' });
  });

  it('accepts only known languages', () => {
    const ok = patchSettings(defaultSettings(), { gameplay: { language: 'da' } });
    expect(ok.ok && ok.settings.gameplay.language).toBe('da');
    expect(patchSettings(defaultSettings(), { gameplay: { language: 'xx' } }).ok).toBe(false);
    expect(salvageSettings({ gameplay: { language: 'xx', objectiveHint: true } }).gameplay).toEqual({ objectiveHint: true, language: 'en' });
  });
});

describe('status lights in the chosen language', () => {
  const llm = { provider: 'ollama', reachable: true, modelAvailable: true, modelLoaded: true, model: 'llama3.2:3b' } as Parameters<typeof llmIndicator>[0];
  it.each<[Language, string]>([
    ['en', 'AI: ready'],
    ['da', 'AI: klar'],
  ])('%s', (lang, label) => {
    const tr = translator(lang);
    expect(llmIndicator(llm, tr).label).toBe(label);
    expect(llmIndicator(llm, tr).detail).toContain('llama3.2:3b');
  });

  it('voice count uses the plural helper', () => {
    const tts = { provider: 'piper', ready: true, voices: ['a', 'b'] } as unknown as Parameters<typeof ttsIndicator>[0];
    expect(ttsIndicator(tts, true, translator('da')).detail).toBe('2 stemmer installeret.');
  });
});
