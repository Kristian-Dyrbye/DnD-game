/** Global UI state (Preact signals): which screen is showing and the in-progress character. */
import { signal } from '@preact/signals';
import { newCreatorState, toBuildInput, type CreatorState } from '../../engine/character/creator';
import { buildCharacter } from '../../engine/character/builder';
import { quickBuild } from '../../engine/character/quickBuild';
import type { Character } from '../../engine/core/creature';
import { Rng } from '../../engine/core/rng';
import { db } from '../data';

export type Screen = 'title' | 'creator' | 'game';

const hash = typeof location !== 'undefined' ? location.hash : '';
// Test shortcuts: `#creator` opens the creator; `#quickbuild-<class>` opens a Quick Build at the review step.
const quick = /^#quickbuild-(\w+)$/.exec(hash)?.[1];

export const screen = signal<Screen>(hash === '#creator' || (quick && db.classes.has(quick)) ? 'creator' : 'title');
export const creator = signal<CreatorState>(quick && db.classes.has(quick) ? quickBuild(quick, db, Rng.fromSeed(quick)) : newCreatorState());
/** The finished hero (set when the player begins the adventure). */
export const hero = signal<Character | null>(null);
export const heroMode = signal<'heroic' | 'hardcore'>('heroic');

export function beginAdventure(): void {
  const s = creator.value;
  hero.value = buildCharacter(toBuildInput(s), db);
  heroMode.value = s.difficulty ?? 'heroic';
  screen.value = 'game';
}

export function startNewCharacter(): void {
  creator.value = newCreatorState();
  screen.value = 'creator';
}
