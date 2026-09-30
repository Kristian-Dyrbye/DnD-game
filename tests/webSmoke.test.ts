/**
 * A128 — web edition smoke test: the starter arc played end to end through the in-page host the
 * browser uses (InPage transport, IndexedDB saves via fake-indexeddb, no LLM or TTS at all), with
 * real seeded dice and grid fights. Same story + combat policy as the server smoke test (A106). The
 * run must chain into chapter 1 without a single error event, and a save made there must load in a
 * fresh page (new host, same browser database).
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { combatStep } from './helpers/combatPolicy';
import { nextStarterChoice } from './helpers/starterPolicy';
import { InPageTransport } from '../src/client/net/transport';
import { createInPageHost } from '../src/host/inPage';
import { openBrowserSaves } from '../src/host/indexedDbSaves';
import type { GameHost } from '../src/host/gameHost';
import type { ClientCommand, ServerEvent } from '../src/shared/protocol';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { activeFight } from '../src/engine/adventure/fights';
import { getProgress } from '../src/engine/adventure/runner';

type Of<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>;
const db = loadSrd();

/** A browser tab: the in-page transport over a host with IndexedDB saves. */
async function openPage(idb: IDBFactory) {
  const { saves, persistent } = await openBrowserSaves(idb);
  let host: GameHost | undefined;
  const transport = new InPageTransport(async () => (host = createInPageHost({ saves, sessionPorts: { newSeed: () => 'web-smoke-1' } })));
  const events: ServerEvent[] = [];
  transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
  const send = async (cmd: ClientCommand) => {
    transport.send(cmd);
    while (!host) await new Promise((r) => setTimeout(r, 5));
    await transport.idle();
  };
  const of = <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t);
  return { saves, persistent, events, send, of, host: () => host! };
}

describe('web edition smoke test (A128)', () => {
  it('plays the starter arc into chapter 1 in the page, saves to IndexedDB and loads in a new page', async () => {
    const idb = new IDBFactory();
    const page = await openPage(idb);
    expect(page.persistent).toBe(true);
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('smoke'))), db);
    await page.send({ type: 'new_game', hero, mode: 'heroic' });
    const session = page.host().session;

    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.adventureId !== 'millbrook_disappearances') break;
      if (activeFight(session.current)) {
        fights++;
        await page.send(combatStep(session, db));
        continue;
      }
      // The buttons the player sees are the last `suggestions` event (JSON copies, like the UI gets).
      const offered = (page.of('suggestions').at(-1)?.actions ?? []).map((a) => a.id);
      const choice = nextStarterChoice(p.sceneId, session.current.flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      await page.send({ type: 'choose', actionId: choice });
    }

    const errors = page.of('error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0);
    expect(page.of('combat').length).toBeGreaterThan(0); // the battle map got the fights
    expect(session.current.flags['arc.main.tooth_want_holder']).toBe('player');
    expect(session.current.companions.map((c) => c.id)).toEqual(['corwin']);
    expect(getProgress(session.current)!.adventureId).toBe('ch1_whispering_fen');
    // Without an AI every narration is the template and every button is authored data.
    expect(page.of('log').some((e) => e.entry.kind === 'narration')).toBe(true);
    expect(page.of('suggestions').at(-1)!.actions.every((a) => !a.say)).toBe(true);

    // Save in chapter 1, then reload the "page": a new host reads the same IndexedDB.
    await page.send({ type: 'save', slot: 'web-smoke', name: 'Fen' });
    expect(page.of('saved').at(-1)!.meta.slotId).toBe('web-smoke');
    await page.saves.flush();
    const time = session.current.time;

    const reloaded = await openPage(idb);
    const slots = reloaded.saves.list().map((e) => (e.ok ? e.meta.slotId : e.slotId));
    expect(slots).toContain('web-smoke');
    expect(slots.some((s) => s.startsWith('auto-'))).toBe(true);
    await reloaded.send({ type: 'load', slot: 'web-smoke' });
    expect(reloaded.of('error')).toEqual([]);
    const snap = reloaded.of('snapshot').at(-1)!.state;
    expect(snap.time).toBe(time);
    expect(getProgress(snap)!.adventureId).toBe('ch1_whispering_fen');
    expect(reloaded.of('suggestions').at(-1)!.actions.length).toBeGreaterThan(0);
  }, 120_000);
});
