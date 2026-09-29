/**
 * Equipment on the 3D model (spec §12): which low-poly part shows an SRD item, and in which hand.
 * Explicit ids first (the KayKit set has a sword, axe, dagger, hammer, spear, bow, crossbows, staff,
 * wand, spellbook and four shields), then fallbacks from the weapon's data: ranged → bow or
 * crossbow, two-handed → the two-handed version, damage type → blade / axe / hammer / spear, and
 * finally a one-handed sword. Pure data, so the engine and tests can use it; the client loads the
 * files (client/three/equipmentModels.ts).
 */
import type { Character } from '../core/creature';
import type { SrdDatabase } from '../data/srd';

export const VISUAL_PARTS = [
  'sword_1h',
  'sword_2h',
  'axe_1h',
  'axe_2h',
  'dagger',
  'hammer',
  'spear',
  'bow',
  'crossbow_1h',
  'crossbow_2h',
  'staff',
  'wand',
  'spellbook',
  'shield_round',
  'shield_square',
  'shield_badge',
  'shield_spikes',
] as const;
export type VisualPart = (typeof VISUAL_PARTS)[number];

/** What the model holds: right hand, left hand (two-handed items only in the right). */
export interface EquipmentLook {
  right?: VisualPart;
  left?: VisualPart;
}

const BY_ID: Record<string, VisualPart> = {
  dagger: 'dagger',
  sickle: 'dagger',
  shortsword: 'sword_1h',
  scimitar: 'sword_1h',
  rapier: 'sword_1h',
  longsword: 'sword_1h',
  greatsword: 'sword_2h',
  handaxe: 'axe_1h',
  battleaxe: 'axe_1h',
  greataxe: 'axe_2h',
  halberd: 'axe_2h',
  glaive: 'axe_2h',
  club: 'hammer',
  light_hammer: 'hammer',
  mace: 'hammer',
  warhammer: 'hammer',
  maul: 'hammer',
  greatclub: 'hammer',
  flail: 'hammer',
  morningstar: 'hammer',
  war_pick: 'hammer',
  spear: 'spear',
  javelin: 'spear',
  pike: 'spear',
  lance: 'spear',
  trident: 'spear',
  quarterstaff: 'staff',
  shortbow: 'bow',
  longbow: 'bow',
  hand_crossbow: 'crossbow_1h',
  light_crossbow: 'crossbow_2h',
  heavy_crossbow: 'crossbow_2h',
  arcane_focus_staff: 'staff',
  druidic_focus_wooden_staff: 'staff',
  arcane_focus_wand: 'wand',
  arcane_focus_rod: 'wand',
  druidic_focus_yew_wand: 'wand',
  spellbook: 'spellbook',
  shield: 'shield_round',
};

/** Visual part for an item id, or undefined for things that aren't shown in the hands. */
export function visualFor(itemId: string, db: SrdDatabase): VisualPart | undefined {
  const direct = BY_ID[itemId];
  if (direct) return direct;
  // Magic items: use the base item when there is one (+1 longsword → longsword).
  const magic = db.magicItems.get(itemId);
  if (magic?.baseItem && magic.baseItem !== itemId) return visualFor(magic.baseItem, db);
  if (db.armor.get(itemId)?.category === 'shield') return 'shield_round';
  const w = db.weapons.get(itemId);
  if (!w) return undefined;
  const props = w.properties;
  const two = props.includes('two_handed');
  if (props.includes('ammunition')) return props.includes('loading') ? (two ? 'crossbow_2h' : 'crossbow_1h') : 'bow';
  if (w.damage?.type === 'bludgeoning') return 'hammer';
  if (w.damage?.type === 'piercing' && (props.includes('reach') || props.includes('thrown'))) return 'spear';
  if (props.includes('light') && w.damage?.type === 'piercing') return 'dagger';
  if (w.damage?.type === 'slashing' && /axe/.test(itemId)) return two ? 'axe_2h' : 'axe_1h';
  return two ? 'sword_2h' : 'sword_1h';
}

const TWO_HANDED: ReadonlySet<VisualPart> = new Set(['sword_2h', 'axe_2h', 'bow', 'crossbow_2h', 'staff', 'spear']);

/** The look of a character's equipped main hand, off hand and shield. */
export function equipmentLook(c: Pick<Character, 'inventory'>, db: SrdDatabase): EquipmentLook {
  const eq = (slot: string) => c.inventory.find((i) => i.equipped === slot);
  const main = eq('main_hand');
  const off = eq('off_hand') ?? eq('shield');
  const right = main ? visualFor(main.itemId, db) : undefined;
  let left = off ? visualFor(off.itemId, db) : undefined;
  // A two-handed look fills both hands (a staff or spear can still go with a shield).
  if (right && TWO_HANDED.has(right) && left && !left.startsWith('shield')) left = undefined;
  // A spellcaster with nothing in the off hand carries the spellbook if they have one.
  if (!left && (!right || !TWO_HANDED.has(right)) && c.inventory.some((i) => i.itemId === 'spellbook')) left = 'spellbook';
  return { ...(right && { right }), ...(left && { left }) };
}

/** Stable key for caching/rebuilding models when gear changes. */
export const lookKey = (l: EquipmentLook | undefined): string => `${l?.right ?? '-'}|${l?.left ?? '-'}`;
