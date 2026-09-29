/**
 * Tests for the A034c audit of auto-generated spell effects: partial/wrong parses are replaced
 * by overrides (core effects + a hook named after the spell), 50+ more spells got hooks, and
 * guards keep the importer from applying damage to lingering, summoning or teleport spells.
 */
import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import type { Effect } from '../data/common';
import { loadSrd } from '../data/srdBundle';
import overridesJson from '../../../data/srd/overrides/spells.json';
import { createEffectContext, executeEffects } from './effects';
import { hasCondition } from './conditions';
import { scaleCantripEffects } from './spellcasting';

/** Fixed dice: returns faces in order (d20s and damage dice share the queue). */
function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
}

function make(id: string, over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id,
    name: id,
    kind: 'monster',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 40,
    hp: 40,
    ac: 13,
    speed: { walk: 30 },
    ...over,
  });
}

const db = loadSrd();
const spell = (id: string) => {
  const s = db.spells.get(id);
  if (!s) throw new Error(`missing spell ${id}`);
  return s;
};
const caster = make('caster', { kind: 'character' as never });
const overrideIds = new Set((overridesJson as unknown as { id: string }[]).map((o) => o.id));

function walk(effects: Effect[], visit: (e: Effect) => void): void {
  for (const e of effects) {
    visit(e);
    if (e.kind === 'save') {
      walk(e.onFail, visit);
      if (Array.isArray(e.onSuccess)) walk(e.onSuccess, visit);
    } else if (e.kind === 'attack') walk(e.onHit, visit);
    else if (e.kind === 'area') walk(e.effects, visit);
  }
}
function kinds(id: string): string[] {
  const out: string[] = [];
  walk(spell(id).effects ?? [], (e) => out.push(e.kind));
  return out;
}
function hookParams(id: string): Record<string, unknown> {
  let params: Record<string, unknown> | undefined;
  walk(spell(id).effects ?? [], (e) => {
    if (e.kind === 'hook' && e.hook === id && !params) params = e.params;
  });
  if (!params) throw new Error(`${id} has no hook`);
  return params;
}
const hookLogged = (log: { kind: string; text: string }[], hook: string) => log.some((l) => l.kind === 'hook' && l.text.includes(`"${hook}"`));

/** Auto-parse fixes (had wrong or partial effects before A034c). */
const FIXED = [
  'animal_friendship', 'banishment', 'befuddlement', 'blade_barrier', 'charm_monster', 'charm_person', 'chill_touch', 'cloudkill',
  'color_spray', 'compulsion', 'conjure_animals', 'conjure_celestial', 'conjure_elemental', 'conjure_woodland_beings',
  'contact_other_plane', 'contagion', 'control_water', 'dissonant_whispers', 'divine_word', 'dominate_beast', 'dominate_monster',
  'dominate_person', 'dream', 'earthquake', 'eldritch_blast', 'ensnaring_strike', 'faithful_hound', 'fear', 'finger_of_death', 'geas',
  'grease', 'harm', 'heat_metal', 'hold_monster', 'hold_person', 'holy_aura', 'incendiary_cloud', 'insect_plague', 'irresistible_dance',
  'mass_cure_wounds', 'mass_healing_word', 'mass_suggestion', 'mind_spike', 'phantasmal_force', 'phantasmal_killer', 'power_word_stun',
  'produce_flame', 'ray_of_frost', 'ray_of_sickness', 'sacred_flame', 'searing_smite', 'shocking_grasp', 'sleet_storm', 'starry_wisp',
  'stinking_cloud', 'suggestion', 'sunbeam', 'sunburst', 'symbol', 'telekinesis', 'thunderwave', 'vicious_mockery', 'wind_wall',
];
/** Spells that had no effects at all before A034c. */
const NEW = [
  'barkskin', 'beacon_of_hope', 'blink', 'calm_emotions', 'confusion', 'darkness', 'darkvision', 'death_ward', 'dimension_door',
  'dragons_breath', 'enhance_ability', 'enlarge_reduce', 'expeditious_retreat', 'feather_fall', 'fire_shield', 'flame_blade', 'fly',
  'fog_cloud', 'freedom_of_movement', 'goodberry', 'greater_restoration', 'guardian_of_faith', 'guidance', 'gust_of_wind', 'jump',
  'levitate', 'longstrider', 'magic_weapon', 'mass_heal', 'mirror_image', 'pass_without_trace', 'polymorph', 'protection_from_energy',
  'protection_from_evil_and_good', 'raise_dead', 'ray_of_enfeeblement', 'remove_curse', 'resistance', 'resurrection', 'sanctuary',
  'see_invisibility', 'shillelagh', 'shining_smite', 'silence', 'sorcerous_burst', 'spare_the_dying', 'spider_climb', 'spike_growth',
  'stoneskin', 'true_resurrection', 'true_strike', 'vitriolic_sphere', 'warding_bond', 'water_breathing',
];

describe('A034c spell audit: data', () => {
  it('all SRD data validates', () => {
    expect(db.errors).toEqual([]);
  });

  it('every fixed and newly covered spell is overridden and has a hook named after it', () => {
    expect(NEW.length).toBeGreaterThanOrEqual(30);
    for (const id of [...FIXED, ...NEW]) {
      expect(overrideIds.has(id), id).toBe(true);
      expect(Object.keys(hookParams(id)).length, id).toBeGreaterThan(0);
    }
  });

  it('summons, zones and delayed effects are hook-only (no instant damage on cast)', () => {
    for (const id of ['conjure_animals', 'conjure_celestial', 'conjure_elemental', 'conjure_woodland_beings', 'heat_metal', 'earthquake', 'dream', 'faithful_hound', 'control_water', 'symbol', 'sleet_storm', 'stinking_cloud', 'power_word_stun', 'contact_other_plane', 'holy_aura', 'produce_flame']) {
      expect(kinds(id), id).toEqual(['hook']);
    }
    expect(hookParams('conjure_animals')).toMatchObject({ save: 'dex', damage: { dice: '3d10', type: 'slashing' }, upcast: '1d10' });
    expect(hookParams('conjure_elemental')).toMatchObject({ damageDice: '8d8', restrainedFailDamageDice: '4d8' });
    expect(hookParams('heat_metal')).toMatchObject({ damage: { dice: '2d8', type: 'fire' }, repeatAction: 'bonus', save: 'con' });
    expect(hookParams('power_word_stun')).toMatchObject({ hpThreshold: 150, condition: 'stunned' });
  });

  it('partial parses now capture every damage part and condition', () => {
    expect(kinds('contagion')).toEqual(['save', 'damage', 'condition', 'hook']);
    expect(kinds('geas')).toEqual(['save', 'condition', 'hook']);
    expect(hookParams('geas')).toMatchObject({ violationDamage: { dice: '5d10', type: 'psychic' } });
    expect(kinds('sunbeam')).toEqual(['area', 'save', 'damage', 'condition', 'hook']);
    expect(spell('sunbeam').effects![0]).toMatchObject({ area: { shape: 'line', size: 60, width: 5 } });
    expect(kinds('sunburst')).toEqual(['area', 'save', 'damage', 'condition', 'hook']);
    expect(kinds('phantasmal_force')).toEqual(['save', 'hook']);
    expect(kinds('searing_smite')).toEqual(['damage', 'hook']);
    expect(kinds('ensnaring_strike')).toEqual(['save', 'condition', 'hook']);
    const dw = hookParams('divine_word');
    expect(dw.hpThresholds).toHaveLength(4);
    expect(kinds('divine_word')).toEqual(['save', 'hook']);
    expect(kinds('vitriolic_sphere')).toEqual(['area', 'save', 'damage', 'hook']);
  });

  it('cantrips with riders keep core damage (cantrip scaling still applies) plus a rider hook', () => {
    for (const id of ['ray_of_frost', 'chill_touch', 'shocking_grasp', 'starry_wisp', 'vicious_mockery']) {
      expect(kinds(id), id).toContain('damage');
      expect(kinds(id), id).toContain('hook');
    }
    const scaled = scaleCantripEffects(spell('ray_of_frost').effects!, 2);
    expect(scaled[0]).toMatchObject({ kind: 'attack', onHit: [{ kind: 'damage', damage: [{ dice: '2d8', type: 'cold' }] }, { kind: 'hook', hook: 'ray_of_frost' }] });
  });

  it('guard: no un-overridden spell deals damage if its text mentions summoning or teleporting', () => {
    for (const s of db.spells.values()) {
      if (overrideIds.has(s.id) || !/summon|teleport/i.test(s.text)) continue;
      const k: string[] = [];
      walk(s.effects ?? [], (e) => k.push(e.kind));
      expect(k.includes('damage'), s.id).toBe(false);
    }
  });

  it('guard: every un-overridden auto effect is an instantaneous spell (lingering spells need hand review)', () => {
    for (const s of db.spells.values()) {
      if (overrideIds.has(s.id) || !s.effects) continue;
      expect(s.duration.unit, s.id).toBe('instantaneous');
    }
  });
});

describe('A034c spell audit: behaviour', () => {
  it('Ray of Frost: 1d8 cold on a hit plus the speed rider hook', () => {
    const ctx = createEffectContext({ rng: fixed(15, 5), source: caster, targets: [make('a')], attackBonus: 5 });
    executeEffects(spell('ray_of_frost').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(35);
    expect(hookLogged(ctx.log, 'ray_of_frost')).toBe(true);
  });

  it('Heat Metal: no damage or save runs on cast, only the hook', () => {
    const ctx = createEffectContext({ rng: fixed(1, 8, 8), source: caster, targets: [make('a')], saveDc: 15 });
    executeEffects(spell('heat_metal').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(40);
    expect(ctx.log.map((l) => l.kind)).toEqual(['hook']);
    expect(hookLogged(ctx.log, 'heat_metal')).toBe(true);
  });

  it('Banishment: Cha save; failure → Incapacitated + hook, success → nothing', () => {
    const fail = createEffectContext({ rng: fixed(3), source: caster, targets: [make('a')], saveDc: 15 });
    executeEffects(spell('banishment').effects!, ['a'], fail);
    expect(hasCondition(fail.creatures.get('a')!, 'incapacitated')).toBe(true);
    expect(hookLogged(fail.log, 'banishment')).toBe(true);
    const ok = createEffectContext({ rng: fixed(19), source: caster, targets: [make('a')], saveDc: 15 });
    executeEffects(spell('banishment').effects!, ['a'], ok);
    expect(hasCondition(ok.creatures.get('a')!, 'incapacitated')).toBe(false);
    expect(hookLogged(ok.log, 'banishment')).toBe(false);
  });

  it('Conjure Animals no longer makes a Strength save or deals damage on cast', () => {
    const ctx = createEffectContext({ rng: fixed(1, 10, 10, 10), source: caster, targets: [make('a')], saveDc: 15 });
    executeEffects(spell('conjure_animals').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(40);
    expect(ctx.log.some((l) => l.kind === 'save')).toBe(false);
  });

  it('Searing Smite: 1d6 fire extra damage on the hit, no save on cast', () => {
    const ctx = createEffectContext({ rng: fixed(4), source: caster, targets: [make('a')] });
    executeEffects(spell('searing_smite').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(36);
    expect(ctx.log.some((l) => l.kind === 'save')).toBe(false);
    expect(hookLogged(ctx.log, 'searing_smite')).toBe(true);
  });

  it('Vitriolic Sphere: 10d4 acid, half on a success; delayed damage hook only on a failure', () => {
    const ctx = createEffectContext({ rng: fixed(3, ...new Array(10).fill(1), 18), source: caster, targets: [make('a'), make('b')], saveDc: 15 });
    executeEffects(spell('vitriolic_sphere').effects!, ['a', 'b'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(30);
    expect(ctx.creatures.get('b')!.hp).toBe(35);
    expect(ctx.log.filter((l) => l.kind === 'hook').map((l) => l.targetId)).toEqual(['a']);
  });

  it('Contagion: 11d8 necrotic and Poisoned on a failed save', () => {
    const ctx = createEffectContext({ rng: fixed(2, ...new Array(11).fill(1)), source: caster, targets: [make('a')], saveDc: 15 });
    executeEffects(spell('contagion').effects!, ['a'], ctx);
    const a = ctx.creatures.get('a')!;
    expect(a.hp).toBe(29);
    expect(hasCondition(a, 'poisoned')).toBe(true);
  });

  it('Sleet Storm and Stinking Cloud no longer impose conditions on cast', () => {
    for (const id of ['sleet_storm', 'stinking_cloud']) {
      const ctx = createEffectContext({ rng: fixed(1), source: caster, targets: [make('a')], saveDc: 15 });
      executeEffects(spell(id).effects!, ['a'], ctx);
      const a = ctx.creatures.get('a')!;
      expect(hasCondition(a, 'prone') || hasCondition(a, 'poisoned'), id).toBe(false);
    }
  });

  it('Sunbeam: 6d8 radiant and Blinded on a failed Con save', () => {
    const ctx = createEffectContext({ rng: fixed(2, ...new Array(6).fill(2)), source: caster, targets: [make('a')], saveDc: 15 });
    executeEffects(spell('sunbeam').effects!, ['a'], ctx);
    const a = ctx.creatures.get('a')!;
    expect(a.hp).toBe(28);
    expect(hasCondition(a, 'blinded')).toBe(true);
  });
});
