# brain.md: Persistent Memory

> This is the only memory carried between sessions. Read it fully at the start of every session. Update it at the end of every session. Keep it under about 400 lines.

## Status
- **State:** IN PROGRESS
- **Current phase:** 1 (Foundation)
- **Last completed assignment:** A005
- **Notes for next session:** Start with A006. Ollama is NOT installed yet (the owner is installing it); use the mock LLM. A010 needs Ollama: if `ollama` is still missing, mark it blocked and skip it.

## Assignment Queue
<!-- Compact format (one item per line, to keep brain.md small):
- [status] A<id> — Title | Spec: §x | Done: testable criteria | Dep: A<id>
Status values: todo | in-progress | done | failed | blocked
Every assignment's Done also implicitly includes: `npm run typecheck` + `npm test` pass (and `npm run build` if it touches the client). -->

### Phase 0 — Bootstrap
- [done] A000 — Plan the whole build | Spec: all | Done: git, .gitignore, ARCHITECTURE.md, queue, file map | Dep: none

### Phase 1 — Foundation
- [done] A001 — Project scaffold | Spec: §2, §17 | Done: package.json (scripts dev/build/test/typecheck), tsconfig strict, Vite+Preact client "hello" page, Vitest with 1 passing test, folder skeleton per ARCHITECTURE.md; build passes | Dep: A000
- [done] A002 — Fastify server | Spec: §1, §2 | Done: serves built client, GET /api/health, WebSocket /ws echo, Vite dev proxy; route tests via fastify.inject | Dep: A001
- [done] A003 — Settings/config system | Spec: §14, §2 | Done: zod settings schema (model name, LLM params, volumes, perf preset, accessibility, objectiveHint=false), defaults + userdata/settings.json load/save, GET/PUT /api/settings; tests | Dep: A002
- [done] A004 — LLM provider + Ollama client + mock | Spec: §2, §3, §17 | Done: LlmProvider interface (chat, stream, json, listModels, status); Ollama client over fetch; deterministic MockLlm (scripted responses); tests with mocked fetch | Dep: A001
- [done] A005 — Structured JSON helper | Spec: §3 | Done: llm/structured.ts: schema→Ollama format, zod validate, 1 retry, typed fallback, never throws; tests for bad JSON/timeouts | Dep: A004
- [todo] A006 — TTS provider + Piper adapter + mock | Spec: §2, §13 | Done: TtsProvider interface, Piper spawn adapter (path from settings), MockTts, status check; tests with mock | Dep: A001
- [todo] A007 — Status endpoint + indicator | Spec: §14, §17 | Done: GET /api/status (ollama up, model loaded, tts ready, RSS memory); small UI indicator; tests | Dep: A003, A004, A006
- [todo] A008 — Save system + migrations | Spec: §2, §9, §17 | Done: save/load/list/delete slots + autosave slot, meta (time, location, level, thumbnail, mode), migration chain with a sample v0→v1 fixture; REST routes; tests | Dep: A002
- [todo] A009 — Setup.bat + Start Game.bat | Spec: §1 | Done: CRLF .bat files + scripts/check-deps.mjs (Node, npm install, build, Ollama present/running, model pulled) with friendly messages; Start opens browser; runs clean with Ollama missing (warns, mock mode) | Dep: A002, A003
- [todo] A010 — Pick & benchmark LLM (needs Ollama) | Spec: §2, §3 | Done: scripts/bench-llm.mjs tests JSON validity + speed for qwen3:4b vs llama3.2:3b (+ any newer 3–4B); result in Decisions Log; README note on swapping models | Dep: A005, owner installs Ollama

### Phase 2 — Rules Engine
- [todo] A011 — RNG + dice | Spec: §4, §8 | Done: seeded serializable RNG, dice notation parser (NdX+M, kh/kl), adv/dis, roll result with math string; tests | Dep: A001
- [todo] A012 — Core rule types | Spec: §4 | Done: abilities/mods, proficiency by level, skills, damage types, sizes, Creature/Character/Combatant types; tests | Dep: A011
- [todo] A013 — SRD 5.2 data pipeline + schemas | Spec: §4 | Done: decide source (official SRD 5.2 CC-BY-4.0 PDF → scripts/srd-extract, or CC-BY JSON source) and log it; zod schemas for every data/srd file; loader + validator test; CREDITS.md with SRD attribution | Dep: A012
- [todo] A014 — SRD data: conditions, exhaustion, core tables | Spec: §4 | Done: conditions.json, rules tables (XP/level, proficiency, spell slots full/half/third/pact, multiclass slots, encounter XP budgets, DC guide); validated + spot tests | Dep: A013
- [todo] A015 — SRD data: equipment | Spec: §4, §11.5 | Done: weapons (with mastery), armor, gear, tools, packs, prices; validated | Dep: A013
- [todo] A016 — SRD data: species + backgrounds | Spec: §4, §5 | Done: all SRD species and backgrounds (ASI options, origin feat, skills, tools, equipment); validated | Dep: A013
- [todo] A017 — SRD data: feats + epic boons | Spec: §4 | Done: origin, general, fighting style, epic boon feats with prereqs and effect refs; validated | Dep: A013
- [todo] A018 — SRD data: classes part 1 (Barbarian, Bard, Cleric, Druid) | Spec: §4 | Done: class tables 1–20, features, SRD subclass each; validated | Dep: A013
- [todo] A019 — SRD data: classes part 2 (Fighter, Monk, Paladin, Ranger) | Spec: §4 | Done: as A018 | Dep: A018
- [todo] A020 — SRD data: classes part 3 (Rogue, Sorcerer, Warlock, Wizard) | Spec: §4 | Done: as A018 | Dep: A018
- [todo] A021 — SRD data: spells cantrip–2 | Spec: §4 | Done: all SRD spells of these levels with effect data (damage, save, area, duration, conc, ritual, upcast); validated | Dep: A013
- [todo] A022 — SRD data: spells 3–5 | Spec: §4 | Done: as A021 | Dep: A021
- [todo] A023 — SRD data: spells 6–9 | Spec: §4 | Done: as A021 | Dep: A021
- [todo] A024 — SRD data: monsters A–F | Spec: §4 | Done: stat blocks (actions, multiattack, recharge, legendary, traits) validated | Dep: A013
- [todo] A025 — SRD data: monsters G–M | Spec: §4 | Done: as A024 | Dep: A024
- [todo] A026 — SRD data: monsters N–S | Spec: §4 | Done: as A024 | Dep: A024
- [todo] A027 — SRD data: monsters T–Z | Spec: §4 | Done: as A024 | Dep: A024
- [todo] A028 — SRD data: magic items | Spec: §4, §11.5 | Done: all SRD magic items with rarity, attunement, effect refs; validated (split if too big) | Dep: A013
- [todo] A029 — Ability checks & saves | Spec: §4, §8 | Done: checks/saves with proficiency, expertise, adv/dis sources, DC, math string; tests | Dep: A012
- [todo] A030 — Attacks & damage | Spec: §4 | Done: to-hit, nat 20/1, crit dice, resist/vuln/immune, temp HP, damage application; tests | Dep: A029
- [todo] A031 — Conditions engine + exhaustion 2024 | Spec: §4 | Done: apply/remove/duration, data-driven roll modifiers, exhaustion −2/level d20 & −5 ft speed, death at 6; tests | Dep: A014, A030
- [todo] A032 — Death saves, 0 HP, resting | Spec: §4, §9 | Done: death saves, stabilize, massive damage, healing from 0, short rest (hit dice) and long rest, generic resource recovery; tests | Dep: A031
- [todo] A033 — Effect system | Spec: §4 | Done: data-driven executor for damage/heal/condition/save/area/duration effects; tests | Dep: A031
- [todo] A034 — Spellcasting engine | Spec: §4 | Done: slots, save DC/attack, upcast, concentration (DC max(10, dmg/2)), rituals, abstract components, pact magic; tests | Dep: A033, A021
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
- A000 — Build plan, repo, architecture — `.gitignore`, `.gitattributes`, `ARCHITECTURE.md`, `brain.md`
- A001 — Scaffold: Vite+Preact client, strict TS, Vitest, folder skeleton — `package.json`, `tsconfig.json`, `vite.config.ts`, `src/client/*`, `src/shared/version.ts`
- A002 — Fastify server: /api/health, /ws JSON echo, static client + SPA fallback, Vite dev proxy — `src/server/app.ts`, `src/server/main.ts`, `src/server/app.test.ts`
- A003 — Settings: zod schema with defaults, SettingsStore (atomic write, salvages bad fields), GET/PUT /api/settings — `src/shared/settings.ts`, `src/server/settingsStore.ts`
- A004 — LLM layer: LlmProvider interface, OllamaClient (chat, NDJSON stream, tags/ps status, typed LlmError), deterministic MockLlm (script queue, per-task handlers), createLlmProvider — `src/llm/*`
- A005 — callStructured: zod schema → Ollama format, JSON extraction, 1 retry with error feedback, typed fallback, never throws — `src/llm/structured.ts`

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
- `src/llm/types.ts` — LlmProvider, ChatMessage, ChatOptions (task, format, keepAlive, timeoutMs), LlmStatus, LlmError(kind)
- `src/llm/ollama.ts` — OllamaClient(config incl. fetch); supportsThinkFlag
- `src/llm/mock.ts` — MockLlm({script, handlers, streamDelayMs}); `.calls` records every call
- `src/llm/structured.ts` — callStructured({provider, messages, schema, fallback, task}) → {value, ok, attempts, error}; extractJson, parseReply, toOllamaSchema
- `src/llm/provider.ts` — createLlmProvider(settings.llm)
- `src/shared/version.ts` — GAME_TITLE, GAME_VERSION, SAVE_SCHEMA_VERSION
- `.gitattributes` — *.bat forced to CRLF
- Planned folders (created with .gitkeep; see ARCHITECTURE.md §2): `src/engine`, `src/llm`, `src/tts`, `src/server`, `src/shared`, `src/client`, `data/srd`, `data/world`, `data/adventures`, `data/tables`, `scripts/`, `tests/`

## Gotchas & Lessons
- git core.autocrlf=true on this machine. The .bat launchers must stay CRLF; `.gitattributes` forces `*.bat` to CRLF (done). LF→CRLF warnings on `git add` are harmless.
- TS strict + zod: a fallback lambda's return type widens enums to string; annotate it (`(e): T => ...`).
- npm 11 blocks install scripts by default (`allow-scripts` warning for esbuild). Ignore it: tsx/vite work via esbuild's optional platform package. Don't run approve-scripts unless something breaks.
- To smoke-test the server: `PORT=3299 npx tsx src/server/main.ts &`, curl, then kill the PID from `netstat -ano | grep :3299` with `taskkill //PID <pid> //F` (Git Bash needs `//`).
- Ollama client unverified against a real server (not installed yet); A010 should confirm `think:false` is accepted and structured `format` schemas work.
- Node v26.3.0, npm 11.16.0, git 2.53 are installed. Ollama is not installed yet (2026-09-29).

## Blockers / Owner Review
<!-- Blockers: what's wrong + the exact fix the owner should apply. Owner Review: non-urgent decisions the owner may want to revisit. -->
- Owner Review: install Ollama for Windows (https://ollama.com/download). Then `ollama --version` should work in a new terminal. Needed for A010 and real narration; everything else uses the mock.
- Owner Review: default model qwen3:4b is provisional until A010 benchmarks it.
