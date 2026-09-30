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
│  ├─ adventures/<arcId>/         Authored adventures (the ADVENTURE_FORMAT.md schema)
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
│  │  │                           combat narration queue, suggestions, summary, encounter scaling, side-quest generator + solver/validator, the session port (sessionActions.ts)
│  │  ├─ party/                   companions, loyalty, control mode
│  │  ├─ appearance/              appearance, equipment → model parts, monster → model, wound levels (data only; rendering lives in the client)
│  │  ├─ character/ (also)        scars.ts (permanent scars), armorWear.ts (wear + repair)
│  │  ├─ session/                 GameSession: owns GameState, applies commands, emits events
│  │  └─ systems/                 System registry (plugin hooks) — the extension point for §16
│  ├─ llm/                        Provider interface, Ollama client, mock provider, prompt builders, JSON schemas, fallbacks
│  ├─ tts/                        TTS provider interface, Piper adapter, mock
│  ├─ server/                     Fastify app: static client, REST (saves, settings, status), WebSocket game channel
│  ├─ shared/                     Client⇄server protocol types (commands, events), settings schema
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
- `server` wires everything together: it owns one `GameSession` per open game, persists saves, and proxies Ollama and Piper.
- `client` never decides mechanics. It sends **commands** and renders **events** and state snapshots.
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
        last N exchanges, retrieved NPC/location/faction cards, FIXED FACTS of the outcome)
        → llm.streamNarration → tokens streamed to the client over WebSocket
        → (optional) TTS queue → audio chunks → client playback
        → on LLM failure: template narration from engine/adventure text
  after each scene: llm.summarize(recent log) → story summary stored in GameState
```

- **Protocol** (`src/shared/protocol.ts`, zod-validated, optional `reqId`): client commands `ping | new_game | get_state | say | choose | save | load | thumbnail | travel | equip | unequip | repair | shop_* | journal_* | level_up | companion_control | combat_act | combat_flee`; server events `pong | ack | error | snapshot | log | narration(start/chunk/end) | roll | suggestions | objective | saved | journal | shop | mood | tts | combat | hero_fallen | dungeon`. One `GameSession` per server (single player); every open socket receives its events and commands run serially. Saves, actions (the adventure port) and systems are injected ports. Client state lives in signals in `src/client/net/gameSocket.ts` (reconnect + snapshot on reconnect).
- **Campaign flow**: the server starts the starter arc (`STARTING_ADVENTURE`); an adventure ending with `next` starts the next adventure at once (starter → ch1 → … → ch5). Side quests suspend the main adventure and hand control back when they end.
- **Structured calls** (intent, suggested actions, summary, banter, backstory) all go through `llm/structured.ts`, which uses Ollama `format` (JSON schema), zod validation, one retry and then a typed fallback. A bad model reply can never throw into the engine.
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
