import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';

const db = loadSrd();
const spell = (id: string) => db.spells.get(id)!;

describe('spells data', () => {
  it('has all 339 SRD spells across levels 0–9', () => {
    expect(db.spells.size).toBe(339);
    const perLevel = new Array(10).fill(0);
    for (const s of db.spells.values()) perLevel[s.level]++;
    expect(perLevel).toEqual([27, 57, 57, 42, 34, 38, 31, 20, 17, 16]);
  });

  it('parses headers', () => {
    expect(spell('fireball')).toMatchObject({ level: 3, school: 'evocation', classes: ['sorcerer', 'wizard'], range: { kind: 'feet', amount: 150 } });
    expect(spell('healing_word').castingTime.unit).toBe('bonus_action');
    expect(spell('shield').castingTime).toMatchObject({ unit: 'reaction', trigger: expect.stringContaining('hit by an attack') });
    expect(spell('detect_magic').castingTime.ritual).toBe(true);
    expect(spell('hold_person').duration).toEqual({ unit: 'minute', amount: 1, concentration: true });
    expect(spell('barkskin').components).toMatchObject({ v: true, s: true, m: true });
    expect(spell('revivify').components).toMatchObject({ materialCost: 30000, consumed: true });
  });

  it('extracts mechanics hints and auto effects', () => {
    expect(spell('fire_bolt').effects![0]).toMatchObject({ kind: 'attack', attack: 'ranged_spell' });
    expect(spell('fire_bolt').cantripUpgrade).toBeTruthy();
    expect(spell('fireball').effects![0]).toMatchObject({
      kind: 'area',
      area: { shape: 'sphere', size: 20 },
      effects: [{ kind: 'save', ability: 'dex', onSuccess: 'half', onFail: [{ kind: 'damage', upcast: '1d6' }] }],
    });
    expect(spell('lightning_bolt').area).toEqual({ shape: 'line', size: 100, width: 5 });
    expect(spell('cure_wounds').effects).toEqual([{ kind: 'heal', dice: '2d8', addSpellMod: true, upcast: '2d8' }]);
    expect(spell('hold_person').effects![0]).toMatchObject({ kind: 'save', ability: 'wis', onFail: [{ kind: 'condition', condition: 'paralyzed' }] });
  });

  it('every class spellcaster has spells, and referenced spells exist', () => {
    for (const c of db.classes.values()) {
      if (c.spellcasting.progression !== 'none') expect(db.spellsForClass(c.id).length, c.id).toBeGreaterThan(20);
    }
    const refs: [string, string][] = [];
    for (const sp of db.species.values()) for (const l of sp.lineages ?? []) for (const ids of Object.values(l.spells ?? {})) ids.forEach((id) => refs.push([`${sp.id}/${l.id}`, id]));
    for (const sub of db.subclasses.values()) for (const ids of Object.values(sub.spells ?? {})) ids.forEach((id) => refs.push([sub.id, id]));
    expect(refs.length).toBeGreaterThan(50);
    for (const [owner, id] of refs) expect(db.spells.has(id), `${owner} → ${id}`).toBe(true);
  });
});
