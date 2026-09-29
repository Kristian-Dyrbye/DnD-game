/**
 * Monster and NPC models (spec §12): which low-poly model stands in for an SRD stat block.
 * 1. Name patterns → a Quaternius monster/animal or KayKit skeleton, with an optional tint
 *    (hobgoblin = orc tinted red, zombie = skeleton tinted green...).
 * 2. Humanoid NPC stat blocks (guard, cultist, bandit, mage...) → a KayKit adventurer outfit.
 * 3. Otherwise the creature type picks a model (`fallback: true` — listed as gaps in brain.md).
 * Size is applied by the renderer from the creature's footprint. Pure data; the client loads files.
 */
import type { Outfit } from './appearance';

export type MonsterVisual =
  | { kind: 'model'; file: string; tint?: string; fallback?: boolean }
  | { kind: 'character'; outfit: Outfit; tint?: string; fallback?: boolean };

const M = '/assets/models/monsters/';
const A = '/assets/models/animals/';

const model = (file: string, tint?: string): MonsterVisual => ({ kind: 'model', file, ...(tint && { tint }) });
const npc = (outfit: Outfit, tint?: string): MonsterVisual => ({ kind: 'character', outfit, ...(tint && { tint }) });

/** First match wins; patterns are tested against the SRD id. */
const RULES: [RegExp, MonsterVisual][] = [
  [/hobgoblin/, model(`${M}Orc.glb`, '#c0503a')],
  [/bugbear/, model(`${M}Orc.glb`, '#8a6a3a')],
  [/goblin/, model(`${M}Goblin.glb`)],
  [/\borc\b|^orc/, model(`${M}Orc.glb`)],
  [/skeleton|minotaur_skeleton/, model(`${M}Skeleton_Warrior.glb`)],
  [/lich|wight|mummy_lord/, model(`${M}Skeleton_Mage.glb`, '#9fb4ff')],
  [/zombie|ghoul|ghast|mummy/, model(`${M}Skeleton_Minion.glb`, '#8fbf6a')],
  [/will_o_wisp|flameskull/, model(`${M}GhostSkull.glb`)],
  [/ghost|wraith|specter|banshee|shadow|poltergeist/, model(`${M}Ghost.glb`)],
  [/vampire/, npc('rogue_hooded', '#7a1e2a')],
  [/ancient_|adult_/, model(`${M}Dragon.glb`)],
  [/dragon|wyrmling|wyvern|drake|pseudodragon/, model(`${M}Dragon_Small.glb`)],
  [/imp$|quasit/, model(`${M}Imp.glb`)],
  [/demon|devil|balor|marilith|glabrezu|hezrou|nalfeshnee|vrock|erinyes|pit_fiend|barlgura|succubus|incubus|rakshasa|hell_hound|nightmare/, model(`${M}Demon.glb`)],
  [/ooze|pudding|jelly|gelatinous|slime/, model(`${M}Slime.glb`)],
  [/swarm_of_rats|rat$|^rat|giant_rat/, model(`${A}Rat.glb`)],
  [/wolf|worg|dog|hound|jackal|hyena|mastiff/, model(`${A}Wolf.glb`)],
  [/spider|ettercap/, model(`${A}Spider.glb`)],
  [/snake|constrictor|naga/, model(`${A}Snake.glb`)],
  [/bat$|^bat|swarm_of_bats/, model(`${M}Bat.glb`)],
  [/wasp|bee|insect|stirge|swarm_of_insects|centipede|scorpion/, model(`${A}Wasp.glb`)],
  [/frog|toad/, model(`${A}Frog.glb`)],
  [/horse|pony|mule|donkey|camel|pegasus|unicorn/, model(`${A}Horse.glb`)],
  [/elk|deer|stag|antelope/, model(`${A}Stag.glb`)],
  [/boar|bull|ox|aurochs|rhinoceros|mammoth|elephant/, model(`${A}Bull.glb`)],
  [/fox/, model(`${A}Fox.glb`)],
  [/merfolk|sahuagin/, model(`${M}FishFolk.glb`)],
  [/shark|fish|eel|octopus|quipper/, model(`${M}Fish.glb`)],
  [/lizardfolk|bullywug/, model(`${M}FrogFolk.glb`)],
  [/myconid|shrieker|violet_fungus|mushroom/, model(`${M}Mushnub.glb`)],
  [/treant|shambling|blight/, model(`${M}MushroomKing.glb`, '#6a8a4a')],
  [/tyrannosaurus|triceratops|allosaurus|plesiosaurus|pteranodon|ankylosaurus|dinosaur/, model(`${M}Dino.glb`)],
  [/elemental|mephit|air_|djinni|efreeti|invisible_stalker/, model(`${M}Hywirl.glb`)],
  [/yeti|ogre|troll|giant|ettin|cyclops/, model(`${M}Yeti.glb`)],
  [/beholder|aboleth|otyugh|mind_flayer|chuul|cloaker|gibbering|roper/, model(`${M}Aberration.glb`)],
  [/golem|animated|homunculus|shield_guardian/, model(`${M}Skeleton_Warrior.glb`, '#8a9aaa')],
  [/angel|deva|planetar|solar|couatl/, model(`${M}Ghost.glb`, '#ffe08a')],
  [/blob|gray_ooze|black_pudding/, model(`${M}Blob.glb`)],
  // Humanoid NPC stat blocks → adventurer outfits.
  [/guard|knight|veteran|gladiator|soldier|warrior|captain|champion|noble/, npc('knight')],
  [/berserker|tribal|barbarian/, npc('barbarian')],
  [/mage|archmage|priest|acolyte|cult|fanatic|druid|necromancer|warlock|sorcerer|wizard|hag|sage/, npc('mage')],
  [/bandit|spy|scout|assassin|thug|pirate|thief|rogue|commoner|tough|gang/, npc('rogue')],
];

const BY_TYPE: Record<string, MonsterVisual> = {
  undead: model(`${M}Skeleton_Minion.glb`),
  fiend: model(`${M}Demon.glb`),
  dragon: model(`${M}Dragon_Small.glb`),
  beast: model(`${A}Wolf.glb`),
  monstrosity: model(`${M}Dino.glb`),
  aberration: model(`${M}Aberration.glb`),
  ooze: model(`${M}Slime.glb`),
  elemental: model(`${M}Hywirl.glb`),
  fey: model(`${M}Mushnub.glb`),
  plant: model(`${M}MushroomKing.glb`),
  giant: model(`${M}Yeti.glb`),
  construct: model(`${M}Skeleton_Warrior.glb`, '#8a9aaa'),
  celestial: model(`${M}Ghost.glb`, '#ffe08a'),
  humanoid: npc('rogue'),
};

/** The model for a stat block (by SRD id and creature type). */
export function monsterVisual(id: string, creatureType: string): MonsterVisual {
  for (const [re, v] of RULES) if (re.test(id)) return v;
  return { ...(BY_TYPE[creatureType] ?? model(`${M}Blob.glb`)), fallback: true };
}

/** Name of the idle animation clip in a model (Quaternius: "CharacterArmature|Idle", animals: "Rat_Idle"...). */
export function idleClip(names: readonly string[]): string | undefined {
  return (
    names.find((n) => /(^|\|)Idle$/.test(n)) ??
    names.find((n) => /(^|\||_)(Flying_)?Idle$/.test(n)) ??
    names.find((n) => /Idle/.test(n) && !/HitReact|Jump/.test(n)) ??
    names[0]
  );
}
