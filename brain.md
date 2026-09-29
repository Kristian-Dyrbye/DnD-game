# brain.md: Persistent Memory

> This is the only memory carried between sessions. Read it fully at the start of every session. Update it at the end of every session. Keep it under about 400 lines.

## Status
- **State:** IN PROGRESS
- **Current phase:** 2 (Rules Engine)
- **Last completed assignment:** A029
- **Notes for next session:** Start with A030. A010 is blocked on Ollama: if `ollama --version` works now, set A010 to todo and do it first. Ollama is NOT installed yet (the owner is installing it); use the mock LLM. 

## Assignment Queue
<!-- Compact format (one item per line, to keep brain.md small):
- [status] A<id> — Title | Spec: §x | Done: testable criteria | Dep: A<id>
Status values: todo | in-progress | done | failed | blocked
Every assignment's Done also implicitly includes: `npm run typecheck` + `npm test` pass (and `npm run build` if it touches the client). -->

### Phase 0 — Bootstrap
- [done] A000 — Plan the whole build

### Phase 1 — Foundation
- [done] A001 — Project scaffold
- [done] A002 — Fastify server
- [done] A003 — Settings/config system
- [done] A004 — LLM provider + Ollama client + mock
- [done] A005 — Structured JSON helper
- [done] A006 — TTS provider + Piper adapter + mock
- [done] A007 — Status endpoint + indicator
- [done] A008 — Save system + migrations
- [done] A009 — Setup.bat + Start Game.bat
- [blocked] A010 — Pick & benchmark LLM (needs Ollama) | Spec: §2, §3 | Done: scripts/bench-llm.mjs tests JSON validity + speed for qwen3:4b vs llama3.2:3b (+ any newer 3–4B); result in Decisions Log; README note on swapping models | Dep: A005, owner installs Ollama

### Phase 2 — Rules Engine
- [done] A011 — RNG + dice
- [done] A012 — Core rule types
- [done] A013 — SRD 5.2 data pipeline + schemas
- [done] A014 — SRD data: conditions, exhaustion, core tables
- [done] A015 — SRD data: equipment
- [done] A016 — SRD data: species + backgrounds
- [done] A017 — SRD data: feats + epic boons
- [done] A018 — SRD data: classes part 1 (Barbarian, Bard, Cleric, Druid)
- [done] A019 — SRD data: classes part 2 (Fighter, Monk, Paladin, Ranger)
- [done] A020 — SRD data: classes part 3 (Rogue, Sorcerer, Warlock, Wizard)
- [done] A021 — SRD data: spells cantrip–2
- [done] A022 — SRD data: spells 3–5
- [done] A023 — SRD data: spells 6–9
- [done] A024 — SRD data: monsters A–F
- [done] A025 — SRD data: monsters G–M
- [done] A026 — SRD data: monsters N–S
- [done] A027 — SRD data: monsters T–Z
- [done] A028 — SRD data: magic items
- [done] A029 — Ability checks & saves
- [todo] A030 — Attacks & damage | Spec: §4 | Done: to-hit, nat 20/1, crit dice, resist/vuln/immune, temp HP, damage application; tests | Dep: A029
- [todo] A031 — Conditions engine + exhaustion 2024 | Spec: §4 | Done: apply/remove/duration, data-driven roll modifiers, exhaustion −2/level d20 & −5 ft speed, death at 6; tests | Dep: A014, A030
- [todo] A032 — Death saves, 0 HP, resting | Spec: §4, §9 | Done: death saves, stabilize, massive damage, healing from 0, short rest (hit dice) and long rest, generic resource recovery; tests | Dep: A031
- [todo] A033 — Effect system | Spec: §4 | Done: data-driven executor for damage/heal/condition/save/area/duration effects; tests | Dep: A031
- [todo] A034 — Spellcasting engine | Spec: §4 | Done: slots, save DC/attack, upcast, concentration (DC max(10, dmg/2)), rituals, abstract components, pact magic; tests | Dep: A033, A021
- [todo] A034a — Spell effects pass | Spec: §4 | Done: hand-written effects/hooks in data/srd/overrides/spells.json for the ~40 most-used combat spells that have no auto effects (magic_missile, bless, shield, ice_storm, counterspell, guiding_bolt, spiritual_weapon, etc.); cantrip damage scaling by character level (5/11/17) in the engine; tests | Dep: A034
- [todo] A035 — Character builder + derived stats | Spec: §4, §5 | Done: build from class/species/background/scores; AC (armor, shield, unarmored), HP, speed, proficiencies, attacks; tests | Dep: A015, A016, A018
- [todo] A036 — Leveling + feats | Spec: §4 | Done: XP thresholds, level-up (HP, features, subclass, ASI/feat, epic boon), feat effects via hooks; tests | Dep: A035, A017, A020
- [todo] A037 — Multiclassing | Spec: §4 | Done: prereqs, proficiencies gained, multiclass slot table, pact magic separate; tests | Dep: A036
- [todo] A038 — Weapon mastery | Spec: §4, §10 | Done: cleave, graze, nick, push, sap, slow, topple, vex; tests | Dep: A030, A015
- [todo] A039 — Class features batch 1 (Barbarian, Bard, Cleric, Druid) | Spec: §4 | Done: mechanical features 1–20 as hooks/effects; tests for key ones | Dep: A036, A034
- [todo] A040 — Class features batch 2 (Fighter, Monk, Paladin, Ranger) | Spec: §4 | Done: as A039 | Dep: A039
- [todo] A041 — Class features batch 3 (Rogue, Sorcerer, Warlock, Wizard) | Spec: §4 | Done: as A039 | Dep: A039
- [todo] A042 — Monster runtime + encounter builder | Spec: §4, §6 | Done: combatant from stat block (multiattack, recharge, legendary); XP-budget encounter scaling by party size/level; tests | Dep: A024, A030

### Phase 3 — Character Creation
- [todo] A043 — Creator state machine + class step UI | Spec: §5 | Done: engine-side wizard state + validation; class step with summaries + beginner tags; tests | Dep: A035, A002
- [todo] A044 — Background + species steps | Spec: §5 | Done: UI shows ASI options + origin feat; validation tests | Dep: A043
- [todo] A045 — Ability score methods | Spec: §5 | Done: standard array, point buy (27, cost table), 4d6-drop-lowest animated with player assignment; engine tests | Dep: A043, A011
- [todo] A046 — Skills, equipment, spells steps | Spec: §5 | Done: skill picks, starting package vs gold, spell selection; tests | Dep: A044, A034
- [todo] A047 — Identity, backstory, difficulty, Quick Build | Spec: §5, §9 | Done: name/traits/backstory, LLM backstory suggestion (mock), Heroic/Hardcore pick, Quick Build per class; tests | Dep: A046, A005
- [todo] A048 — 3D asset research + import | Spec: §12 | Done: pick CC0 modular kits (Quaternius/KayKit), verify license, download to assets/, manifest, CREDITS.md entries | Dep: A001
- [todo] A049 — 3D preview + appearance customization | Spec: §5, §12 | Done: three.js viewer in creator (rotate), body/face/hair/skin/colors saved to character; build passes | Dep: A048, A043

### Phase 4 — Narration Loop
- [todo] A050 — GameSession + WebSocket protocol | Spec: §3, §8 | Done: shared command/event types, GameSession.handle, state snapshots, ws wiring; tests | Dep: A002, A035
- [todo] A051 — Adventure schema v1 + scene runner | Spec: §7.3 | Done: zod schema (chapters, scenes, POIs, exits, conditions, checks, NPCs, encounters, beats, loot, flags); runner moves between scenes; tiny test adventure; ADVENTURE_FORMAT.md v1; tests | Dep: A050
- [todo] A052 — Main screen layout | Spec: §8 | Done: story log, party panel, 3D view slot, map button, dice tray slot, input area; build passes | Dep: A050
- [todo] A053 — Dice tray | Spec: §8 | Done: animated dice, math line, two dice for adv/dis, scrollable roll history | Dep: A052, A011
- [todo] A054 — Prompt builder + retrieval cards | Spec: §3 | Done: system persona + region tone, compact state summary, last N exchanges, NPC/location/faction cards, fixed-facts block, token budget; tests | Dep: A051, A004
- [todo] A055 — Intent parsing | Spec: §3, §8 | Done: Intent schema, LLM JSON parse, keyword fallback parser, engine validation; tests with MockLlm | Dep: A054, A005
- [todo] A056 — Action resolution pipeline | Spec: §3, §8 | Done: intent → check/DC (adventure data or SRD guidance) → roll → state change → fixed facts → narration request; tests | Dep: A055, A029
- [todo] A057 — Streaming narration + template fallback | Spec: §3, §17 | Done: token streaming over ws to story log; template narration when LLM down; tests | Dep: A056
- [todo] A058 — Suggested action buttons + free text | Spec: §3, §8 | Done: 3–5 LLM suggestions (JSON) with data-driven fallback; free text box wired to intent; tests | Dep: A056
- [todo] A059 — Rolling story summary | Spec: §3 | Done: summarize after each scene, stored in state, used instead of transcript; tests | Dep: A057

### Phase 5 — Grid Combat
- [todo] A060 — Grid model, LOS, cover | Spec: §10 | Done: squares, terrain, walls, LOS, half/three-quarters cover; tests | Dep: A012
- [todo] A061 — Movement + opportunity attacks | Spec: §10 | Done: reachable squares with difficult terrain, OA triggers, disengage; tests | Dep: A060
- [todo] A062 — Initiative, turns, action economy | Spec: §10 | Done: initiative order, turn manager, action/bonus/reaction/move/object tracking; tests | Dep: A061, A029
- [todo] A063 — Combat actions | Spec: §10 | Done: attack (ranges, long range/adjacent disadvantage), dash, disengage, dodge, help, hide, ready, grapple, shove, 2024 versions; mastery wired; tests | Dep: A062, A038
- [todo] A064 — AoE templates | Spec: §10 | Done: cone, cube, sphere, line, cylinder → affected squares/creatures; tests | Dep: A060
- [todo] A065 — 2D token battle map UI | Spec: §10, §14 | Done: canvas grid, tokens, reachable highlight, turn tracker, action bar, AoE preview, combat log | Dep: A063, A064, A052
- [todo] A066 — Enemy AI | Spec: §10 | Done: deterministic targeting, ability use, morale/flee; tests | Dep: A063, A042
- [todo] A067 — Companion AI | Spec: §6 | Done: role-aware tactics (heal, keep distance, protect); tests | Dep: A066
- [todo] A068 — Combat ↔ story integration | Spec: §9, §10 | Done: encounter start from scene, win/lose/flee outcomes, XP, pre-combat autosave, Heroic defeat outcomes, Hardcore death + new hero in same world; tests | Dep: A067, A051, A008
- [todo] A069 — Async combat narration | Spec: §10 | Done: narration never blocks; frequency setting (every/key/off); tests | Dep: A068, A057
- [todo] A070 — 3D battle map | Spec: §10, §12 | Done: three.js grid with models, orbit/zoom camera, 2D/3D toggle | Dep: A065, A049

### Phase 6 — Exploration
- [todo] A071 — World lore | Spec: §7.1 | Done: data/world/lore.json (continent, 3 regions with tone profiles, history, factions, gods, key locations); schema + test | Dep: A013
- [todo] A072 — Clock + day/night | Spec: §11.3 | Done: clock advanced by travel/explore/rest/downtime; System Registry with onTimeAdvance; tests | Dep: A050
- [todo] A073 — Weather | Spec: §11.4 | Done: region/season tables, mechanical effects (travel, obscurement, wind ranged penalty, fire/cold); tests | Dep: A072, A071
- [todo] A074 — Travel + world map engine | Spec: §11.1 | Done: locations, routes, discovery, pace/travel time, random travel events by region/weather; tests | Dep: A073
- [todo] A075 — World map UI | Spec: §11.1 | Done: illustrated clickable map, reveal on discovery, travel, time/weather tint | Dep: A074, A052
- [todo] A076 — Dungeon maps + fog of war | Spec: §11.1 | Done: room-by-room maps on grid engine, fog reveal, seamless start of combat on same map; tests | Dep: A065, A068
- [todo] A077 — Schedules + deadlines | Spec: §11.3 | Done: shop/NPC schedules, day/night-only encounters, quest deadlines with consequences; tests | Dep: A072

### Phase 7 — World Systems
- [todo] A078 — Flag system | Spec: §7.2 | Done: namespaced flags, condition expression evaluator, cross-arc reads, flag reads/writes in adventure runner; tests | Dep: A051
- [todo] A079 — Factions + reputation | Spec: §11.2 | Done: tiers Hostile→Revered, ally/enemy propagation, gating helpers; tests | Dep: A078, A071
- [todo] A080 — Dynamic shops engine | Spec: §11.5 | Done: pricing (region, supply/demand, reputation, haggle), stock + restock, selling lowers price, rarity availability; tests | Dep: A079, A028
- [todo] A081 — Inventory + shop UI | Spec: §11.5 | Done: inventory, equip, gold, buy/sell/haggle screens | Dep: A080, A052
- [todo] A082 — Internal quest tracking + objective hint | Spec: §15 | Done: engine quest tracker (hidden), optional objective hint toggle (default OFF); tests | Dep: A078
- [todo] A083 — Journal notebook | Spec: §15 | Done: free-form pages, organize, saved with game | Dep: A052, A008

### Phase 8 — Companions
- [todo] A084 — Companion model + recruitment | Spec: §6 | Done: full sheets, recruit via adventure data, party ≤ 4, party UI; tests | Dep: A068, A051
- [todo] A085 — Loyalty/approval | Spec: §6 | Done: approval shifts from choices, leave/betray at authored points; tests | Dep: A084, A078
- [todo] A086 — Banter | Spec: §6 | Done: occasional LLM lines with cooldown + fallback lines; tests | Dep: A085, A054
- [todo] A087 — Control toggle + companion leveling | Spec: §6 | Done: AI/player toggle outside combat, companions level with hero; tests | Dep: A084, A036

### Phase 9 — 3D Equipment, Wounds, Scars
- [todo] A088 — Equipment on model | Spec: §12 | Done: SRD item → visual part map with fallbacks; gear change updates model | Dep: A049, A081
- [todo] A089 — Monster + NPC models | Spec: §12 | Done: monster → model/stand-in/tint map; gaps listed in brain.md | Dep: A070
- [todo] A090 — Temporary wounds | Spec: §12 | Done: overlays scale with missing HP, fade on heal/rest | Dep: A088
- [todo] A091 — Permanent scars | Spec: §12 | Done: triggers (crit taken, 0 HP, story), placement, origin log, hover inspect, narration mentions; engine tests | Dep: A090
- [todo] A092 — Armor wear + repair | Spec: §12 | Done: dents/scratches accumulate, repair at smith/downtime for gold/time; tests | Dep: A088, A080
- [todo] A093 — Character screen + save thumbnails | Spec: §9, §12 | Done: rotatable 3D character screen; save browser with thumbnail showing gear/scars | Dep: A091, A008

### Phase 10 — Audio
- [todo] A094 — Audio assets | Spec: §13 | Done: CC0 music by mood + SFX downloaded, verified, CREDITS.md | Dep: A001
- [todo] A095 — Music + SFX manager | Spec: §13 | Done: mood crossfade, SFX hooks (dice, hits, spells, UI, doors, steps), volumes | Dep: A094, A052
- [todo] A096 — Piper install + voices | Spec: §13, §1 | Done: Setup downloads Piper for Windows + narrator/male/female voices; license in CREDITS | Dep: A006, A009
- [todo] A097 — TTS narration pipeline | Spec: §13 | Done: background generation queue, skip, volume, toggle, never blocks; tests with MockTts | Dep: A096, A057

### Phase 11 — Content
- [todo] A098 — Starter arc part 1 | Spec: §7.2 | Done: exploration, dialogue, skill-check tutorial scenes (valid schema) | Dep: A078, A084
- [todo] A099 — Starter arc part 2 | Spec: §7.2, §9 | Done: combat, rest, shop, companion, world map, hook, defeat outcomes | Dep: A098
- [todo] A100 — Campaign arc design | Spec: §7.2 | Done: villain, factions, flag plan, chapter outlines, 2+ endings (in data/adventures/arc1/README or JSON) | Dep: A099
- [todo] A101 — Arc chapter 1 | Spec: §7.2 | Done: valid schema, reads starter flags | Dep: A100
- [todo] A102 — Arc chapter 2 | Spec: §7.2 | Done: as A101, second region | Dep: A101
- [todo] A103 — Arc chapter 3 | Spec: §7.2 | Done: as A101 | Dep: A102
- [todo] A104 — Arc chapter 4 | Spec: §7.2 | Done: as A101 | Dep: A103
- [todo] A105 — Arc chapter 5 + endings | Spec: §7.2 | Done: 2+ endings depending on flags; tests that flags change content | Dep: A104
- [todo] A106 — Starter arc smoke test | Spec: §17 | Done: automated playthrough of starter arc key path with MockLlm | Dep: A099

### Phase 12 — Procedural Side Quests
- [todo] A107 — Side-quest tables | Spec: §7.4 | Done: data/tables for quest type, location, antagonist, complication, twist, reward | Dep: A051
- [todo] A108 — Generator + thread pulling | Spec: §7.4 | Done: produces valid adventure schema, prefers loose threads from flags; tests | Dep: A107, A078
- [todo] A109 — Validator + regenerate | Spec: §7.4, §17 | Done: rejects broken/unwinnable quests, regenerates; tests | Dep: A108
- [todo] A110 — Write-back + availability | Spec: §7.4 | Done: outcomes write flags; offered via boards, taverns, faction contacts, travel events; tests | Dep: A109, A074

### Phase 13 — Polish
- [todo] A111 — Settings panel | Spec: §14 | Done: volumes, TTS toggle, perf presets (incl 2D mode), LLM settings + test connection, text size, dyslexia font, colorblind overlays, unload when idle | Dep: A003, A095
- [todo] A112 — Performance pass | Spec: §1, §14 | Done: memory checks against budget, frame cap, LOD, Ollama keep_alive unload | Dep: A111
- [todo] A113 — Error handling pass | Spec: §17 | Done: Ollama/TTS down messages, fallbacks verified end to end | Dep: A111
- [todo] A114 — Docs + About screen | Spec: §4, §17 | Done: README, ARCHITECTURE, ADVENTURE_FORMAT, CREDITS final; SRD CC-BY-4.0 attribution in About + README | Dep: A113
- [todo] A115 — Full playtest pass | Spec: §17 | Done: play through with mock (and real LLM if available); issues become new queue items | Dep: A114
- [todo] A116 — Final check | Spec: all | Done: all tests, typecheck, build pass; Status DONE | Dep: A115

## Completed Log
<!-- One line per assignment: A<id> — what was built — key files. Compress into per-phase summaries when long. -->
- Phase 0–1 (A000–A009, A010 blocked): repo + ARCHITECTURE.md; Vite+Preact client, strict TS, Vitest; Fastify server (/api/health, /ws echo, static + SPA fallback, dev proxy); settings schema + store + /api/settings; LLM layer (LlmProvider, OllamaClient w/ NDJSON streaming + status, deterministic MockLlm, callStructured w/ zod + retry + fallback); TTS layer (PiperTts spawn-per-utterance → WAV, MockTts); /api/status + StatusIndicator; saves (envelope, migration chain, rotating autosaves, /api/saves); Setup.bat / Start Game.bat + scripts/check-deps.mjs. Key dirs: src/server, src/shared, src/llm, src/tts, src/client, scripts/.
- Phase 2 part 1 (A011–A028): seeded Rng + dice/d20 math (engine/core); core vocabulary + Creature/Character schemas (engine/rules/basics, engine/core/creature); SRD data pipeline (engine/data schemas + SrdDatabase + loadSrd; scripts/srd importers; `npm run srd:fetch`, `npm run srd:import`). Data: 15 conditions (+modifiers), rules tables, 38 weapons, 13 armor, 150 gear, 9 species, 4 backgrounds, 17 feats, 12 classes + 12 subclasses, 339 spells (93 with auto effects), 330 monsters/animals, 271 magic items. Tests per file in src/engine/data/*Data.test.ts.
- A029 — d20Test core (adv/dis cancel, exhaustion −2/level, autoFail, math line) + abilityCheck/skillCheck/savingThrow/passiveScore/contest — `src/engine/rules/checks.ts`

## Decisions Log
<!-- Choice — alternatives considered — why. Never delete; summarize if long. -->
- Owner decisions (fixed, from the planning session): Windows, 8 GB RAM, browser app, Ollama with a 3–4B model, full SRD 5.2 with feats and multiclassing, all 3 ability score methods, a starter arc plus one full linked arc, woven-in procedural side quests, a mixed-tone world, auto dice with visible math, Heroic/Hardcore modes, a 3D grid combat map, autosave plus manual slots in all modes, buttons plus free text, flexible AI/player companions, music + SFX + Piper TTS, a world map plus fog-of-war dungeons, a notes-only journal, factions, day/night, weather, dynamic shops, low-poly CC0 3D models for everyone with wounds, scars, and armor wear. Crafting and home base are future expansions only.
- Owner decision (2026-09-29): §15 "current objective" hint — include it as a toggle in Settings, default OFF.
- Owner setup (2026-09-29): Ollama being installed by the owner before the loop starts; A000 picks the model. Kit duplicates deleted; `.claude/settings.json` lives in project root.
- A000: Frontend = Vite + Preact + @preact/signals — alt React (heavier), Svelte (less familiar tooling) — small memory footprint, React-like API.
- A000: Server = Fastify + @fastify/websocket — alt Express, plain http — typed, fast, inject() for tests.
- A000: Validation = zod everywhere (SRD data, saves, settings, LLM JSON, protocol) — one schema lib.
- A000: Tests = Vitest; dev = tsx + vite proxy; single npm package (no workspaces) — simplest for the loop.
- A000: Engine is pure isomorphic TS; the server owns the authoritative GameSession; the client imports engine functions only for previews. Alt: client-side engine — rejected because of saves/LLM/TTS on the server and headless smoke tests.
- A000: Transport = WebSocket for commands/events/stream tokens; REST for saves/settings/status.
- A000: Default LLM = qwen3:4b (Q4, ~2.5 GB, think:false); fallback llama3.2:3b (~2 GB). gemma3:4b rejected (~3.3 GB, over budget). To be confirmed by A010 benchmark.
- A000: TTS = Piper Windows binary spawned per request; voices downloaded by Setup.bat.
- A000: Saves = versioned JSON + migration chain; systems keep data in state.extensions[id].
- A000: §16 readiness = System Registry (hooks: initState, migrate, onTimeAdvance, onRest, downtimeActivities, commands, promptCards); namespaced flags (arc.<id>.*, world.*); standalone validateAdventure().
- A001: Tooling versions installed: TypeScript 7.0 (native `tsc`), Vite 8, Vitest 5, Preact 10, @preact/signals 2. Vite root = src/client, build → dist/client.
- A001: tsconfig: strict + noUncheckedIndexedAccess + verbatimModuleSyntax (use `import type` for types); moduleResolution Bundler, so no .js suffixes in imports. Server will run through tsx/bundling, not plain tsc emit.
- A002: Server listens on 127.0.0.1:3210 (env PORT overrides); run via tsx (`npm start`, `npm run dev:server`) instead of a compiled bundle — simplest, no build step for the server.
- A003: zod 4.6 installed. Nested section defaults use `.prefault({})` (zod 4 `.default({})` skips inner defaults). Settings PUT takes a partial patch merged per section; invalid → 400 with `path: message`.
- A003: Settings file = userdata/settings.json (gitignored). Corrupt file → defaults; bad fields salvaged one by one.
- A004: Ollama client uses global fetch (injectable) — no SDK dependency. `think:false` sent only to reasoning models (qwen3, deepseek-r1, magistral, gpt-oss). keep_alive = idleMinutes if unloadWhenIdle, else '60m' (not -1, so a closed game frees RAM).
- A004: Every LLM call carries `task` (narrate/intent/suggest/summarize/dialogue/banter/backstory) for logging and mock routing. MockLlm default: rotating template narration; `{}` for JSON calls.
- A005: Structured retry is skipped for `unreachable`/`aborted` errors (retrying can't help); retry message includes the zod error. zod 4 `z.toJSONSchema` builds the Ollama format ($schema stripped). extractJson strips ```fences, <think> blocks, chatter.
- A006: Piper is spawned once per utterance (`--model <voice>.onnx --output_raw`, text on stdin), PCM wrapped as WAV using sample_rate from <voice>.onnx.json. No resident process → near-zero idle RAM, so tts.unloadWhenIdle is effectively always true. Voice ids = .onnx file names.
- A007: Providers live in `app.services` (Services): `.llm`/`.tts` getters rebuild when their settings section changes; tests pass `buildApp({services:{llm: new MockLlm(), tts: new MockTts()}})`. Indicator: mock = amber, model not loaded = amber, missing = red; RAM warn < 1 GB free, error < 400 MB.
- A008: Save file = {schemaVersion, meta, state}; state validated later by the engine GameState schema (A050). Autosaves rotate auto-1 (newest) → auto-3. Slot ids /^[a-z0-9][a-z0-9_-]{0,39}$/ (blocks path traversal). SaveError kinds → HTTP 400/404/422 via app error handler.
- A008: Engine may import plain constants/types from `src/shared` (ARCHITECTURE.md updated).
- A009: check-deps is plain JS (runs before npm install); pure logic in check-deps-lib.mjs + .d.mts types, tested from tests/check-deps.test.ts. DEFAULT_MODEL and GAME_PORT are duplicated there; a test keeps them in sync with settings.ts and server/port.ts.
- A009: package.json `allowScripts: {esbuild: false}` silences npm 11's install-script warning (esbuild works via its optional platform package).
- A009: Server opens the browser itself (OPEN_BROWSER=1) after listen, so the page never loads before the server is up.
- A011: RNG = sfc32 seeded by cyrb128 string hash; RngState = 4 uint32 stored in saves. Math-line format: `d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success`; adv/dis: `d20 (adv: 7, 14 → 14) ...`; damage: `2d6+3: [4, 2] + 3 = 9`, dropped dice as ~x~. Uses the real minus sign (−) in display text.
- A012: Ids are snake_case strings (skills `sleight_of_hand`, classes `fighter`). Creature holds CURRENT state; static rules data is referenced by id (classId, statBlockId). Exhaustion stored as a number 0–6 on the creature, not as an ActiveCondition. hitDice stored per die size ({d10: 3}) for multiclass.
- A013: SRD source = community Markdown of SRD 5.2.1 (github downfallx/dnd-5e-srd-markdown @1b4b99d, CC-BY-4.0) — alt: official PDF (hard to parse), 5e-bits (2014-focused) — cleanest structured text. Source is gitignored; generated JSON is committed. Importers: write `scripts/srd/import-<kind>.ts` (run with `npx tsx`), parse Markdown → validate with the zod schema → write data/srd/<file>.json. Hand fixes go in `data/srd/overrides/<file>.json` merged by id.
- A013: Money stored in copper (CP) integers everywhere (1 GP = 100). Data ids snake_case via toId(). Monster saves stored as final printed bonuses for all six abilities. Spells keep importer hints (save, damage, area, attack) plus hand-refined `effects`.
- A013: Effect union (damage, heal, temp_hp, save, attack, condition, area, hook) in engine/data/common.ts; complex features use `{kind:'hook', hook:'name'}` implemented in code.
- A013: Data reaches the engine via static JSON imports in srdBundle.ts (works in Vite, Vitest, tsx). loadSrd() caches a validated SrdDatabase. A test asserts every committed data file validates.
- A014: Condition mechanics live in `modifiers` (ConditionModifiersSchema: implies, speedZero, own/against attack modes, within/beyond 5 ft, autoFailSaves, saves, autoCrit, sight/hearing, source rules). Hand-written in overrides; importer supplies text. Exhaustion stays numeric (−2×level d20, −5×level ft speed).
- A014: CR 0 XP stored as 10 ("0 or 10" in SRD). Typical DC table: source drops the Medium row; hard-coded 5/10/15/20/25/30 and cross-checked.
- A014: rules-tables.json is an object (not in SRD_FILES); SrdDatabase(files, rulesTables) → `db.rules` (throws if missing), `db.tables` optional.
- A015: Gear ids: focuses prefixed (`arcane_focus_orb`, `holy_symbol_amulet`), gaming sets `<variant>_set` tagged gaming_set, instruments by name tagged musical_instrument, comma names flattened (`lantern_hooded`, `clothes_fine`, `case_map_or_scroll`). Ammo ids: arrows, bolts, needles, bullets_sling, bullets_firearm (weapon.ammunition). Large ships skipped (not needed yet). Tools keep `craft` lists for future crafting.
- A016: Background equipment: generic items (Holy Symbol, Gaming Set, focuses, instruments) become `choices` tags; quantities are units ("20 Arrows" → [arrows, 20]). Tool field is an item id or `choice:<tag>`. Species traits keep text; mechanics come later via hooks/effects (A035/A039+). Lineage spells referenced by spell id (validated once spells exist, A021–A023).
- A018: Classes done with ONE generic importer, so A019/A020 were completed in the same session (all 12 classes tested). Beginner-friendly classes = fighter, barbarian, rogue (game decision). Weapon proficiency tokens: simple, martial, martial:light, martial:finesse. Class `columns` keyed by snake_case header; numbers where numeric, strings for dice ('1d6'), 0 for '—'. Multiclass gains kept as text strings (parse in A037).
- A018: Spellbook added as gear (50 GP, 3 lb., classic SRD values) because the 2024 SRD has no gear row for it.
- A021: Spells imported with ONE importer, so A022/A023 were completed in the same session. Auto effects only for unambiguous patterns; other spells keep hints + text and get hand effects/hooks in A034a (new queue item). Cantrip scaling is NOT in data (engine rule, A034a).
- A024: Monsters imported with ONE importer (A025–A027 done in the same session). Attack `damage` = always-on damage only; conditional extras ("plus 1d4 if Advantage", Bloodied alternatives) stay in text for hooks. Multiattack "A or B" / "any combination" → first option. Hydra multiattack = 5 Bites (starting heads). Source typos fixed: Will-o'-Wisp STR (derived from mod), Archmage XP 8,400 (override), 'Long Strider' → longstrider.
- A028: Magic item ids for +N items end in _N (weapon_1). `potion_of_healing` exists both as gear (buyable, 50 GP) and as a magic item (with heal effect) — separate maps, same id on purpose. 'Rarity Varies' items (spell_scroll, ioun_stone, figurine...) keep rarity 'varies'.
- A028: `npm run srd:import` rebuilds all SRD JSON deterministically (verified no diff on rerun).
- A029: All D20 Tests go through d20Test(); it takes adv/dis as lists of source names (cancel per SRD) and optional autoFail reason. Nat 20/1 only matter for attack rolls (A030). Proficiency modifier labels: 'Proficiency: Persuasion', 'Expertise: Stealth'.
- A000: Queue uses a compact one-line format so ~116 assignments fit under the 400-line limit.

## File Map
<!-- path — purpose -->
- `solo-dnd-build-prompt.md` — the full spec (the Build Prompt)
- `CLAUDE.md` — loop rules (read automatically)
- `brain.md` — this memory file
- `ARCHITECTURE.md` — stack, folders, module boundaries, data flow, §16 extension points
- `run-loop.bat` — the owner's automation loop
- `.claude/settings.json` — permission allow/deny list for loop sessions
- `loop_status.txt` — per-session status word read by the loop (gitignored)
- `package.json` — scripts: dev, build, preview, test, test:watch, typecheck
- `tsconfig.json` — strict TS config for all of src/tests/scripts
- `vite.config.ts` — Vite (client) + Vitest config (tests: src/**/*.test.ts(x), tests/**/*.test.ts)
- `src/client/` — index.html, main.tsx, styles.css, ui/App.tsx
- `src/server/app.ts` — buildApp(opts): Fastify app factory (REST, /ws, static). Tests use inject()/injectWS()
- `src/server/main.ts` — entry; serves dist/client on 127.0.0.1:3210
- `src/shared/settings.ts` — SettingsSchema (llm, tts, audio, performance, accessibility, gameplay), defaultSettings, mergeSettings
- `src/server/settingsStore.ts` — SettingsStore(userDataDir): get/update, persisted to settings.json; exposed as `app.settings`
- `src/engine/core/rng.ts` — Rng.fromSeed, next/int/pick/shuffle, getState/setState
- `src/engine/core/dice.ts` — parseDice, roll, formatRoll, diceStats, resolveRollMode, rollD20, formatD20Test
- `src/engine/rules/basics.ts` — ABILITIES, SKILL_ABILITY, DAMAGE_TYPES, SIZES, CREATURE_TYPES, CONDITIONS (+ zod enums); abilityModifier, proficiencyBonus(ForCR), proficiencyContribution, parseCR/formatCR, formatModifier, sizeSquares
- `src/engine/core/creature.ts` — CreatureSchema, CharacterSchema, CombatantSchema, ActiveCondition, Resource, totalLevel
- `src/engine/rules/checks.ts` — d20Test (shared core), abilityCheck, skillCheck, savingThrow, checkModifiers, saveModifiers, passiveScore, contest
- `src/engine/data/common.ts` — IdSchema, DiceSchema, CostSchema(CP), DamageSchema, AreaSchema, DurationSchema, EffectSchema/Effect, toId
- `src/engine/data/schemas.ts` — schemas for every data/srd file + RulesTablesSchema; SRD_FILES registry; record types
- `src/engine/data/srd.ts` — validateSrdFile, SrdDatabase (maps by id, item(), spellsForClass)
- `src/engine/data/srdBundle.ts` — static imports of data/srd/*.json; loadSrd()
- `scripts/srd/lib.ts` — importer helpers: makeItemResolver(ids) (item phrases → [id, qty]), costToCp, weightLb, readSource, sections(md, level), sectionByTitle, htmlTables, tableAfterCaption('**Caption**'), cleanText, num, applyOverrides, writeData (validates)
- `scripts/srd/import-core.ts` — conditions + rules tables (`npm run srd:import`)
- `scripts/srd/import-equipment.ts` — weapons/armor/gear (in `npm run srd:import`)
- `scripts/srd/import-origins.ts` — species + backgrounds (needs equipment JSON first)
- `scripts/srd/import-feats.ts` — feats
- `scripts/srd/import-classes.ts` — classes + subclasses (needs equipment JSON)
- `scripts/srd/import-spells.ts` — spells
- `scripts/srd/import-monsters.ts` — monsters + animals
- `scripts/srd/import-magic-items.ts` — magic items
- `data/srd/overrides/` — hand fixes/mechanics merged by id into importer output
- `data/srd/rules-tables.json` — core numeric tables
- `data/srd/*.json` — SRD data arrays (complete)
- `data/srd/_source/` — fetched SRD Markdown (gitignored; `npm run srd:fetch`)
- `scripts/srd-fetch.mjs` — downloads SRD Markdown at a pinned commit
- `CREDITS.md` — SRD CC-BY-4.0 attribution + asset credits
- `src/shared/save.ts` — SaveMetaSchema, SaveFileSchema, SaveListEntry, SLOT_ID_PATTERN
- `src/engine/session/migrations.ts` — MIGRATIONS chain + migrateSave(raw) (add a step + fixture test per schema bump)
- `src/server/saveStore.ts` — SaveStore(dir): list/load/save/autosave/delete; `app.saves`; routes GET/PUT/DELETE /api/saves[/:slot]
- `Setup.bat` / `Start Game.bat` — CRLF launchers → scripts/check-deps.mjs --setup / --start
- `scripts/check-deps.mjs` — dependency checks/installs; `scripts/check-deps-lib.mjs` — pure helpers (tested)
- `src/server/port.ts` — DEFAULT_PORT 3210
- `src/server/services.ts` — Services(settings, rootDir, overrides): llm, tts, status(); exposed as `app.services`
- `src/shared/status.ts` — SystemStatus type + llmIndicator/ttsIndicator/memoryIndicator
- `src/client/ui/StatusIndicator.tsx` — polls /api/status every 10 s; corner lights
- `src/llm/types.ts` — LlmProvider, ChatMessage, ChatOptions (task, format, keepAlive, timeoutMs), LlmStatus, LlmError(kind)
- `src/llm/ollama.ts` — OllamaClient(config incl. fetch); supportsThinkFlag
- `src/llm/mock.ts` — MockLlm({script, handlers, streamDelayMs}); `.calls` records every call
- `src/llm/structured.ts` — callStructured({provider, messages, schema, fallback, task}) → {value, ok, attempts, error}; extractJson, parseReply, toOllamaSchema
- `src/tts/types.ts` — TtsProvider (synthesize→WAV bytes, listVoices, status), TtsError(kind)
- `src/tts/piper.ts` — PiperTts({piperPath, voiceDir, defaultVoice, spawn?, fs?})
- `src/tts/mock.ts` — MockTts(voices?, failWith?)
- `src/tts/wav.ts` — pcm16ToWav, wavDurationSeconds
- `src/tts/provider.ts` — createTtsProvider(settings.tts, rootDir, useMock)
- `src/llm/provider.ts` — createLlmProvider(settings.llm)
- `src/shared/version.ts` — GAME_TITLE, GAME_VERSION, SAVE_SCHEMA_VERSION
- `.gitattributes` — *.bat forced to CRLF
- Still-empty planned folders (.gitkeep): engine/{character,combat,world,adventure,party,appearance,systems}, client/{three,audio}, data/{world,adventures,tables}, assets/

## Gotchas & Lessons
- git core.autocrlf=true on this machine. The .bat launchers must stay CRLF; `.gitattributes` forces `*.bat` to CRLF (done). LF→CRLF warnings on `git add` are harmless.
- Tests needing exact dice: use a fixed-face Rng stub (see `fixed()` in dice.test.ts).
- The SRD Markdown source looked corrupted once, but that was two files' output concatenated in one shell command. Known real glitch: Typical DC table misses the Medium row. Still validate importer output and fix via overrides.
- SRD Markdown format: spells are `#### Name` + `_Level 3 Evocation (Sorcerer, Wizard)_` + `**Casting Time:**` lines; monsters are `### Name` + `_Size Type (Tag), Alignment_` + `**AC** 15 **Initiative** +2 (12)` + an HTML <table> of STR..CHA (score, MOD, SAVE) + `#### Actions` with `**_Name._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Slashing damage`. Tables are HTML (<tr><td>).
- Class feature tables in classes.md have captions `**<Class> Features**`; spellcasters have a 2-row header (slot levels in row 2) → skip 2 rows.
- Editing regexes with sed/python heredocs mangles backslashes; use the Edit tool for code containing regex escapes.
- Spells source: a few spells use `**Component:**` (singular) instead of `**Components:**`.
- monsters-A-Z.md uses `### Name` + `#### Actions`; animals.md uses `## Name` + `### Actions`. Ability tables sometimes merge cells ("10 +0") → parse rows as token streams.
- TS strict + zod: a fallback lambda's return type widens enums to string; annotate it (`(e): T => ...`).
- In .bat files escape `&` as `^&` (even in `title`). Edit .bat files with python (read bytes, normalize to CRLF); Git Bash `sed -i` mangles CRLF.
- Testing .bat from the PowerShell tool: native commands don't follow Push-Location; call `cmd /c "`"<absolute path>`""`. To dry-run Start Game.bat, copy it with `call npm start` replaced by an echo.
- npm 11 blocks install scripts by default (`allow-scripts` warning for esbuild). Ignore it: tsx/vite work via esbuild's optional platform package. Don't run approve-scripts unless something breaks.
- To smoke-test the server: `PORT=3299 npx tsx src/server/main.ts &`, curl, then kill the PID from `netstat -ano | grep :3299` with `taskkill //PID <pid> //F` (Git Bash needs `//`).
- Ollama client unverified against a real server (not installed yet); A010 should confirm `think:false` is accepted and structured `format` schemas work.
- The dev PC has 32 GB RAM, but the TARGET is 8 GB: keep budgets per spec §1; don't rely on local headroom.
- Running the server from the project root creates `userdata/` (gitignored). Tests use temp dirs.
- Node v26.3.0, npm 11.16.0, git 2.53 are installed. Ollama is not installed yet (2026-09-29).

## Blockers / Owner Review
<!-- Blockers: what's wrong + the exact fix the owner should apply. Owner Review: non-urgent decisions the owner may want to revisit. -->
- BLOCKER (A010): Ollama not installed (checked 2026-09-29). Fix: install from https://ollama.com/download (or run Setup.bat, which offers winget), then set A010 back to todo. Everything else proceeds with the mock.
- Owner Review: default model qwen3:4b is provisional until A010 benchmarks it.
