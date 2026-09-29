import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import { parseCommand, type ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { LoreSchema } from '../world/lore';
import { getMap } from '../world/travel';
import { getProgress, sceneForLocation } from './runner';
import { adventureActionPort } from './sessionActions';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;

async function playing() {
  const session = new GameSession({
    actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, travelEvents: { chancePerDay: 0, events: [] } }),
    systems: createDefaultRegistry({ lore }),
    newSeed: () => 'travel',
  });
  const events: ServerEvent[] = [];
  session.on((e) => events.push(e));
  const hero = buildCharacter(toBuildInput(quickBuild('ranger', db, Rng.fromSeed('r'))), db);
  await session.handle({ type: 'new_game', hero, mode: 'heroic' });
  return { session, events };
}

describe('travel command', () => {
  it('parses with a default pace', () => {
    expect(parseCommand('{"type":"travel","to":"ravensgate"}')).toEqual({ ok: true, command: { type: 'travel', to: 'ravensgate', pace: 'normal' } });
  });

  it('picks the scene to arrive in for a location', () => {
    expect(sceneForLocation(adventure, 'millbrook')).toBe('millbrook_square');
    expect(sceneForLocation(adventure, 'ravensgate')).toBeUndefined();
  });

  it('travels away from the adventure and back, advancing time and the map', async () => {
    const { session, events } = await playing();
    const t0 = session.current.time;
    await session.handle({ type: 'travel', to: 'ravensgate', pace: 'normal' });
    expect(getMap(session.current)!.current).toBe('ravensgate');
    expect(session.current.time).toBeGreaterThan(t0 + 10 * 60);
    expect(getProgress(session.current)!.away).toBe('ravensgate');
    expect(session.current.location.name).toBe('Ravensgate');
    // No adventure actions away from the adventure's places.
    expect(events.filter((e) => e.type === 'suggestions').at(-1)).toMatchObject({ actions: [{ id: 'say:look' }] });
    expect(events.some((e) => e.type === 'log' && e.entry.text.startsWith('You travel to Ravensgate'))).toBe(true);
    // A new day began on the road: the clock system reported it.
    expect(events.some((e) => e.type === 'log' && e.entry.text.startsWith('A new day begins'))).toBe(true);

    await session.handle({ type: 'travel', to: 'millbrook', pace: 'fast' });
    expect(getProgress(session.current)!.away).toBeUndefined();
    expect(session.current.location.sceneId).toBe('millbrook_square');
    expect(events.filter((e) => e.type === 'suggestions').at(-1)).toMatchObject({ actions: expect.arrayContaining([{ id: 'talk_mayor', label: 'Speak with Mayor Hobb' }]) });
  });

  it('refuses unknown or unmapped places with an error event', async () => {
    const { session, events } = await playing();
    await session.handle({ type: 'travel', to: 'the_maw', pace: 'normal', reqId: 't' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'You do not know the way there yet.', reqId: 't' });
    await session.handle({ type: 'travel', to: 'atlantis', pace: 'normal', reqId: 'u' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Unknown place', reqId: 'u' });
  });
});
