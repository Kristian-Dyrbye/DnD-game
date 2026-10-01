# Architecture

Solo D&D 5e (SRD 5.2) browser game with a local AI Dungeon Master. Runs fully offline on Windows 10/11 with 8 GB RAM.

**Core rule: code owns the rules, the LLM only narrates.** Every mechanic is resolved by deterministic TypeScript in `src/engine`. The LLM gets resolved facts and turns them into prose, dialogue, intent JSON and suggested actions.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict), ES modules | One language for the engine, server and client; the engine is shared. |
| Frontend | Vite + **Preact** + `@preact/signals` | React-like API in about 4 KB; low memory for an 8 GB machine. |
| 3D | three.js (GLTF models, CC0 kits) | Required by the spec; widely used. |
| Backend | Node.js + **Fastify** + `@fastify/websocket` | Small and fast, with good TypeScript support. `inject()` makes route tests easy. |
| Validation | **zod** | One schema library for SRD data, saves, LLM JSON output and the API. |
| Tests | **Vitest** | Native TypeScript and ESM, and it shares the Vite config. |
| Dev runner | `tsx` for the server; `vite` dev server that proxies to it | No build step during development. |
| LLM | **Ollama**, default model `llama3.2:3b` (Q4, about 2 GB); fallback `qwen3:4b-instruct` (`think:false`) | Won the A010 benchmark: 5/5 valid JSON, ~7 tok/s on a laptop CPU, 2.4 GB resident — inside the 3 GB budget. Configurable in settings. |
| TTS | **Piper** (Windows binary + ONNX voices, about 60 MB each), spawned by the server | Offline, light and fast on CPU. |
| Storage | Versioned JSON save files in `saves/`, with a migration chain | Easy to read and diff, with no native dependencies. |

## 2. Folder Structure

```
/
├─ Start Game.bat / Setup.bat     Windows launchers (CRLF)
├─ scripts/                       Node helper scripts (dependency checks, asset/voice download, SRD fetch/import, LLM benchmark)
├─ data/
│  ├─ srd/                        SRD 5.2 rules as JSON (classes, spells, monsters, items, feats, ...) + zod-validated
│  ├─ world/lore.json             Continent, regions (tone profiles), factions, gods, locations
│  ├─ adventures/<arcId>/         Authored adventures (the ADVENTURE_FORMAT.md schema): starter/ + arc1/ (Seven Teeth), arc2/ (Hollow Crown), demo/; bibles DESIGN.md + DESIGN_ARC2.md, one flag registry flags.json
│  ├─ i18n/<lang>/<key>.json      Content translation overlays (text by id path + hash of the English; ADVENTURE_FORMAT.md "Translations", npm run i18n:check)
│  └─ tables/                     Random tables (side quests, travel events, weather, loot, defeat outcomes)
├─ assets/                        Committed manifests + small CC0 assets; large packs downloaded by Setup.bat
├─ src/
│  ├─ engine/                     PURE TypeScript: no DOM, no Node APIs, no I/O. Deterministic with a seeded RNG.
│  │  ├─ core/                    rng, dice, creature schemas, event bus, shared types
│  │  ├─ data/                    zod schemas for data/srd, SrdDatabase, bundled loader (loadSrd)
│  │  ├─ rules/                   abilities, checks, attacks, damage, conditions, effects, spells, rest, leveling, feats, multiclass
│  │  ├─ character/               character builder, derived stats, creator validation, quick build
│  │  ├─ combat/                  grid + edges + tokens (grid.ts), LOS/cover (los.ts), movement + OAs (movement.ts), initiative, turns + action economy (turns.ts),
│  │  │                           attack pipeline + masteries + stat-block riders (attack.ts), saves/checks in combat + grapple riders (saves.ts),
│  │  │                           actions: Dash…Ready/Grapple/Shove/drag (actions.ts), Study/Influence/Utilize/Magic items (otherActions.ts),
│  │  │                           monster save actions (monsterActions.ts), AoE templates + resolution (aoe.ts, aoeResolve.ts),
│  │  │                           persistent spell zones (zones.ts), spells/features on the map (castAction.ts), enemy AI (ai.ts, aiScore.ts),
│  │  │                           companion AI (companionAi.ts), the fight controller used by UI and server (encounter.ts)
│  │  ├─ world/                   clock, weather, travel, map discovery, factions, shops, flags (+ per-adventure typed docs), dungeon maps + fog of war (dungeon.ts)
│  │  ├─ adventure/               adventure schema, scene runner (outcomes incl. rest/damage/cost/scar/tip), fights ↔ story (fights.ts), defeat outcomes,
│  │  │                           combat narration queue, suggestions, summary, encounter scaling, side-quest generator + solver/validator, the session port (sessionActions.ts),
│  │  │                           NPC conversation trees (conversation.ts: talk./dlg. actions, dialogue view; the runner applies option checks/outcomes)
│  │  ├─ party/                   companions, loyalty, control mode
│  │  ├─ appearance/              appearance, equipment → model parts, monster → model, wound levels (data only; rendering lives in the client)
│  │  ├─ character/ (also)        scars.ts (permanent scars), armorWear.ts (wear + repair)
│  │  ├─ session/                 GameSession: owns GameState, applies commands, emits events; table.ts (co-op seats + policy: handle(cmd, seat) asks allows() first; solo = host seat only; owners derived from companion control `seat:<id>`; player-made second heroes (`add_hero`, C002) sit in `companions` with `state.origins[id] = "hero"`: they level by hand and share story XP; fights carry `enc.seats` (creature → seat, from fightSeats), a `waiting` event names the guest the fight waits for, and an away/unseated guest's creatures are played by the companion AI — GameSession.setSeatAway / ActionPort.seatsChanged, C003)
│  │  └─ systems/                 System registry (plugin hooks) — the extension point for §16
│  ├─ llm/                        Provider interface, Ollama client, mock provider, prompt builders, JSON schemas, fallbacks; prompts keep English instructions and ask for the reply in the session language (llm/prompts/language.ts), and settings.llm.modelByLanguage picks a model per game language (Danish: qwen3:4b-instruct)
│  ├─ tts/                        TTS provider interface, Piper adapter, mock
│  ├─ host/                       Game host (no Node imports): GameSession + adventure port + systems + tables (gameHost.ts), campaign table (campaigns.ts), shared adventure loader (content.ts),
│  │                              bundled adventures (bundled.ts), in-memory saves + in-browser host for the web edition (memorySaves.ts, inPage.ts),
│  │                              IndexedDB save backend with a memory-only fallback (indexedDbSaves.ts)
│  │                              content in the session language: overlays merged once per language, one adventure port per language (translations.ts; overlay logic in shared/contentI18n.ts)
│  ├─ server/                     Fastify app: static client, REST (saves, settings, status), WebSocket game channel; runs the host with the AI ports
│  ├─ shared/                     Client⇄server protocol types (commands, events), settings schema, i18n.ts + i18n/<lang>.ts (UI text catalogs; client language signal in client/ui/i18n.ts), i18nCore.ts (languages, placeholders, plurals; shared with the engine). Engine-written lines: src/engine/i18n.ts + engine/i18n/<lang>.ts (Messages; GameSession.language, set by the `set_language` command the client sends on connect and on a switch; RunContext.msgs)
│  └─ client/                     Preact UI, three.js scenes, 2D grid canvas, audio manager
│     ├─ ui/                      screens: title, creator, main game, combat, map, journal, settings, save browser
│     ├─ three/                   model loader, character/monster models, equipment attach, wound/wear overlays, scar marks, 3D battle map, preview
│     └─ audio/                   music crossfade, SFX, TTS playback
├─ tests/                         Cross-module tests (smoke playthrough, fixtures); unit tests sit next to the code as *.test.ts
├─ saves/, userdata/, logs/       Runtime output (gitignored)
└─ docs: README.md, ARCHITECTURE.md, ADVENTURE_FORMAT.md, CREDITS.md
```

## 3. Module Boundaries

- `engine` imports nothing outside itself except `data` types, zod and plain constants/types from `shared` (e.g. `SAVE_SCHEMA_VERSION`). It is **isomorphic**: the server runs it with authority, and the client imports the same pure functions for instant previews (reachable squares, AoE highlights, point-buy math).
- `llm` and `tts` depend on `engine` types only. They never change game state; they return text or validated JSON.
- `host` wires the game (session, adventure port, systems, flag registry, lore, companions) with no Node or DOM imports; the AI ports are optional. The server and the web edition both use it.
- `server` builds the host with disk-loaded adventures, file saves and the LLM ports, persists saves, and proxies Ollama and Piper. It listens on 127.0.0.1 only, and the game WebSocket refuses browser pages from any other origin (`originAllowed`), since browsers let any site open a socket to localhost. Co-op (C005): with Settings → Table → "Allow a friend to join" on at start, `main.ts` listens on 0.0.0.0 and prints `http://<lan-ip>:<port>/?join=<code>` links. A connection from this PC's own pages is the host seat; any other (a LAN guest on a page this server served, or a local `/ws?guest` tab) has no seat and sees no events until it sends `join {code}` (`host.join` in `src/host/gameHost.ts`; code + seat tokens in `src/host/joinDesk.ts`, reusable by the web edition's peer transport). The token in `joined` reclaims the seat after a reload (the newer connection wins); `release_seat` frees it and the seat's characters go to the AI. While listening on the LAN, an `onRequest` hook keeps the REST API to the host (`server/lan.ts` `guestMayCall`: only health/status/settings GET, spoken lines and backstory ideas for guests). GET `/api/table` gives the host's table panel the code, links and seats. Client (C006b): the host's game menu "Table" opens `ui/game/TablePanel.tsx` (allow-join toggle, join links + a QR code drawn by `client/qr.ts`, seats, policy, lending companions); a `?join=` page shows `ui/JoinScreen.tsx` instead of the title (name + player/spectator → `join`, then the creator for a new player's hero → `add_hero`).
- `client` never decides mechanics. It sends **commands** and renders **events** and state snapshots through a `Transport` (client/net/transport.ts): `WebSocketTransport` (local server) or `InPageTransport` (lazily loads `host/inPage` and runs the game in the page; web edition). Stored data has the same split: the save browser uses a `SaveLibrary` (client/net/saveLibrary.ts: REST to the server's file store, or the in-page `MemorySaves` persisted to IndexedDB) and settings a `SettingsBackend` (ui/settingsState.ts: REST or localStorage). `client/webEdition.ts` `startWebEdition()` switches all three (transport, saves, settings) to the in-browser versions, plus the voice (`ttsPlayer.useSpeech`: browser speechSynthesis reads narration/dialogue log lines instead of Piper clips).
- **Web edition build** (`npm run build:web` = `vite build --mode web` → `dist-web/`): `client/edition.ts` `WEB_EDITION` (import.meta.env.MODE === 'web') makes main.tsx call `startWebEdition()` before loading the UI modules, and hides server/AI parts (AI settings tab, Ollama/Piper status lights, AI backstory → `templateBackstory`, free-text hint "use the buttons"). Base path is relative (`./`, or env `WEB_BASE`), Vite chunks go to `app/`, and `assetUrl()` maps `/assets/...` onto the base; the build copies `assets/models` + `assets/audio` into `dist-web/assets/`. `node scripts/web-screens.mjs [url]` screenshots title/creator/game/combat/load via Edge DevTools protocol and fails on page errors.
- **Code splitting (A128):** the title screen loads only the App shell (~75 KB gzip). `ui/lazyScreen.tsx` loads the creator, game screen and combat sandbox as chunks on first show; they carry the SRD data (`client/data.ts`), which ui/state.ts must never import statically (the in-progress character lives in `ui/creator/creatorState.ts`). The in-page host loads on the first command, three.js with the first 3D view. `build:web` ends with `scripts/site-size.mjs`: site size vs Pages limits + a title-screen code report from Vite's manifest (budget 1 MB gzip, fails the build if over).
- Randomness only comes from `engine/core/rng` (seeded, and its state is saved), so tests and replays are deterministic.

## 4. Runtime Data Flow

```
Player (button / free text / grid click)
  │  WebSocket command {type, payload}
  ▼
server → GameSession.handle(command)
  │  free text? → llm.parseIntent(text, context) → zod-validated Intent (retry once → fallback keyword parser)
  ▼
engine validates the intent/action → chooses check + DC (from adventure data, else SRD DC guidance)
  → rolls (seeded RNG) → applies effects → updates GameState (flags, HP, time, reputation, ...)
  → emits events: RollEvent (with math string), StateDelta, SceneChanged, CombatStarted, ...
  │
  ├─► client renders the events at once (dice tray, HP, grid) — never waits for the LLM
  └─► narration job: promptBuilder(system persona + region tone, compact state summary,
        last N exchanges, retrieved NPC/location/faction cards, FIXED FACTS of the outcome;
        budget ~1400 tokens, reply 3–5 sentences / 220 tokens — sized for CPU inference)
        → llm.streamNarration → tokens streamed to the client over WebSocket
          (timeouts: 60 s to the first chunk, then 15 s idle between chunks)
        → (optional) TTS queue → audio chunks → client playback
        → cut off mid-stream: keep the complete sentences
        → on LLM failure before a full sentence: template narration from engine/adventure text
  after each scene: llm.summarize(recent log) → story summary stored in GameState
```

- **Protocol** (`src/shared/protocol.ts`, zod-validated, optional `reqId`): client commands `ping | new_game | get_state | say | choose | save | load | thumbnail | travel | equip | unequip | repair | shop_* | journal_* | level_up | companion_control | combat_act | combat_flee`; server events `pong | ack | error | snapshot | log | narration(start/chunk/end) | roll | suggestions | objective | saved | journal | shop | mood | tts | combat | hero_fallen | dungeon`. One `GameSession` per server (single player); every open socket receives its events and commands run serially. Saves, actions (the adventure port) and systems are injected ports. Client state lives in signals in `src/client/net/gameSocket.ts` (reconnect + snapshot on reconnect).
- **Campaign flow**: `src/host/campaigns.ts` (plain data, no engine imports, so the title screen can bundle it) lists the campaigns: id, first-chapter adventure id, level range, `playable`, `importsWorld`, `freshWorld` flags. Two ship: The Seven Teeth of Vashkul (`millbrook_disappearances`, level 1 → 10) and The Hollow Crown (`arc2_ch0_hollow_coin`, level 1 → 5, `data/adventures/arc2/`). `new_game.campaign` names the first chapter to start (default the starter arc, `STARTING_ADVENTURE`), the host refuses an uninstalled one, and the state/save meta carry it (`campaign`). The UI (`ui/CampaignPicker.tsx`, title screen + creator Review step) reads the same table. The engine stays campaign-agnostic: per-campaign content is data (companion `arcs`, defeat outcome `when.campaigns`, the `arc.<arcId>.*` flag namespace). An adventure ending with `next` starts the next adventure at once (starter → ch1 → … → ch5; arc2 ch0 → … → ch3). How to add a campaign: ADVENTURE_FORMAT.md "Campaigns". Side quests suspend the main adventure and hand control back when they end.
- **New hero, same world** (B002): a save whose story reached a final ending carries `meta.ending`. For a campaign with `importsWorld`, `new_game.worldFrom` (a save slot) starts the new hero in that world (`importWorld` in GameSession.ts: `world.*` + `arc.main.*` flags, reputation, time + 1 year at 08:00; `extensions.worldFrom` records the source). Otherwise the campaign's `freshWorld` flags are written (SessionPorts.world, filled by the host). The creator's Review step offers the choice (ui/creator/WorldPicker.tsx).
- **Structured calls** (intent, suggested actions, summary, banter, backstory) all go through `llm/structured.ts`, which uses Ollama `format` (JSON schema), zod validation, one retry and then a typed fallback. A bad model reply can never throw into the engine.
- **One LLM queue** (`llm/scheduler.ts`, LlmScheduler): `server/services.ts` hands out every provider wrapped in a scheduler, so all calls run one at a time by priority: story narration > intent/backstory/test > combat narration (`queueAs: 'combat_narrate'`) > suggestions > banter > summary. Timeouts start when a job runs, not when it is queued. A new background job replaces a waiting one of the same kind; a player-facing job drops waiting suggestions/banter and preempts a running background chat (suggestions/banter dropped, a summary re-queued). Dropped jobs fail with `LlmError('aborted')` → the usual fallbacks.
- **Real-model playtest**: `scripts/playtest-llm.ts` plays the starter arc (or with `--campaign=hollow_crown`, Hollow Crown ch0) + the start of chapter 1 through `buildApp` with the real Ollama model; `llm/recording.ts` (RecordingLlm) wraps the provider and records every call (task, timing, first chunk, JSON validity) → `userdata/playtest-llm.{json,md}`.
- **Combat narration** is fire-and-forget (`CombatNarrationQueue`: one job running, only the newest waiting) and filtered by the "combat narration" setting (every / key moments / off).
- **Saves**: `GameState` is plain JSON, with `schemaVersion`, the RNG state, flags, party, world, story summary, journal, and an `extensions` bag. Autosave happens on scene change, rest and pre-combat, plus manual slots.

## 5. Save Format & Migrations

- `saves/<slotId>.json` = `{ schemaVersion, meta: {timestamp, location, level, thumbnail, mode}, state }`.
- `src/engine/session/migrations.ts` holds an ordered list of `(from → to)` pure functions. Loading runs every step up to the current version. Each migration has a fixture test.
- System extensions store data under `state.extensions[systemId]`, each with its own version and migrations (see §6).

## 6. Extension Points (Build Prompt §16)

The engine is organised around a **System Registry** (`src/engine/systems/registry.ts`). A system is a plain object with an id and optional hooks:

```ts
interface GameSystem {
  id: string;
  version: number;
  initState?(state): unknown;                         // owns state.extensions[id]
  migrate?(data, fromVersion): unknown;
  onTimeAdvance?(state, minutes): Event[];            // clock ticks (restock, weather, deadlines)
  onRest?(state, kind): Event[];
  downtimeActivities?: DowntimeActivityDef[];         // crafting would register "brew", "scribe", "forge"
  commands?: Record<string, CommandHandler>;          // new player commands
  promptCards?(state, context): PromptCard[];         // extra LLM context
}
```

Built-in systems (clock, weather, factions, shops, companions, scars/wear) use the same registry, so new systems don't need special wiring.

Implemented so far:

- `src/engine/systems/registry.ts`: `SystemRegistry` with `init` (initState plus migrate, with versions kept in `extensions._systemVersions`), `advanceTime`, `timeAdvanced` and `rest`.
- `clockSystem.ts`: reports day and night changes and new days.
- `storyConditionSystem.ts`: ends timed story conditions (an outcome's `conditions` with `minutes`, kept in `extensions.storyConditions`) when the clock passes them.
- `index.ts`: `createDefaultRegistry(calendar)`.

`GameSession` receives the registry as `ports.systems`. It initialises the registry on new game and on load. It calls `session.timePassed(from)` after every action and logs what the systems report.

| Future expansion | How it plugs in |
|---|---|
| **Crafting** | A new `crafting` system registers downtime activities and item recipes in `data/crafting/`. Materials are ordinary items with a `tags: ["material"]` field (already supported in the item schema). |
| **Home base** | A `stronghold` system owns `extensions.stronghold`. Locations support an `ownable` flag, and the rest and storage hooks already exist (`onRest`, inventory containers are generic). |
| **More arcs** | Adventures live in `data/adventures/<arcId>/`. World flags are namespaced (`arc.<arcId>.<flag>`, `world.<flag>`), and any adventure can read any namespace, so later arcs react to earlier ones. |
| **Adventure editor/importer** | The adventure format is a versioned zod schema with a standalone validator (the same one the side-quest generator uses). An editor or text importer only has to produce JSON that passes `validateAdventure()`. |

## 7. Memory Budget (8 GB target)

- LLM ≤ 3 GB (4B Q4 model; `keep_alive` is configurable so the model can be unloaded when idle).
- TTS ≤ 300 MB (Piper spawned on demand, one voice loaded at a time).
- Server + browser tab ≤ 1.5 GB (low-poly models, shared materials, texture-size presets, 2D token fallback).
