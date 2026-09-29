/** Original short class blurbs and roles for the creator (game text, not SRD). */
export interface ClassInfo {
  blurb: string;
  role: string;
  /** 1 = straightforward, 3 = many options to manage. */
  complexity: 1 | 2 | 3;
}

export const CLASS_INFO: Record<string, ClassInfo> = {
  barbarian: { blurb: 'A fierce warrior who channels a primal Rage to shrug off blows and hit harder.', role: 'Tough front-line fighter', complexity: 1 },
  bard: { blurb: 'A charismatic performer whose music and words weave magic, inspire allies and unsettle foes.', role: 'Support spellcaster', complexity: 3 },
  cleric: { blurb: 'A divine champion who heals, protects and smites with the power of faith.', role: 'Healer and protector', complexity: 2 },
  druid: { blurb: "A keeper of the wild who wields nature's magic and can take the shape of beasts.", role: 'Nature spellcaster', complexity: 3 },
  fighter: { blurb: 'A master of weapons and armor, versatile and dependable in any battle.', role: 'Weapon expert', complexity: 1 },
  monk: { blurb: 'A disciplined martial artist who strikes fast with fists and inner focus.', role: 'Mobile striker', complexity: 2 },
  paladin: { blurb: 'A holy knight bound by an oath, mixing heavy armor, a healing touch and radiant smites.', role: 'Holy warrior', complexity: 2 },
  ranger: { blurb: 'A wilderness hunter and tracker, deadly with bow and blade, with a touch of nature magic.', role: 'Skirmisher and scout', complexity: 2 },
  rogue: { blurb: 'A cunning expert in stealth and skills who lands precise, devastating strikes.', role: 'Stealthy skill expert', complexity: 1 },
  sorcerer: { blurb: 'Magic runs in their blood; they bend and reshape spells with raw innate power.', role: 'Innate spellcaster', complexity: 3 },
  warlock: { blurb: 'A seeker of forbidden power bound by a pact with an otherworldly patron.', role: 'Pact spellcaster', complexity: 3 },
  wizard: { blurb: 'A scholar of the arcane who masters the widest range of spells through study.', role: 'Studied spellcaster', complexity: 3 },
};
