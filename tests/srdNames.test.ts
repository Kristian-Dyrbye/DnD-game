/** SRD rules names in Danish (A149): bundled overlays match the folder, are complete and current, and reach the roll math. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStrings, parseOverlay } from '../src/shared/contentI18n';
import { abilityName, abilityShort, ruleWord, skillName, spellIdName, spellName, srdName, SRD_NAME_KINDS, SRD_NAME_OVERLAYS, type SrdNameKind } from '../src/engine/i18n/srdNames';
import { srdNameSources } from '../src/engine/i18n/srdNameSources';
import { messages } from '../src/engine/i18n';
import { savingThrow, skillCheck } from '../src/engine/rules/checks';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { loadSrd } from '../src/engine/data/srdBundle';
import { Rng } from '../src/engine/core/rng';

const db = loadSrd();
const root = path.join(process.cwd(), 'data', 'i18n');

describe('SRD name overlays (A149)', () => {
  it('bundles every data/i18n/<lang>/srd/<kind>.json file', () => {
    const onDisk: string[] = [];
    for (const lang of fs.readdirSync(root, { withFileTypes: true })) {
      const dir = path.join(root, lang.name, 'srd');
      if (!lang.isDirectory() || !fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) onDisk.push(`${lang.name}/${f.slice(0, -5)}`);
    }
    const bundled = Object.entries(SRD_NAME_OVERLAYS).flatMap(([lang, o]) => Object.keys(o ?? {}).map((k) => `${lang}/${k}`));
    expect(bundled.sort()).toEqual(onDisk.sort());
    for (const k of onDisk) expect(SRD_NAME_KINDS).toContain(k.split('/')[1]);
  });

  it('bundled overlays are valid, complete and current', () => {
    for (const [lang, overlays] of Object.entries(SRD_NAME_OVERLAYS)) {
      for (const [kind, overlay] of Object.entries(overlays ?? {})) {
        parseOverlay(overlay);
        const r = checkStrings(srdNameSources(kind as SrdNameKind), overlay);
        expect({ lang, kind, missing: r.missing, stale: r.stale, orphan: r.orphan, broken: r.broken }).toEqual({ lang, kind, missing: [], stale: [], orphan: [], broken: [] });
      }
    }
  });

  it('every class, species, background, feat, weapon and armor id has a source name', () => {
    const ids = (kind: SrdNameKind) => new Set(srdNameSources(kind).map((s) => s.path));
    for (const c of db.classes.values()) expect(ids('classes')).toContain(c.id);
    for (const w of db.weapons.values()) expect(ids('weapons')).toContain(w.id);
    for (const s of db.species.values()) expect(ids('species')).toContain(s.id);
  });

  it('looks names up with English fallback', () => {
    expect(srdName('da', 'classes', 'fighter', 'Fighter')).toBe('Kriger');
    expect(srdName('en', 'classes', 'fighter', 'Fighter')).toBe('Fighter');
    expect(srdName('da', 'monsters', 'goblin_warrior', 'Goblin Warrior')).toBe('Goblinkriger');
    expect(srdName('da', 'gear', 'rope', 'Rope')).toBe('Reb');
    expect(srdName('da', 'gear', 'rope_hempen', 'Rope')).toBe('Rope'); // unknown id → English
    expect(srdName('da', 'classes', 'no_such_class', 'Nope')).toBe('Nope');
    expect(abilityName('da', 'dex')).toBe('Behændighed');
    expect(abilityShort('da', 'con')).toBe('Kon');
    expect(abilityShort('en', 'con')).toBe('Con');
    expect(skillName('da', 'sleight_of_hand')).toBe('Fingerfærdighed');
    expect(skillName('en', 'sleight_of_hand')).toBe('Sleight of Hand');
    expect(ruleWord('da', 'damage', 'fire', 'Fire')).toBe('Ild');
    expect(srdName('da', 'conditions', 'poisoned', 'Poisoned')).toBe('Forgiftet');
  });

  it('every spell has a Danish name; ids of concentration lines stay ids in English (A149b)', () => {
    for (const s of db.spells.values()) {
      const da = spellName('da', s);
      expect(da, s.id).not.toBe('');
      expect(spellName('en', s)).toBe(s.name);
    }
    expect(spellName('da', db.spells.get('fireball')!)).toBe('Ildkugle');
    expect(spellIdName('da', 'hold_person')).toBe('Lam person');
    expect(spellIdName('en', 'hold_person')).toBe('hold_person');
    const translated = [...db.spells.values()].filter((s) => spellName('da', s) !== s.name).length;
    expect(translated).toBeGreaterThan(300); // a few names are the same in Danish (Alarm, Blink, Symbol…)
  });

  it('spell screens show spell names through srdText', () => {
    for (const f of ['src/client/ui/creator/SpellsStep.tsx', 'src/client/ui/game/LevelUpPanel.tsx', 'src/client/ui/combat/CombatScreen.tsx']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src, f).toMatch(/srdText\('spells'/);
      expect(src, f).not.toMatch(/\{sp\.name\}|name: s\.name/);
    }
  });

  it('item screens show item names through itemText (A149d)', () => {
    for (const f of ['src/client/ui/game/InventoryPanel.tsx', 'src/client/ui/game/ShopPanel.tsx', 'src/client/ui/game/CharacterScreen.tsx', 'src/client/ui/creator/EquipmentStep.tsx', 'src/client/ui/creator/BackgroundStep.tsx', 'src/client/ui/creator/ReviewStep.tsx', 'src/client/ui/combat/CombatScreen.tsx']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src, f).toMatch(/itemText\(/);
      expect(src, f).not.toMatch(/db\.item\([^)]*\)\?\.name|itemName\([^)]*db\)|\{(l|o|it)\.name\}/);
    }
  });

  it('client UI shows ability/skill names through ui/srdText.ts, not the English tables', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && /\b(ABILITY_NAMES|SKILL_NAMES)\[/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(path.join(process.cwd(), 'src', 'client'));
    expect(offenders).toEqual([]);
  });

  it('check and save math lines use Danish ability and skill names', () => {
    const hero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed(3))), db);
    const da = messages('da');
    const stealth = skillCheck({ ...hero, exhaustion: 1 }, 'stealth', { rng: Rng.fromSeed(1), dc: 12, msgs: da });
    expect(stealth.label).toBe('Snigen');
    expect(stealth.text).toContain('(Behændighed)');
    expect(stealth.text).toMatch(/\((Kyndighed|Ekspertise): Snigen\)/);
    expect(stealth.text).toContain('(Udmattelse)');
    expect(stealth.text).not.toMatch(/Stealth|Dexterity|Proficiency|Exhaustion/);
    const save = savingThrow(hero, 'dex', { rng: Rng.fromSeed(2), dc: 12, msgs: da });
    expect(save.label).toBe('Behændighed-redningsslag');
    expect(save.text).toContain('(Kyndighed)');
    const en = skillCheck(hero, 'stealth', { rng: Rng.fromSeed(1), dc: 12 });
    expect(en.label).toBe('Stealth');
    expect(en.text).toMatch(/\((Proficiency|Expertise): Stealth\)/);
  });
});
