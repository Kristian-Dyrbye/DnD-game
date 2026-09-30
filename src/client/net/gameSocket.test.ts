import { describe, expect, it } from 'vitest';
import { applyEvent, dialogue, rollHistory, storyLog, streaming, suggestions } from './gameSocket';

describe('client event reducer', () => {
  it('builds up the story log, streaming text, rolls and suggestions', () => {
    applyEvent({ type: 'narration', phase: 'start', entryId: 7, text: '' });
    applyEvent({ type: 'narration', phase: 'chunk', entryId: 7, text: 'The rain ' });
    applyEvent({ type: 'narration', phase: 'chunk', entryId: 7, text: 'falls.' });
    expect(streaming.value).toEqual({ entryId: 7, text: 'The rain falls.' });
    applyEvent({ type: 'log', entry: { id: 7, kind: 'narration', text: 'The rain falls.' } });
    expect(streaming.value).toBeNull();
    expect(storyLog.value.at(-1)?.text).toBe('The rain falls.');
    applyEvent({ type: 'roll', roll: { id: 8, label: 'Perception', dice: [12], modifier: 3, total: 15, math: 'd20: 12 + 3 (Perception) = 15' } });
    expect(rollHistory.value).toHaveLength(1);
    applyEvent({ type: 'suggestions', actions: [{ id: 'look', label: 'Look around' }] });
    expect(suggestions.value[0]?.label).toBe('Look around');
  });

  it('tracks the open conversation', () => {
    const view = { npcId: 'mayor_hobb', npc: 'Mayor Hobb', speaker: 'Mayor Hobb', text: 'Friend!' };
    applyEvent({ type: 'dialogue', view });
    expect(dialogue.value).toEqual(view);
    applyEvent({ type: 'dialogue', view: null });
    expect(dialogue.value).toBeNull();
  });
});
