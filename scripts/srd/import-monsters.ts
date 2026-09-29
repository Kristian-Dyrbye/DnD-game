/**
 * Imports monsters.json from monsters-A-Z.md and animals.md (every SRD 5.2.1 stat block).
 *   npx tsx scripts/srd/import-monsters.ts
 */
import { toId, type Damage } from '../../src/engine/data/common';
import type { Monster } from '../../src/engine/data/schemas';
import {
  ABILITIES,
  ABILITY_NAMES,
  CONDITIONS,
  CREATURE_TYPES,
  DAMAGE_TYPES,
  SIZES,
  SKILLS,
  SKILL_NAMES,
  parseCR,
  type Ability,
  type Condition,
  type DamageType,
  type Size,
  type Skill,
} from '../../src/engine/rules/basics';
import { applyOverrides, cleanText, htmlTables, num, readSource, sections, writeData } from './lib';

type Action = Monster['actions'][number];

const abilityByName = Object.fromEntries(ABILITIES.map((a) => [ABILITY_NAMES[a], a])) as Record<string, Ability>;
const skillByName = Object.fromEntries(SKILLS.map((k) => [SKILL_NAMES[k], k])) as Record<string, Skill>;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

const signed = (s: string) => Number(s.replace(/[−–]/g, '-').replace('+', ''));

function line(body: string, key: string): string | undefined {
  const m = new RegExp(`\\*\\*${key}\\*\\*\\s*(.+?)\\s*(?:<br>)?\\s*$`, 'm').exec(body);
  return m?.[1]?.replace(/<br>/g, '').trim();
}

function parseSpeed(text: string): Monster['speed'] {
  const speed: Monster['speed'] = { walk: 0 };
  for (const part of text.split(/,\s*/)) {
    const m = /^(?:(Walk|Climb|Fly|Swim|Burrow)\s+)?(\d+) ft\.(\s*\(hover\))?/i.exec(part.trim());
    if (!m) continue;
    const kind = (m[1] ?? 'walk').toLowerCase() as 'walk' | 'climb' | 'fly' | 'swim' | 'burrow';
    speed[kind] = Number(m[2]);
    if (m[3]) speed.hover = true;
  }
  return speed;
}

/**
 * Always-on damage from a Hit/Failure clause. Extra damage that only applies conditionally
 * ("plus 2 (1d4) ... if the attack roll had Advantage") and alternatives (", or 2 (1d4) ... if
 * Bloodied") are left in the text for the engine hooks.
 */
function parseDamages(text: string): Damage[] {
  const out: Damage[] = [];
  const firstSentence = text.split(/\.\s/)[0]!;
  const clauses = firstSentence.split(/,?\s+(?=plus \d|or \d)/).filter((c, i) => i === 0 || (!/\bif\b/.test(c) && !c.startsWith('or ')));
  for (const m of clauses.join(' ').matchAll(/\d+ \((\d+d\d+(?:\s*[+−-]\s*\d+)?)\) (\w+) damage|\b(\d+) (\w+) damage/g)) {
    const dice = (m[1] ?? m[3])!.replace(/\s+/g, '').replace('−', '-');
    const type = (m[2] ?? m[4])!.toLowerCase() as DamageType;
    if (DAMAGE_TYPES.includes(type)) out.push({ dice, type });
  }
  return out;
}

function parseArea(text: string): NonNullable<Action['save']>['area'] {
  const line5 = /(\d+)-foot-long,?\s*(\d+)-foot-wide Line/.exec(text);
  if (line5) return { shape: 'line', size: Number(line5[1]), width: Number(line5[2]) };
  const m = /(\d+)-foot(?:-radius)?\s+(Sphere|Cube|Cone|Line|Cylinder|Emanation)/.exec(text);
  return m ? { shape: m[2]!.toLowerCase() as 'sphere', size: Number(m[1]) } : undefined;
}

function parseActions(body: string | undefined): Action[] {
  if (!body) return [];
  const out: Action[] = [];
  for (const m of body.matchAll(/\*\*_(.+?)\._\*\*\s*([\s\S]*?)(?=\n\*\*_|$)/g)) {
    let name = m[1]!.trim();
    const text = cleanText(m[2]!.replace(/&emsp;/g, ''));
    const action: Action = { name, text };
    const recharge = /\(Recharge (\d)(?:[–-]6)?\)/.exec(name);
    if (recharge) action.recharge = Number(recharge[1]);
    const perDay = /\((\d+)\/Day(?:[^)]*)\)/.exec(name);
    if (perDay) action.usesPerDay = Number(perDay[1]);
    const cost = /\(Costs (\d+) Actions\)/.exec(name);
    if (cost) action.cost = Number(cost[1]);
    name = name.replace(/\s*\(.*\)$/, '');
    action.name = name;

    const atk = /_(Melee|Ranged|Melee or Ranged) Attack Roll:_\s*([+−-]\d+),\s*(?:reach (\d+) ft\.)?(?:\s*or\s*)?(?:range (\d+)(?:\/(\d+))? ft\.)?/.exec(text);
    if (atk) {
      const hit = /_Hit:_\s*(.+?)(?:_|$)/s.exec(text)?.[1] ?? '';
      action.attack = {
        kind: atk[1] === 'Melee' ? 'melee' : atk[1] === 'Ranged' ? 'ranged' : 'melee_or_ranged',
        bonus: signed(atk[2]!),
        ...(atk[3] && { reach: Number(atk[3]) }),
        ...(atk[4] && { range: { normal: Number(atk[4]), ...(atk[5] && { long: Number(atk[5]) }) } }),
        damage: parseDamages(hit),
      };
    }
    const save = /_(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:_\s*DC (\d+)/.exec(text);
    if (save) {
      const failure = /_Failure:_\s*(.+?)(?:_Success:|_Failure or Success:|$)/s.exec(text)?.[1] ?? '';
      const area = parseArea(text);
      const damage = parseDamages(failure);
      action.save = {
        ability: abilityByName[save[1]!]!,
        dc: Number(save[2]),
        ...(damage.length > 0 && { damage }),
        halfOnSuccess: /_Success:_\s*Half damage/.test(text),
        ...(area && { area }),
      };
    }
    out.push(action);
  }
  return out;
}

function parseMultiattack(actions: Action[]): void {
  const multi = actions.find((a) => a.name === 'Multiattack');
  if (!multi) return;
  const names = actions.filter((a) => a !== multi).map((a) => a.name);
  const first = multi.text.split(/\.\s|, or /)[0]!;
  const pairs: [string, number][] = [];
  const find = (s: string) => names.find((n) => n.toLowerCase() === s.trim().toLowerCase());
  // "makes two attacks, using Bite, Claw, or Harpoon in any combination" → first listed option.
  const any = /makes (\w+) attacks?, using ([\w' ]+?)(?:,| or | and )/.exec(first);
  // Hydra: "as many Bite attacks as it has heads" (starts with 5 heads).
  const heads = /as many ([\w' ]+?) attacks as it has heads/.exec(first);
  if (any && find(any[2]!)) {
    pairs.push([find(any[2]!)!, NUMBER_WORDS[any[1]!] ?? 1]);
  } else if (heads && find(heads[1]!)) {
    pairs.push([find(heads[1]!)!, 5]);
  } else {
    // "two Rend attacks", or "two Javelin or Morningstar attacks" (first option).
    for (const m of first.matchAll(/(one|two|three|four|five|six) ([\w' ]+?)(?: or [\w' ]+?)? attacks?/g)) {
      const name = find(m[2]!);
      if (name) pairs.push([name, NUMBER_WORDS[m[1]!]!]);
    }
    for (const m of first.matchAll(/uses ([\w' ]+?)(?:\.|,| if| and|$)/g)) {
      const name = names.find((n) => n.toLowerCase() === m[1]!.trim().toLowerCase());
      if (name) pairs.push([name, 1]);
    }
  }
  if (pairs.length > 0) multi.multiattack = pairs;
}

/** Stat-block spell names that differ from the spell list ("Long Strider" vs Longstrider). */
const SPELL_ID_FIXES: Record<string, string> = { long_strider: 'longstrider' };

function parseSpellcasting(actions: Action[]): Monster['spellcasting'] {
  const sc = actions.find((a) => a.name === 'Spellcasting');
  if (!sc) return undefined;
  const ability = /using (\w+) as the spellcasting ability/.exec(sc.text)?.[1];
  if (!ability || !abilityByName[ability]) return undefined;
  const dc = /spell save DC (\d+)/.exec(sc.text)?.[1];
  const bonus = /([+−-]\d+) to hit with spell attacks/.exec(sc.text)?.[1];
  // Italic runs may hold several spells: "_Detect Magic, Detect Thoughts_ (level 5 version)".
  const ids = (list: string) =>
    [...list.matchAll(/_([^_]+)_/g)].flatMap((m) => m[1]!.split(/,\s*/).map((n) => SPELL_ID_FIXES[toId(n)] ?? toId(n)));
  const atWill = /\*\*At Will:\*\*\s*([^*]+)/.exec(sc.text)?.[1];
  const perDay: Record<string, string[]> = {};
  for (const m of sc.text.matchAll(/\*\*(\d+)\/Day(?: Each)?:\*\*\s*([^*]+)/g)) perDay[m[1]!] = ids(m[2]!);
  return {
    ability: abilityByName[ability]!,
    ...(dc && { dc: Number(dc) }),
    ...(bonus && { attackBonus: signed(bonus) }),
    atWill: atWill ? ids(atWill) : [],
    perDay,
  };
}

/** `partLevel`: heading level of Traits/Actions inside a block (4 in monsters-A-Z.md, 3 in animals.md). */
function parseBlock(title: string, body: string, source: Monster['source'], partLevel: number): Monster | null {
  const ac = /\*\*AC\*\*\s*(\d+)/.exec(body);
  if (!ac) return null; // not a stat block
  const typeLine = /^_(.+)_$/m.exec(body)![1]!;
  const [sizeType, alignment] = [typeLine.slice(0, typeLine.lastIndexOf(',')), typeLine.slice(typeLine.lastIndexOf(',') + 1).trim()];
  const sizes = SIZES.filter((s) => new RegExp(`^(?:.*\\b)?${s}\\b`, 'i').test(sizeType.split(/ (?=[A-Z][a-z]+(?: \(|$))/)[0]!)) as Size[];
  const swarm = /Swarm of Tiny (\w+)/.exec(sizeType);
  const typeWord = swarm ? swarm[1]!.replace(/s$/, '') : /(\w+)(?:\s*\(|$)/.exec(sizeType.replace(/^(?:\w+ or )?\w+ /, ''))?.[1];
  const creatureType = typeWord?.toLowerCase() as Monster['creatureType'];
  if (!CREATURE_TYPES.includes(creatureType)) throw new Error(`${title}: bad type in "${typeLine}"`);
  const tags = [...(/\(([^)]+)\)/.exec(sizeType)?.[1]?.split(/,\s*/) ?? []), ...(swarm ? ['swarm'] : [])].map((t) => t.toLowerCase());
  const monsterSizes = swarm ? ([sizeType.split(' ')[0]!.toLowerCase()] as Size[]) : sizes;

  const hp = /\*\*HP\*\*\s*(\d+)\s*\(([^)]+)\)/.exec(body)!;
  const init = /\*\*Initiative\*\*\s*([+−-]\d+)/.exec(body)!;
  // "(XP 18,000, or 20,000 in lair; PB +6)" or "(1,100 XP; PB +3)"
  const crMatch = /\*\*CR\*\*\s*([\d/]+)\s*\((?:XP ([\d,]+)|([\d,]+) XP)[^;]*;\s*PB \+(\d+)\)/.exec(body);
  if (!crMatch) throw new Error(`${title}: bad CR line`);
  const cr = [crMatch[0], crMatch[1]!, (crMatch[2] ?? crMatch[3])!, crMatch[4]!] as const;

  // Ability table: rows of [NAME, score, mod, save] × 3
  const abilities = {} as Monster['abilities'];
  const saves = {} as Record<Ability, number>;
  // Some tables merge cells ("10 +0"), so read each row as a token stream: NAME score mod save.
  for (const row of htmlTables(body)[0]!) {
    const tokens = row.join(' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const ab = tokens[i]!.toLowerCase() as Ability;
      if (!ABILITIES.includes(ab)) continue;
      const next = tokens[i + 1] ?? '';
      if (/^\d+$/.test(next)) {
        abilities[ab] = num(next);
        saves[ab] = signed(tokens[i + 3]!);
      } else if (/^[+−-]\d+$/.test(next)) {
        // Source glitch (Will-o'-Wisp): score cell missing; derive the lowest score with that modifier.
        abilities[ab] = Math.max(1, 10 + 2 * signed(next));
        saves[ab] = signed(tokens[i + 2]!);
      }
    }
  }
  if (Object.keys(abilities).length !== 6) throw new Error(`${title}: could not read all abilities`);

  const skills: Partial<Record<Skill, number>> = {};
  for (const part of (line(body, 'Skills') ?? '').split(/,\s*/)) {
    const m = /^(.+?) ([+−-]\d+)$/.exec(part.trim());
    if (m && skillByName[m[1]!]) skills[skillByName[m[1]!]!] = signed(m[2]!);
  }

  const damageAndConditions = (key: string) => {
    const damage: DamageType[] = [];
    const conditions: Condition[] = [];
    for (const tok of (line(body, key) ?? '').split(/[;,]\s*/)) {
      const t = tok.replace(/\(.*\)/, '').trim().toLowerCase();
      if ((DAMAGE_TYPES as readonly string[]).includes(t)) damage.push(t as DamageType);
      else if ((CONDITIONS as readonly string[]).includes(t)) conditions.push(t as Condition);
    }
    return { damage, conditions };
  };
  const immun = damageAndConditions('Immunities');

  const sensesLine = line(body, 'Senses') ?? '';
  const senses: Monster['senses'] = {};
  for (const m of sensesLine.matchAll(/(Blindsight|Darkvision|Tremorsense|Truesight) (\d+) ft\./g)) {
    senses[m[1]!.toLowerCase() as 'darkvision'] = Number(m[2]);
  }
  const passive = Number(/Passive Perception (\d+)/.exec(sensesLine)?.[1] ?? 10);

  const part = (heading: string) => sections(body, partLevel).find((s) => s.title === heading)?.body;
  const actions = parseActions(part('Actions'));
  parseMultiattack(actions);
  const legendaryBody = part('Legendary Actions');
  const legendaryUses = legendaryBody && /Legendary Action Uses:\s*(\d+)/.exec(legendaryBody)?.[1];
  const spellcasting = parseSpellcasting([...actions, ...parseActions(part('Bonus Actions'))]);

  return {
    id: toId(title),
    name: title,
    size: monsterSizes,
    creatureType,
    tags,
    alignment,
    ac: Number(ac[1]),
    initiative: signed(init[1]!),
    hp: Number(hp[1]),
    hpDice: hp[2]!.replace(/\s+/g, '').replace('−', '-'),
    speed: parseSpeed(line(body, 'Speed') ?? ''),
    abilities,
    saves,
    skills,
    resistances: damageAndConditions('Resistances').damage,
    immunities: immun.damage,
    vulnerabilities: damageAndConditions('Vulnerabilities').damage,
    conditionImmunities: immun.conditions,
    senses,
    passivePerception: passive,
    languages: line(body, 'Languages') ?? 'None',
    cr: parseCR(cr[1]!),
    xp: Number(cr[2]!.replace(/,/g, '')),
    pb: Number(cr[3]),
    gear: (line(body, 'Gear') ?? '').split(/,\s*/).filter(Boolean),
    traits: parseActions(part('Traits')),
    actions,
    bonusActions: parseActions(part('Bonus Actions')),
    reactions: parseActions(part('Reactions')),
    ...(legendaryBody && legendaryUses && { legendary: { uses: Number(legendaryUses), actions: parseActions(legendaryBody) } }),
    ...(spellcasting && { spellcasting }),
    source,
  };
}

const monsters: Monster[] = [];
const seen = new Set<string>();
// monsters-A-Z.md: "### Name" blocks with "#### Actions"; animals.md: "## Name" with "### Actions".
for (const [file, source, level] of [
  ['monsters-A-Z.md', 'monsters', 3],
  ['animals.md', 'animals', 2],
] as const) {
  for (const s of sections(readSource(file), level)) {
    const m = parseBlock(s.title, s.body, source, level + 1);
    if (!m) continue;
    if (seen.has(m.id)) throw new Error(`Duplicate monster ${m.id}`);
    seen.add(m.id);
    monsters.push(m);
  }
}

writeData('monsters.json', applyOverrides(monsters, 'monsters.json'));
console.log(
  `monsters: ${monsters.filter((m) => m.source === 'monsters').length}, animals: ${monsters.filter((m) => m.source === 'animals').length}, legendary: ${monsters.filter((m) => m.legendary).length}, spellcasters: ${monsters.filter((m) => m.spellcasting).length}`,
);
