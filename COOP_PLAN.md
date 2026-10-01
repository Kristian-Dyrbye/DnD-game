# Co-op Plan: playing with a friend

> Status: **approved and queued** (owner, 2026-10-01) as Phase 18 (C001–C009 in brain.md), after the arc. Decisions (§8): host decides + guest proposes is the default table setting; duo mode allowed; web co-op uses the public PeerJS broker. Nothing is built yet. This document weighs the ways a second player could join and proposes the one to build first, with the engine changes and a queue the build loop can execute.

## 1. What exists today

- **One hero, one table.** `GameSession` owns one `hero` and a `companions` list. The story addresses "you". Checks roll the hero (group checks roll the hero plus conscious companions). Conversations are the hero's.
- **Companions can already be played, not just watched.** `companion_control` switches a companion between AI and player control; in combat the player then takes that creature's turns. This is the seed of co-op.
- **Every WebSocket sees every event.** The server has one session; any number of browser tabs can connect and all receive the same events and can send commands. There is no notion of *who* sent a command.
- **The server binds to 127.0.0.1 only**, and (since R1) refuses browser pages from foreign origins.
- **The web edition has no server at all**: the host runs inside the page.

So a friend can already play **hot-seat** today: sit at the same PC, take a companion with "Control: player", and play its turns. Zero work. Everything below is about two screens.

## 2. Options

| | A. Hot-seat | B. LAN / tunnel co-op (desktop edition) | C. Browser-to-browser (web edition) | D. Hosted server |
|---|---|---|---|---|
| How | Same screen, companion control | Friend's browser connects to your game server over Wi-Fi (or a tunnel such as Tailscale) | Your page hosts the game; friend's page connects over WebRTC | A server somewhere runs the session |
| AI narration | yes | yes (your Ollama) | no (web edition has no AI) | needs a paid model host |
| Work | none | medium: seats, second hero, origin and join code | medium + signalling: needs a small public broker | large + running cost |
| Fits the spec | yes | yes (local-first, offline on a LAN) | yes for the free Pages edition | no (spec: runs on your own PC) |

**Recommendation: build B first**, with the seat model designed so C can reuse it (a `PeerTransport` is just another transport carrying the same commands and events). Skip D.

## 3. The seat model (shared by B and C)

- A **seat** is a player at the table: `host` (the PC running the game) or `guest-<n>`. Seats are session state, not save state: a save remembers which characters exist, not who played them.
- **Each seat owns characters.** The host owns the hero and any companion left on AI or player control. A guest owns the character they built (a "second hero") and may be lent companions by the host.
- **Who may send what:**
  - `combat_act` / `combat_flee`: only for a creature owned by the sender's seat, and only on that creature's turn.
  - Story actions (`choose`, `say`, `travel`, shops, rest, journal): the **host** decides by default (one narrative, no fights over the button). A guest's `choose`/`say` becomes a **proposal** event the host sees as a highlighted button ("Wren suggests: Study the ledger"). A table setting `turns: host | anyone` lets a trusting pair let either player act.
  - `save`, `load`, `new_game`, settings: host only.
- **Who rolls.** A check action gains an optional `actor` (character id). The host picks who attempts it from a small chooser (default: the hero; the UI pre-selects the best bonus). The runner already resolves checks per creature for group checks, so this is a small change in `resolveCheck`. Conversations stay with the actor who opened them.
- **Narration with two heroes.** Prompt facts name the party ("Mira and Wren reach the gate"); the second-person "you" stays for the host's hero. Template lines already use names. The LLM prompt gets a short "party" card listing both heroes.
- **Language.** One language per table (the host's). A guest sees the host's language; this is the only sane option with one log.
- **Spectator / coach seat.** A seat with no characters: sees everything, can send proposals and a short table chat line. Free once seats exist, and it is what "coaching" a new player over a call needs.

## 4. Option B in detail (desktop edition)

1. **Listen on the LAN, opt-in.** Settings → Table: "Allow a friend to join" turns on listening on `0.0.0.0` with a 6-character **join code**; the Start Game console prints `http://<lan-ip>:3210/?join=CODE`. Without the code a socket is closed (the R1 origin check stays for pages; the code guards the LAN). The `.bat` prints the Windows firewall hint once.
2. **Join flow.** The friend opens the link, builds a character in their own browser (the creator runs client-side already), and sends `join { code, seat?: 'player' | 'spectator' }`, then `add_hero { character }`. The session adds the character to `companions` with `control: 'seat:guest-1'` and emits a `table` event (seats and owners) to everyone.
3. **Encounter scaling** counts the second hero as a party member already (the scaler reads the party), so fights grow with the table.
4. **Reconnect.** A seat survives a reload: the join code plus a seat token in localStorage reclaims it; otherwise the host can "release" a seat and its characters fall back to AI control.
5. **Leaving.** The guest's hero becomes an AI companion (or is parked at the nearest town as "waiting", like a companion who left) so the host can keep playing.
6. **Hardcore mode.** A dead guest hero is final for that character; the guest can build a new one at the next town, like the host's "new hero, same world".

## 5. Option C later (web edition, free)

- A `PeerTransport` over a WebRTC data channel: the host page runs `InPageHost`, the guest page sends commands and receives events through the channel. Same protocol, same seat rules.
- Needs **signalling** to exchange the WebRTC offer: GitHub Pages cannot host that. Choices: a public PeerJS broker (free, third party, no data stored beyond the handshake), or a tiny relay the owner hosts. Decide when B is done.
- Saves stay in the host's browser; the guest's character travels with the host's save.

## 6. Engine and protocol changes (B)

| Area | Change |
|---|---|
| `shared/protocol.ts` | `join`, `add_hero`, `release_seat`, `propose` commands; `table` and `proposal` events; every command gains an optional `seat` token the transport fills in. |
| `engine/session/GameSession.ts` | `Table` (seats, owners, policy) kept in session memory; `handle(cmd, seat)` consults `tablePolicy.allows(cmd, seat, state)` before running; a refused command returns `error`. |
| `engine/party/companions.ts` | `Control` gains `seat:<id>`; `playerControlled(state, seat)`. |
| `engine/combat/encounter.ts` | `controlled` becomes per-seat; `combat_act` validation checks the sender's seat. |
| `engine/adventure/runner.ts` | checks take an `actor`; `availableActions` lists `actors` for check actions; conversations record `actor`. |
| `llm/context/narration.ts` | party card with both heroes; second hero's facts named. |
| `server/app.ts`, `main.ts` | optional `0.0.0.0` listen with join code; per-socket seat; LAN URL printed. |
| `client` | Table panel (seats, join link + QR, control chooser), proposal buttons for the host, actor chooser on check buttons, guest mode (no save/load/settings, own character sheet), spectator view. |
| Saves | `schemaVersion` bump: companions gain `origin: 'companion' | 'hero'` so a second hero is listed as a hero on load; migration. |

Tests: policy unit tests (who may do what), two-socket server test (host + guest take turns in one fight), reconnect test, migration fixture, InPage test with two transports (prepares C).

## 7. Proposed queue (C0xx, one session each)

- **C001 — Table policy in the engine.** Seats, owners, `allows()`; `handle(cmd, seat)`; `Control = 'seat:<id>'`; tests. No UI yet (the host seat is implicit, so nothing changes for solo play).
- **C002 — Second hero.** `add_hero`, `origin: 'hero'`, save migration, companion listing shows heroes first, level-up for heroes owned by a seat; tests.
- **C003 — Combat per seat.** `controlled` per seat, `combat_act` seat check, turn prompt "waiting for Wren's player", AI fallback when a seat is away; two-socket fight test.
- **C004 — Check actor.** `actor` on checks and conversations, actor chooser data in `availableActions`, group checks unchanged; tests.
- **C005 — LAN listen + join code.** Server option, settings, `join`/`release_seat`, seat tokens, reconnect; console URL; firewall note in the .bat; tests.
- **C006 — Client: table panel and guest mode.** Join page (`?join=`), creator for guests, table panel, proposals for the host, actor chooser, spectator view (en + da).
- **C007 — Narration for a party.** Party card in prompts, template lines, playtest with two heroes (mock and real model).
- **C008 — Docs + playtest.** README "Play with a friend", ARCHITECTURE seat model, two-browser manual checklist, screenshots.
- **C009 (optional, later) — PeerTransport for the web edition** once a signalling choice is made.

Rough size: 8 assignments for B, 1–2 more for C.

## 8. Decisions for the owner

1. **Host decides story, guest proposes** (default) versus **anyone acts**: ship both as a table setting, default to host-decides?
2. **Second hero in solo saves**: should a host be able to add a second hero and play both alone (a "duo" mode)? It falls out of C002 for free and makes a party of two without companions possible.
3. **Web edition co-op**: worth a third-party signalling broker, or wait for a self-hosted relay?

(Decided 2026-10-01: both policies as a table setting with host-decides the default; duo mode yes; PeerJS broker for the web edition, C009.)

## 9. Two-browser checklist (C008)

Automated part: `npm run build`, then `npx tsx scripts/coop-screens.ts` (two isolated headless Edge pages + a phone-sized page against a real server on 127.0.0.1:4211 with the mock AI; screenshots in `userdata/shots/coop-*.png`; exits 1 on a failed step or a page error). Run 2026-10-01: every step ok, 0 page errors. It found one bug, fixed in C008: a guest page sent the host-only `thumbnail` command, so both pages showed "Only the host can do that".

| # | Step | How | Result 2026-10-01 |
|---|------|-----|-------------------|
| 1 | Host opens Table: allow-join on, code, link, QR | script (coop-02) | ok |
| 2 | Guest opens `?join=CODE`: join screen (name, player/spectator) | script (coop-03; phone size coop-12) | ok |
| 3 | Guest joins as player → creator in add-hero mode → Quick Build → Review "Add to the party" | script (coop-04, -05) | ok |
| 4 | Both screens list the guest's hero (Hero tag); log "Kim sits down at the table", "<hero> joins the party as a hero" | script (coop-06, -07) | ok |
| 5 | No error banner on either page after joining | script | ok (after the thumbnail fix) |
| 6 | Guest buttons read "Suggest: …"; a click reaches the host as "Kim suggests: …" | script (coop-06, -08) | ok |
| 7 | Host clicks the proposal: the action runs, both pages see the roll + result | script (coop-09, -10) | ok |
| 8 | Table panel lists the guest seat (player, Release seat) | script (coop-11) | ok |
| 9 | Scan the QR code with a real phone camera; the phone opens the join page | owner, by hand | not run (no phone in an unattended session; the encoder is checked by an independent decoder in src/client/qr.test.ts) |
| 10 | A second PC/phone on the same Wi-Fi joins over the LAN address (Start Game.bat with allow-join on; firewall prompt) | owner, by hand | not run (listening on 0.0.0.0 would raise a firewall prompt unattended) |
| 11 | A fight with both heroes: each page acts only on its own hero's turn; "Waiting for Kim's player" | owner, by hand | covered by src/server/coopFight.test.ts, not clicked |
| 12 | Guest reloads the page: same seat again; guest closes the tab mid-fight: AI plays their hero | owner, by hand | covered by tests (coopJoin/combatSeats), not clicked |
| 13 | Spectator joins: suggest only, no level-up/toggles | owner, by hand | covered by coopView.test.ts |

Seen in the run, queued as C008b: the guest's hero view (right column) shows the host's hero, not the guest's own (the Character screen probably too; not checked); refused commands' error events go to every page, not just the sender's.
