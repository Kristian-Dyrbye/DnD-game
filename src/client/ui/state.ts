/** Global UI state (Preact signals): which screen is showing and the in-progress character. */
import { signal } from '@preact/signals';
import { newCreatorState, toBuildInput, type CreatorState } from '../../engine/character/creator';
import { buildCharacter } from '../../engine/character/builder';
import { quickBuild } from '../../engine/character/quickBuild';
import type { Character } from '../../engine/core/creature';
import { Rng } from '../../engine/core/rng';
import { db } from '../data';
import { send } from '../net/gameSocket';

export type Screen = 'title' | 'creator' | 'game' | 'combat';

const hash = typeof location !== 'undefined' ? location.hash : '';
// Test shortcuts: `#creator` opens the creator; `#quickbuild-<class>` opens a Quick Build at the review step;
// `#play-<class>` starts a game straight away with that Quick Build (`#play-<class>+map` also opens the map).
const quick = /^#(?:quickbuild|play)-(\w+)(?:\+\w+)?$/.exec(hash)?.[1];

/** `#combat-<class>`: the local combat sandbox (battle map test). */
export const combatDemoClass = /^#combat-(\w+)$/.exec(hash)?.[1];
export const screen = signal<Screen>(combatDemoClass && db.classes.has(combatDemoClass) ? 'combat' : hash === '#creator' || (quick && db.classes.has(quick)) ? 'creator' : 'title');
export const creator = signal<CreatorState>(quick && db.classes.has(quick) ? quickBuild(quick, db, Rng.fromSeed(quick)) : newCreatorState());
/** The finished hero (set when the player begins the adventure). */
export const hero = signal<Character | null>(null);
export const heroMode = signal<'heroic' | 'hardcore'>('heroic');
/** The settings panel can be opened from the title screen and the game menu. */
export const settingsOpen = signal(false);

/** Hardcore: the next hero continues the current world instead of starting a new one. */
export const continueWorldNext = signal(false);

export function beginAdventure(): void {
  const s = creator.value;
  hero.value = buildCharacter(toBuildInput(s), db);
  heroMode.value = s.difficulty ?? 'heroic';
  send({ type: 'new_game', hero: hero.value, mode: heroMode.value, ...(continueWorldNext.value && { continueWorld: true }) });
  continueWorldNext.value = false;
  screen.value = 'game';
}

export function startNewCharacter(): void {
  creator.value = newCreatorState();
  screen.value = 'creator';
}

if (quick && db.classes.has(quick) && hash.startsWith('#play-')) beginAdventure();
