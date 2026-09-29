import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { activeFight } from '../adventure/fights';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { isControlled } from '../combat/encounter';
import { currentId } from '../combat/turns';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { LoreSchema } from '../world/lore';
import { CompanionRosterSchema, playerControlled } from './companions';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);

describe('companion control toggle', () => {
  it('player-controlled companions get their own turns on the battle map', async () => {
    const raw = structuredClone(demo) as unknown as { chapters: { scenes: { actions: Record<string, unknown>[] }[] }[] };
    raw.chapters[0]!.scenes[0]!.actions.push({ id: 'hire', label: 'Hire', once: true, outcome: { recruit: 'nettle' } });
    const adventure = validateAdventure(raw, db).adventure!;
    const session = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, companions: roster }), newSeed: () => 'ctl' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('h'))), db), mode: 'heroic' });
    await session.handle({ type: 'choose', actionId: 'hire' });
    await session.handle({ type: 'companion_control', companionId: 'nettle', control: 'player' });
    expect(playerControlled(session.current)).toEqual(['nettle']);
    await session.handle({ type: 'companion_control', companionId: 'rook', control: 'player', reqId: 'r' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'That companion is not in your party.', reqId: 'r' });

    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
    await session.handle({ type: 'choose', actionId: 'exit.unlock' });
    const enc = activeFight(session.current)!.enc;
    expect(enc.controlled).toEqual(['hero', 'nettle']);
    expect(isControlled(enc, 'nettle')).toBe(true);
    // Play end_turn until Nettle is up (or the fight ends): the controller must stop on her turn.
    let sawNettle = false;
    for (let i = 0; i < 10 && activeFight(session.current); i++) {
      const e = activeFight(session.current)!.enc;
      if (currentId(e.state.turns) === 'nettle') {
        sawNettle = true;
        break;
      }
      await session.handle({ type: 'combat_act', action: { kind: 'end_turn' } });
    }
    if (activeFight(session.current)) expect(sawNettle).toBe(true);
    await session.handle({ type: 'companion_control', companionId: 'nettle', control: 'ai', reqId: 'c' });
    if (activeFight(session.current)) expect(events.at(-1)).toEqual({ type: 'error', message: 'Change control outside of combat.', reqId: 'c' });
  });
});
