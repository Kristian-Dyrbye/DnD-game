/**
 * Imports feats.json from feats.md (origin, general, fighting style and epic boon feats).
 *   npx tsx scripts/srd/import-feats.ts
 */
import { toId } from '../../src/engine/data/common';
import type { Feat } from '../../src/engine/data/schemas';
import { ABILITIES, ABILITY_NAMES, type Ability } from '../../src/engine/rules/basics';
import { applyOverrides, cleanText, readSource, sections, writeData } from './lib';

const md = readSource('feats.md');
const abilityByName = Object.fromEntries(ABILITIES.map((a) => [ABILITY_NAMES[a], a])) as Record<string, Ability>;

const CATEGORY: Record<string, Feat['category']> = {
  'Origin Feat': 'origin',
  'General Feat': 'general',
  'Fighting Style Feat': 'fighting_style',
  'Epic Boon Feat': 'epic_boon',
};

const feats: Feat[] = sections(md, 4).map((s) => {
  const header = /^_([^_(]+?)\s*(?:\(Prerequisite:\s*([^)]+)\))?_/.exec(s.body);
  if (!header) throw new Error(`${s.title}: no category line`);
  const category = CATEGORY[header[1]!.trim()];
  if (!category) throw new Error(`${s.title}: unknown category ${header[1]}`);
  const text = cleanText(s.body.slice(header[0].length));

  let prerequisite: Feat['prerequisite'];
  if (header[2]) {
    const pre = header[2];
    const level = /Level (\d+)\+/.exec(pre)?.[1];
    const abilityPart = /((?:\w+ or )?\w+) (\d+)\+/.exec(pre.replace(/Level \d+\+,?\s*/, ''));
    prerequisite = {
      text: pre,
      ...(level && { level: Number(level) }),
      ...(abilityPart && {
        abilities: abilityPart[1]!.split(' or ').map((a) => ({ ability: abilityByName[a]!, min: Number(abilityPart[2]) })),
        anyAbility: abilityPart[1]!.includes(' or '),
      }),
      ...(/([A-Z][\w ]+?) Feature/.test(pre) && { feature: toId(/([A-Z][\w ]+?) Feature/.exec(pre)![1]!) }),
    };
  }

  let abilityIncrease: Feat['abilityIncrease'];
  const asi = /_Ability Score Increase\._\s*Increase (?:your )?(.+?) score(?:s)? (?:of your choice )?by (\d+), to a maximum of (\d+)/.exec(s.body);
  if (asi) {
    const which = asi[1]!;
    const abilities = /one ability/.test(which) ? [...ABILITIES] : which.split(/,\s*(?:or\s+)?|\s+or\s+/).map((a) => abilityByName[a.trim()]!);
    abilityIncrease = { abilities, amount: Number(asi[2]), max: Number(asi[3]) };
  } else if (s.title === 'Ability Score Improvement') {
    abilityIncrease = { abilities: [...ABILITIES], amount: 2, max: 20 };
  }

  return {
    id: toId(s.title),
    name: s.title,
    category,
    ...(prerequisite && { prerequisite }),
    repeatable: /_Repeatable\._/.test(s.body),
    ...(abilityIncrease && { abilityIncrease }),
    text,
  };
});

writeData('feats.json', applyOverrides(feats, 'feats.json'));
