import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCAR_LOCATIONS } from '../../../engine/core/creature';
import { CATALOGS, translator, type MessageKey } from '../../../shared/i18n';
import { applyLanguage, coins } from '../i18n';
import { formatCoins } from '../text';
import { scarLabel, scarLine, wearText, woundText } from './labels';

const DA = translator('da');

afterEach(() => applyLanguage('en'));

describe('game screen texts in Danish', () => {
  it('coins use the Danish abbreviations, English stays the default', () => {
    expect(formatCoins(1455)).toBe('14 GP 5 SP 5 CP');
    expect(formatCoins(1455, DA)).toBe('14 gm 5 sm 5 km');
    expect(formatCoins(0, DA)).toBe('0 gm');
    applyLanguage('da');
    expect(coins(250)).toBe('2 gm 5 sm');
  });

  it('scar places, armor wear and wounds follow the language', () => {
    applyLanguage('da');
    expect(scarLabel('left_cheek')).toBe('Venstre kind');
    expect(scarLine({ id: 'scar-1', location: 'jaw', cause: 'story', description: 'a thin line', origin: 'a goblin', at: 0 })).toBe('Kæbe: a thin line (a goblin)');
    expect(wearText(0)).toBe('som ny');
    expect(wearText(80)).toBe('medtaget');
    expect(woundText(0)).toBeUndefined();
    expect(woundText(3)).toBe('hårdt såret');
    applyLanguage('en');
    expect(scarLabel('left_leg')).toBe('Left thigh');
    expect(wearText(15)).toBe('scuffed');
  });

  it('every data-driven key exists in both languages', () => {
    const keys: string[] = [
      ...SCAR_LOCATIONS.map((l) => `scar.${l}`),
      ...['pristine', 'scuffed', 'scratched', 'dented', 'battered'].map((w) => `wear.${w}`),
      ...[1, 2, 3, 4].map((n) => `wound.${n}`),
      ...['armor', 'shield', 'main_hand', 'off_hand', 'worn'].map((s) => `inv.slot.${s}`),
      ...['cantrips', 'spells', 'weapon_mastery', 'expertise', 'skills'].map((k) => `levelup.pick.${k}`),
      ...['road', 'trail', 'river', 'sea'].map((k) => `map.kind.${k}`),
    ];
    for (const k of keys) {
      expect(CATALOGS.en[k as MessageKey], k).toBeTruthy();
      expect(CATALOGS.da[k as MessageKey], k).toBeTruthy();
    }
  });

  it('plurals and placeholders render in Danish', () => {
    expect(DA.tn('map.days', 2, { hours: 14 })).toBe('2 dage (14 t på vejen)');
    expect(DA.tn('levelup.pointsLeft', 1)).toBe('1 point tilbage');
    expect(DA.t('combat.round', { n: 3 })).toBe('Runde 3');
  });
});

describe('game and combat screens use the catalog', () => {
  const root = join(process.cwd(), 'src/client');
  const files = [
    ...readdirSync(join(root, 'ui/game')).filter((f) => f.endsWith('.tsx')).map((f) => `ui/game/${f}`),
    ...readdirSync(join(root, 'ui/combat')).filter((f) => f.endsWith('.tsx')).map((f) => `ui/combat/${f}`),
    ...readdirSync(join(root, 'three')).filter((f) => f.endsWith('.tsx')).map((f) => `three/${f}`),
    'ui/AboutPanel.tsx',
    'ui/SaveBrowser.tsx',
  ];

  it('no plain English text between JSX tags or in visible attributes', () => {
    const found: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(root, f), 'utf8');
      // Same checks as the creator scan (creatorI18n.test.ts); skips `=>` arrows and TS generics (`?: Record<`).
      for (const m of src.matchAll(/(?<!=)>([^<>{}\n]*[A-Za-z]{2}[^<>{}\n]*)</g)) if (!m[1]!.includes('?:')) found.push(`${f}: ${m[1]!.trim()}`);
      for (const m of src.matchAll(/^\s+([A-Z][a-z]+(?: [a-z]+)*)\s*$/gm)) found.push(`${f}: ${m[1]}`);
      for (const m of src.matchAll(/\b(?:aria-label|placeholder|title|leaveLabel)="([^"]*[A-Za-z][^"]*)"/g)) found.push(`${f}: ${m[1]}`);
    }
    expect(found).toEqual([]);
  });
});
