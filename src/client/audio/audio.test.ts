import { describe, expect, it } from 'vitest';
import manifest from '../../../assets/audio-manifest.json';
import loreJson from '../../../data/world/lore.json';
import { MOODS, moodFor, moodFromHint } from '../../engine/world/mood';
import { LoreSchema } from '../../engine/world/lore';
import { channelVolume, pickVariant, sfxForEvent } from './audioLogic';

const lore = LoreSchema.parse(loreJson);

describe('moods', () => {
  it('every mood has tracks in the audio manifest', () => {
    for (const m of MOODS) expect((manifest.moods as Record<string, unknown[]>)[m]?.length, m).toBeGreaterThan(0);
  });

  it('scene hints win, then the lore location decides', () => {
    expect(moodFromHint('tense')).toBe('dungeon');
    expect(moodFromHint('town')).toBe('town');
    expect(moodFromHint('whatever')).toBeUndefined();
    expect(moodFor(lore, { locationId: 'millbrook' })).toEqual({ mood: 'town', ambience: null });
    expect(moodFor(lore, { locationId: 'ruins_of_old_vaelthorn' })).toEqual({ mood: 'dungeon', ambience: 'dungeon' });
    expect(moodFor(lore, { locationId: 'blightwood' })).toEqual({ mood: 'wilderness_gloamfen', ambience: 'swamp' });
    expect(moodFor(lore, { locationId: 'isle_of_brass_parrots' })).toEqual({ mood: 'wilderness_brinescatter', ambience: null });
    expect(moodFor(lore, { locationId: 'millbrook', sceneMood: 'tense' }).mood).toBe('dungeon');
  });
});

describe('audio helpers', () => {
  it('combines master and channel volumes', () => {
    const v = { master: 0.5, music: 0.8, sfx: 1 };
    expect(channelVolume(v, 'music')).toBeCloseTo(0.4);
    expect(channelVolume(v, 'ambience')).toBeCloseTo(0.2);
    expect(channelVolume(v, 'sfx')).toBeCloseTo(0.5);
  });

  it('avoids repeating the last variant', () => {
    expect(pickVariant(['a', 'b'], 'a', () => 0)).toBe('b');
    expect(pickVariant(['a'], 'a', () => 0)).toBe('a');
    expect(pickVariant([], undefined)).toBeUndefined();
  });

  it('maps game events to sound effects that exist in the manifest', () => {
    const sfx = manifest.sfx as Record<string, unknown>;
    const cases = [
      sfxForEvent({ type: 'roll', roll: { id: 1, label: 'x', dice: [3], modifier: 0, total: 3, math: '' } }),
      sfxForEvent({ type: 'log', entry: { id: 1, kind: 'system', text: 'Bought 1× rope for 1 gp.' } }),
      sfxForEvent({ type: 'log', entry: { id: 2, kind: 'system', text: 'Job complete: X.' } }),
      sfxForEvent({ type: 'log', entry: { id: 3, kind: 'system', text: 'You travel to Ravensgate.' } }),
      sfxForEvent({ type: 'error', message: 'x' }),
    ];
    expect(cases).toEqual(['dice_roll', 'coin', 'quest_complete', 'footstep_dirt', 'ui_error']);
    for (const c of cases) expect(sfx[c!], c).toBeDefined();
    expect(sfxForEvent({ type: 'log', entry: { id: 4, kind: 'narration', text: 'Bought nothing' } })).toBeUndefined();
    expect(sfx.ui_click).toBeDefined();
  });
});
