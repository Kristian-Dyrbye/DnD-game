/**
 * Permanent scars (spec §12): created by dramatic moments — a critical hit taken, dropping to
 * 0 HP, or an authored story event — placed on a plausible body location for the kind of wound and
 * logged with their origin ("Left cheek: Scimitar of the Goblin Boss, The Old Mill"). Scars never
 * go away; the narrator is told about them (llm/context) and the model shows a mark (client).
 *
 * Combat records `ScarMark`s as damage lands (CombatState.scarMarks); when the fight ends,
 * `rollScars` gives each marked party member at most one scar: 35% after a critical hit taken,
 * 60% after dropping to 0 HP (seeded rng).
 */
import type { Character, Scar, ScarLocation } from '../core/creature';
import type { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

export const SCAR_LABEL: Record<ScarLocation, string> = {
  left_cheek: 'Left cheek',
  right_cheek: 'Right cheek',
  brow: 'Brow',
  jaw: 'Jaw',
  neck: 'Neck',
  chest: 'Chest',
  back: 'Back',
  left_shoulder: 'Left shoulder',
  right_shoulder: 'Right shoulder',
  left_arm: 'Left forearm',
  right_arm: 'Right forearm',
  left_hand: 'Left hand',
  right_hand: 'Right hand',
  left_leg: 'Left thigh',
  right_leg: 'Right thigh',
};

/** Where wounds of each damage type plausibly leave a mark. */
const PLACES: Record<string, ScarLocation[]> = {
  slashing: ['left_cheek', 'right_cheek', 'brow', 'chest', 'left_arm', 'right_arm', 'back'],
  piercing: ['left_shoulder', 'right_shoulder', 'chest', 'left_leg', 'right_leg', 'left_hand', 'neck'],
  bludgeoning: ['brow', 'jaw', 'left_hand', 'right_hand', 'chest'],
  fire: ['left_hand', 'right_hand', 'left_arm', 'right_arm', 'neck', 'left_cheek'],
  acid: ['left_hand', 'right_hand', 'neck', 'right_cheek'],
  cold: ['left_hand', 'right_hand', 'jaw'],
  lightning: ['right_arm', 'left_arm', 'chest', 'back'],
  necrotic: ['chest', 'left_hand', 'neck'],
};
const ANY: ScarLocation[] = Object.keys(SCAR_LABEL) as ScarLocation[];

export interface ScarMark {
  targetId: string;
  cause: 'crit' | 'down';
  sourceName: string;
  weapon?: string;
  damageType?: string;
}

export const SCAR_CHANCE = { crit: 0.35, down: 0.6 } as const;

/** A free plausible location (falls back to any free one, then any). */
export function scarLocation(damageType: string | undefined, rng: Rng, taken: readonly ScarLocation[] = []): ScarLocation {
  const pref = (PLACES[damageType ?? ''] ?? ANY).filter((l) => !taken.includes(l));
  const pool = pref.length ? pref : ANY.filter((l) => !taken.includes(l));
  return rng.pick(pool.length ? pool : ANY);
}

/** "Scimitar of the Goblin Boss" / "fire from the Young Red Dragon" (stored in the save as written). */
export function scarDescription(mark: Pick<ScarMark, 'sourceName' | 'weapon' | 'damageType'>, { m }: Messages = ENGLISH_MESSAGES): string {
  const burn = ['fire', 'acid', 'cold', 'lightning', 'necrotic', 'radiant', 'thunder', 'poison', 'psychic', 'force'];
  const source = mark.sourceName;
  if (mark.damageType && burn.includes(mark.damageType) && !mark.weapon) return m('scar.element', { type: mark.damageType, source });
  return mark.weapon ? m('scar.weapon', { weapon: mark.weapon, source }) : m('scar.blow', { source });
}

/** Label for a scar: "Left cheek: Claw of the Owlbear (The Old Mill)". */
export function scarText(s: Scar, { m }: Messages = ENGLISH_MESSAGES): string {
  const place = m(`scar.place.${s.location}`);
  return s.origin ? m('scar.textOrigin', { place, description: s.description, origin: s.origin }) : m('scar.text', { place, description: s.description });
}

function add(c: Character, scar: Omit<Scar, 'id'>): Character {
  const id = `scar-${c.scars.length + 1}`;
  return { ...c, scars: [...c.scars, { id, ...scar }] };
}

/** Give a scar (story events). */
export function giveScar(c: Character, o: { description: string; location?: ScarLocation; origin?: string; at: number; damageType?: string }, rng: Rng): Character {
  const location = o.location ?? scarLocation(o.damageType, rng, c.scars.map((s) => s.location));
  return add(c, { location, cause: 'story', description: o.description, ...(o.origin && { origin: o.origin }), at: o.at });
}

/**
 * After a fight: each party member with marks gets at most one scar (the most dramatic mark: a
 * drop to 0 HP beats a crit). Returns the updated characters and one log line per new scar.
 */
export function rollScars(party: Character[], marks: readonly ScarMark[], rng: Rng, origin: string, at: number, msgs: Messages = ENGLISH_MESSAGES): { party: Character[]; lines: string[] } {
  const lines: string[] = [];
  const out = party.map((c) => {
    const mine = marks.filter((m) => m.targetId === c.id);
    if (!mine.length) return c;
    const best = mine.find((m) => m.cause === 'down') ?? mine[0]!;
    if (rng.next() >= SCAR_CHANCE[best.cause]) return c;
    const location = scarLocation(best.damageType, rng, c.scars.map((s) => s.location));
    const next = add(c, { location, cause: best.cause, description: scarDescription(best, msgs), origin, at });
    lines.push(msgs.m('story.scar', { name: c.name, scar: scarText(next.scars.at(-1)!, msgs) }));
    return next;
  });
  return { party: out, lines };
}

/** Narration hint: the newest few scars ("scar on left cheek from a goblin scimitar"). */
export function scarSummary(c: Pick<Character, 'scars'>, max = 2): string | undefined {
  if (!c.scars.length) return undefined;
  return `scars: ${c.scars
    .slice(-max)
    .map((s) => `${SCAR_LABEL[s.location].toLowerCase()} (${s.description})`)
    .join(', ')}`;
}
