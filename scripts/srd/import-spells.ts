/**
 * Imports spells.json from spells.md (all SRD 5.2.1 spells, cantrips to level 9).
 *   npx tsx scripts/srd/import-spells.ts
 * Besides the header fields, it extracts mechanics hints from the text (attack, save, damage,
 * area, conditions) and builds `effects` for the unambiguous common patterns. Anything more
 * complex is refined by hand in data/srd/overrides/spells.json or implemented as a hook.
 */
import { toId, type Area, type Effect } from '../../src/engine/data/common';
import { SPELL_SCHOOLS, type Spell } from '../../src/engine/data/schemas';
import { ABILITIES, ABILITY_NAMES, CONDITIONS, DAMAGE_TYPES, type Ability, type Condition, type DamageType } from '../../src/engine/rules/basics';
import { applyOverrides, cleanText, costToCp, readSource, sections, writeData } from './lib';

const md = readSource('spells.md');
const abilityByName = Object.fromEntries(ABILITIES.map((a) => [ABILITY_NAMES[a], a])) as Record<string, Ability>;

function castingTime(v: string): Spell['castingTime'] {
  const ritual = /\bor Ritual\b/.test(v);
  const first = v.replace(/\s*\(.*?\)/g, '').replace(/\s+or .*$/, '').replace(/,.*$/, '').trim();
  const trigger = /Reaction, which you take (.+)$/.exec(v)?.[1];
  if (first === 'Action') return { unit: 'action', amount: 1, ritual };
  if (first === 'Bonus Action') return { unit: 'bonus_action', amount: 1, ritual };
  if (first === 'Reaction') return { unit: 'reaction', amount: 1, ritual, ...(trigger && { trigger }) };
  const m = /^(\d+) (minute|hour)s?$/.exec(first);
  if (!m) throw new Error(`Bad casting time: ${v}`);
  return { unit: m[2] as 'minute' | 'hour', amount: Number(m[1]), ritual };
}

function range(v: string): Spell['range'] {
  if (v === 'Self') return { kind: 'self' };
  if (v === 'Touch') return { kind: 'touch' };
  if (v === 'Sight') return { kind: 'sight' };
  if (v === 'Unlimited') return { kind: 'unlimited' };
  if (v === 'Special') return { kind: 'special' };
  const m = /^(\d+) (feet|foot|miles?)$/.exec(v);
  if (!m) throw new Error(`Bad range: ${v}`);
  return { kind: m[2]!.startsWith('mile') ? 'miles' : 'feet', amount: Number(m[1]) };
}

function components(v: string): Spell['components'] {
  const material = /M \((.+)\)$/.exec(v)?.[1];
  const cost = material && /([\d,]+)\+? GP/.exec(material);
  return {
    v: /\bV\b/.test(v),
    s: /\bS\b/.test(v),
    m: /\bM\b/.test(v),
    ...(material && { material }),
    ...(cost && { materialCost: costToCp(`${cost[1]} GP`) }),
    consumed: Boolean(material && /consume/i.test(material)),
  };
}

function duration(v: string): Spell['duration'] {
  const concentration = v.startsWith('Concentration');
  const rest = v.replace(/^Concentration,\s*/, '').replace(/^[Uu]p to\s*/, '');
  if (rest === 'Instantaneous') return { unit: 'instantaneous', concentration };
  if (rest.startsWith('Until dispelled')) return { unit: 'until_dispelled', concentration };
  if (rest === 'Special') return { unit: 'special', concentration };
  const m = /^(\d+) (round|minute|hour|day)s?$/.exec(rest);
  if (!m) throw new Error(`Bad duration: ${v}`);
  return { unit: m[2] as 'round', amount: Number(m[1]), concentration };
}

const SHAPES: Record<string, Area['shape']> = {
  Sphere: 'sphere',
  Cube: 'cube',
  Cone: 'cone',
  Line: 'line',
  Cylinder: 'cylinder',
  Emanation: 'emanation',
};

function findArea(text: string): Area | undefined {
  const cyl = /(\d+)-foot-radius,\s*(\d+)-foot-(?:high|tall) Cylinder/.exec(text);
  if (cyl) return { shape: 'cylinder', size: Number(cyl[1]), width: Number(cyl[2]) };
  const line = /(\d+)-foot-long,?\s*(\d+)-foot-wide Line|(\d+)-foot Line that is (\d+) feet wide/.exec(text);
  if (line) return { shape: 'line', size: Number(line[1] ?? line[3]), width: Number(line[2] ?? line[4]) };
  const m = /(\d+)-foot(?:-radius)?\s+(Sphere|Cube|Cone|Line|Cylinder|Emanation)/.exec(text);
  if (m) return { shape: SHAPES[m[2]!]!, size: Number(m[1]) };
  return undefined;
}

function findDamage(text: string): { dice: string; type: DamageType }[] {
  const out: { dice: string; type: DamageType }[] = [];
  for (const m of text.matchAll(/(\d+d\d+(?:\s*\+\s*\d+)?) (\w+) damage/g)) {
    const type = m[2]!.toLowerCase() as DamageType;
    if (!DAMAGE_TYPES.includes(type)) continue;
    const dice = m[1]!.replace(/\s+/g, '');
    if (!out.some((d) => d.dice === dice && d.type === type)) out.push({ dice, type });
  }
  return out;
}

/** Effects for the unambiguous patterns only; everything else stays hint-only. */
function autoEffects(s: Omit<Spell, 'effects'>, text: string, upcast?: string): Effect[] | undefined {
  const damage = s.damage ?? [];
  const wrap = (effects: Effect[]): Effect[] => (s.area ? [{ kind: 'area', area: s.area, effects }] : effects);
  const damageEffect = (): Effect => ({ kind: 'damage', damage, ...(upcast && { upcast }) });
  if (s.attack && damage.length === 1 && !s.save) {
    return [{ kind: 'attack', attack: s.attack === 'melee' ? 'melee_spell' : 'ranged_spell', onHit: [damageEffect()] }];
  }
  if (s.save && damage.length === 1 && !s.attack) {
    const half = /half as much damage/.test(text);
    return wrap([{ kind: 'save', ability: s.save, onFail: [damageEffect()], onSuccess: half ? 'half' : 'none' }]);
  }
  const heal = /regains? (?:a number of )?Hit Points equal to (\d+d\d+) plus your spellcasting ability modifier/.exec(text);
  if (heal && !s.save && !s.attack) {
    return [{ kind: 'heal', dice: heal[1]!, addSpellMod: true, ...(upcast && { upcast }) }];
  }
  if (s.save && damage.length === 0 && s.conditions?.length === 1 && !s.attack) {
    const d = s.duration.unit === 'instantaneous' ? undefined : s.duration;
    return wrap([{ kind: 'save', ability: s.save, onFail: [{ kind: 'condition', condition: s.conditions[0]!, ...(d && { duration: d }) }], onSuccess: 'none' }]);
  }
  return undefined;
}

const spells: Spell[] = [];
for (const sec of sections(md, 4)) {
  const head = /^_(?:Level (\d) (\w+)|(\w+) Cantrip) \(([^)]+)\)_/.exec(sec.body);
  if (!head) continue; // not a spell (intro sections)
  const level = head[1] ? Number(head[1]) : 0;
  const school = (head[2] ?? head[3])!.toLowerCase() as Spell['school'];
  if (!SPELL_SCHOOLS.includes(school)) throw new Error(`${sec.title}: bad school ${school}`);
  const field = (label: string) => {
    // A few spells say "Component:" instead of "Components:".
    const m = new RegExp(`\\*\\*${label === 'Components' ? 'Components?' : label}:\\*\\*\\s*(.+)`).exec(sec.body);
    if (!m) throw new Error(`${sec.title}: missing ${label}`);
    return m[1]!.trim();
  };
  const afterHeader = sec.body.slice(sec.body.indexOf(field('Duration')) + field('Duration').length);
  const [mainRaw, ...extra] = afterHeader.split(/\n(?=_(?:Using a Higher-Level Spell Slot|Cantrip Upgrade)\._)/);
  const text = cleanText(mainRaw!);
  const higher = extra.find((e) => e.startsWith('_Using a Higher-Level'));
  const upgrade = extra.find((e) => e.startsWith('_Cantrip Upgrade'));
  const higherText = higher && cleanText(higher.replace(/^_Using a Higher-Level Spell Slot\._\s*/, ''));
  const upgradeText = upgrade && cleanText(upgrade.replace(/^_Cantrip Upgrade\._\s*/, ''));

  const attack = /\bmelee spell attack\b/i.test(text) ? 'melee' : /\branged spell attack\b/i.test(text) ? 'ranged' : undefined;
  const saveName = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.exec(text)?.[1];
  const damage = findDamage(text);
  const area = findArea(text);
  const conditions = [...new Set([...text.matchAll(/(?:has|have|gains?) the (\w+) condition/g)].map((m) => m[1]!.toLowerCase()))].filter(
    (c): c is Condition => (CONDITIONS as readonly string[]).includes(c),
  );
  const upcast = /increases by (\d+d\d+) for each (?:spell )?slot level above/.exec(higherText ?? '')?.[1];

  const base: Omit<Spell, 'effects'> = {
    id: toId(sec.title),
    name: sec.title,
    level,
    school,
    classes: head[4]!.split(/,\s*/).map((c) => toId(c)),
    castingTime: castingTime(field('Casting Time')),
    range: range(field('Range')),
    components: components(field('Components')),
    duration: duration(field('Duration')),
    text,
    ...(higherText && { higherLevels: higherText }),
    ...(upgradeText && { cantripUpgrade: upgradeText }),
    ...(attack && { attack }),
    ...(saveName && { save: abilityByName[saveName]! }),
    ...(damage.length > 0 && { damage }),
    ...(area && { area }),
    ...(conditions.length > 0 && { conditions }),
  };
  const effects = autoEffects(base, text, upcast);
  spells.push({ ...base, ...(effects && { effects }) });
}

writeData('spells.json', applyOverrides(spells, 'spells.json'));
const byLevel = spells.reduce<Record<number, number>>((acc, s) => ((acc[s.level] = (acc[s.level] ?? 0) + 1), acc), {});
console.log('by level:', JSON.stringify(byLevel), `| with effects: ${spells.filter((s) => s.effects).length}`);
