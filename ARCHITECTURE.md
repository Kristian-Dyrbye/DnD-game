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
| LLM | **Ollama**, default model `qwen3:4b` (Q4, about 2.5 GB), `think:false`; fallback `llama3.2:3b` | Fits the 3 GB budget and gives reliable JSON. Configurable in settings. |
| TTS | **Piper** (Windows binary + ONNX voices, about 60 MB each), spawned by the server | Offline, light and fast on CPU. |
| Storage | Versioned JSON save files in `saves/`, with a migration chain | Easy to read and diff, with no native dependencies. |

## 2. Folder Structure

```
/
├─ Start Game.bat / Setup.bat     Windows launchers (CRLF)
├─ scripts/                       Node helper scripts (dependency checks, asset/voice download, SRD import, LLM benchmark)
├─ data/
│  ├─ srd/                        SRD 5.2 rules as JSON (classes, spells, monsters, items, feats, ...) + zod-validated
│  ├─ world/lore.json             Continent, regions (tone profiles), factions, gods, locations
│  ├─ adventures/<arcId>/         Authored adventures (the ADVENTURE_FORMAT.md schema)
│  └─ tables/                     Random tables (side quests, travel events, weather, loot, defeat outcomes)
├─ assets/                        Committed manifests + small CC0 assets; large packs downloaded by Setup.bat
├─ src/
│  ├─ engine/                     PURE TypeScript: no DOM, no Node APIs, no I/O. Deterministic with a seeded RNG.
│  │  ├─ core/                    rng, dice, ids, event bus, shared types
│  │  ├─ rules/                   abilities, checks, attacks, damage, conditions, effects, spells, rest, leveling, feats, multiclass
│  │  ├─ character/               character builder, derived stats, creator validation, quick build
│  │  ├─ combat/                  grid, LOS/cover, movement, initiative, actions, AoE, mastery, AI (enemy + companion)
│  │  ├─ world/                   clock, weather, travel, map discovery, fog, factions, shops, flags, schedules
│  │  ├─ adventure/               adventure schema, scene runner, encounter scaling, side-quest generator + validator
│  │  ├─ party/                   companions, loyalty, control mode
│  │  ├─ appearance/              wounds, scars, armor wear (data only; rendering lives in the client)
│  │  ├─ session/                 GameSession: owns GameState, applies commands, emits events
│  │  └─ systems/                 System registry (plugin hooks) — the extension point for §16
│  ├─ llm/                        Provider interface, Ollama client, mock provider, prompt builders, JSON schemas, fallbacks
│  ├─ tts/                        TTS provider interface, Piper adapter, mock
│  ├─ server/                     Fastify app: static client, REST (saves, settings, status), WebSocket game channel
│  ├─ shared/                     Client⇄server protocol types (commands, events), settings schema
│  └─ client/                     Preact UI, three.js scenes, 2D grid canvas, audio manager
│     ├─ ui/                      screens: title, creator, main game, combat, map, journal, settings, save browser
│     ├─ three/                   model loader, character rig/equipment attach, battle scene, preview
│     └─ audio/                   music crossfade, SFX, TTS playback
├─ tests/                         Cross-module tests (smoke playthrough, fixtures); unit tests sit next to the code as *.test.ts
├─ saves/, userdata/, logs/       Runtime output (gitignored)
└─ docs: README.md, ARCHITECTURE.md, ADVENTURE_FORMAT.md, CREDITS.md
```

## 3. Module Boundaries

- `engine` imports nothing outside itself except `data` types and zod. It is **isomorphic**: the server runs it with authority, and the client imports the same pure functions for instant previews (reachable squares, AoE highlights, point-buy math).
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

- **Structured calls** (intent, suggested actions, summary, banter, backstory) all go through `llm/structured.ts`, which uses Ollama `format` (JSON schema), zod validation, one retry and then a typed fallback. A bad model reply can never throw into the engine.
- **Combat narration** is fire-and-forget and throttled by the "narration frequency" setting.
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
