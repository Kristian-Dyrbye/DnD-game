/** Global UI state (Preact signals): which screen is showing and the in-progress character. */
import { signal } from '@preact/signals';
import { newCreatorState, type CreatorState } from '../../engine/character/creator';

export type Screen = 'title' | 'creator' | 'game';

export const screen = signal<Screen>('title');
export const creator = signal<CreatorState>(newCreatorState());

export function startNewCharacter(): void {
  creator.value = newCreatorState();
  screen.value = 'creator';
}
