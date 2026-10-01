/** The in-progress character (creator screens) and starting the adventure with it. Loaded with the creator chunk. */
import { effect, signal } from '@preact/signals';
import { newCreatorState, toBuildInput, type CreatorState } from '../../../engine/character/creator';
import { buildCharacter } from '../../../engine/character/builder';
import { db } from '../../data';
import { send } from '../../net/gameSocket';
import { campaignOf } from '../../../host/campaigns';
import { campaignChoice, continueWorldNext, hash, hero, heroMode, newCharacterRequests, screen, worldFromChoice } from '../state';

export const creator = signal<CreatorState>(newCreatorState());

// "New Game" on the title or fallen-hero screen: start from a blank character.
let seenRequests = newCharacterRequests.peek();
effect(() => {
  const n = newCharacterRequests.value;
  if (n !== seenRequests) {
    seenRequests = n;
    creator.value = newCreatorState();
  }
});

export function beginAdventure(): void {
  const s = creator.value;
  hero.value = buildCharacter(toBuildInput(s), db);
  // `#play-<class>+scars`: a test hero with two scars (A091).
  if (hash.endsWith('+scars')) {
    hero.value = {
      ...hero.value,
      scars: [
        { id: 'scar-1', location: 'left_cheek', cause: 'crit', description: 'Scimitar of the Goblin Boss', origin: 'The Old Mill', at: 0 },
        { id: 'scar-2', location: 'right_arm', cause: 'story', description: 'fire from the burning barn', origin: 'Millbrook', at: 0 },
      ],
    };
  }
  heroMode.value = s.difficulty ?? 'heroic';
  const worldFrom = campaignOf(campaignChoice.value)?.importsWorld ? worldFromChoice.value : null;
  send({
    type: 'new_game',
    hero: hero.value,
    mode: heroMode.value,
    campaign: campaignChoice.value,
    ...(worldFrom ? { worldFrom } : continueWorldNext.value && { continueWorld: true }),
  });
  continueWorldNext.value = false;
  worldFromChoice.value = null;
  screen.value = 'game';
}
