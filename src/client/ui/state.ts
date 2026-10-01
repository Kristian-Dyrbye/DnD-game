/**
 * Global UI state (Preact signals): which screen is showing and the finished hero.
 * Nothing here may import the rules engine or the SRD data: this module is part of the title screen's
 * first load (A128). The in-progress character lives in creator/creatorState.ts (a lazy chunk).
 */
import { signal } from '@preact/signals';
import type { Character } from '../../engine/core/creature';
import { DEFAULT_CAMPAIGN } from '../../host/campaigns';

export type Screen = 'title' | 'creator' | 'game' | 'combat';

export const hash = typeof location !== 'undefined' ? location.hash : '';
// Test shortcuts: `#creator` opens the creator; `#quickbuild-<class>` opens a Quick Build at the review step;
// `#play-<class>` starts a game straight away with that Quick Build (`#play-<class>+map` also opens the map,
// `#play-<class>+scars` gives the hero two test scars).
const quick = /^#(?:quickbuild|play)-(\w+)(?:\+\w+)?$/.exec(hash)?.[1];

/** `#combat-<class>`: the local combat sandbox (battle map test). */
export const combatDemoClass = /^#combat-(\w+)$/.exec(hash)?.[1];
// `#combat-<class>` with an unknown class goes back to the title (checked by DemoCombat); a Quick Build
// shortcut switches screens once the SRD data has loaded (applyQuickShortcut below).
export const screen = signal<Screen>(combatDemoClass ? 'combat' : hash === '#creator' ? 'creator' : 'title');
/** Bumped by "New Game": creatorState.ts starts a fresh character on every bump. */
export const newCharacterRequests = signal(0);
/** The finished hero (set when the player begins the adventure). */
export const hero = signal<Character | null>(null);
export const heroMode = signal<'heroic' | 'hardcore'>('heroic');
/** The settings panel can be opened from the title screen and the game menu. */
export const settingsOpen = signal(false);

/** Hardcore: the next hero continues the current world instead of starting a new one. */
export const continueWorldNext = signal(false);
/** Campaign the next new game starts (first-chapter adventure id; title screen + creator review pick it). */
export const campaignChoice = signal<string>(DEFAULT_CAMPAIGN.adventure);

export function startNewCharacter(): void {
  newCharacterRequests.value++;
  screen.value = 'creator';
}

/** `#quickbuild-<class>` / `#play-<class>`: loads the rules data, then opens the Quick Build (or starts playing it). */
async function applyQuickShortcut(cls: string): Promise<void> {
  const [{ db }, { quickBuild }, { Rng }, { creator, beginAdventure }] = await Promise.all([
    import('../data'),
    import('../../engine/character/quickBuild'),
    import('../../engine/core/rng'),
    import('./creator/creatorState'),
  ]);
  if (!db.classes.has(cls)) return;
  creator.value = quickBuild(cls, db, Rng.fromSeed(cls));
  if (hash.startsWith('#play-')) beginAdventure();
  else screen.value = 'creator';
}

if (quick) void applyQuickShortcut(quick);
