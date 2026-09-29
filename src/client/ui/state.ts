/** Global UI state (Preact signals): which screen is showing and the in-progress character. */
import { signal } from '@preact/signals';
import { newCreatorState, type CreatorState } from '../../engine/character/creator';

export type Screen = 'title' | 'creator' | 'game';

// `#creator` in the URL opens the character creator directly (handy for testing).
export const screen = signal<Screen>(typeof location !== 'undefined' && location.hash === '#creator' ? 'creator' : 'title');
export const creator = signal<CreatorState>(newCreatorState());

export function startNewCharacter(): void {
  creator.value = newCreatorState();
  screen.value = 'creator';
}
