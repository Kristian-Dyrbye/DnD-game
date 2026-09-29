# brain.md: Persistent Memory

> This is the only memory carried between sessions. Read it fully at the start of every session. Update it at the end of every session. Keep it under about 400 lines.

## Status
- **State:** IN PROGRESS
- **Current phase:** 4 (Phase 3 Character Creation done)
- **Last completed assignment:** A050
- **Notes for next session:** Start with A051 (adventure schema + scene runner; plug in via GameSession ActionPort), then A052 (main screen layout). Phase 2 engine is complete except zone spells (A064a). A100 (campaign design bible) is with a helper — merge its branch when it reports. A010 is blocked on Ollama: if `ollama --version` works now, set A010 to todo and do it first. Ollama is NOT installed yet (the owner is installing it); use the mock LLM. 

## Assignment Queue
<!-- Compact format (one item per line, to keep brain.md small):
- [status] A<id> — Title | Spec: §x | Done: testable criteria | Dep: A<id>
Status values: todo | in-progress | done | failed | blocked
Every assignment's Done also implicitly includes: `npm run typecheck` + `npm test` pass (and `npm run build` if it touches the client). -->

### Phase 0 — Bootstrap
- [done] A000

### Phase 1 — Foundation
- [done] A001, A002, A003, A004, A005, A006, A007, A008, A009
- [blocked] A010 — Pick & benchmark LLM (needs Ollama) | Spec: §2, §3 | Done: scripts/bench-llm.mjs tests JSON validity + speed for qwen3:4b vs llama3.2:3b (+ any newer 3–4B); result in Decisions Log; README note on swapping models | Dep: A005, owner installs Ollama

### Phase 2 — Rules Engine
- [done] A011, A012, A013, A014, A015, A016, A017, A018, A019, A020, A021, A022, A023, A024, A025, A026, A027, A028, A029, A030, A031, A032, A033, A034, A034a, A035, A036, A037, A038, A039, A039b, A039c, A040, A041, A042

### Phase 3 — Character Creation
- [done] A042a, A042b, A034c, A042c, A043, A044, A045, A046, A046b, A047, A048, A049, A050

### Phase 4 — Narration Loop
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
- [todo] A064a — Zone spell hooks | Spec: §4, §10 | Done: persistent zones on the grid: spirit_guardians, moonbeam, web, entangle, black_tentacles, wall_of_fire, call_lightning, flaming_sphere, spiritual_weapon, ice_storm terrain; triggers (enter/start turn), once-per-turn; tests | Dep: A064, A042a
- [todo] A065 — 2D token battle map UI | Spec: §10, §14 | Done: canvas grid, tokens, reachable highlight, turn tracker, action bar, AoE preview, combat log | Dep: A063, A064, A052
- [todo] A066 — Enemy AI | Spec: §10 | Done: deterministic targeting, ability use, morale/flee; tests | Dep: A063, A042
- [todo] A067 — Companion AI | Spec: §6 | Done: role-aware tactics (heal, keep distance, protect); tests | Dep: A066
- [todo] A068 — Combat ↔ story integration | Spec: §9, §10 | Done: encounter start from scene, win/lose/flee outcomes, XP, pre-combat autosave, Heroic defeat outcomes, Hardcore death + new hero in same world; tests | Dep: A067, A051, A008
- [todo] A069 — Async combat narration | Spec: §10 | Done: narration never blocks; frequency setting (every/key/off); tests | Dep: A068, A057
- [todo] A070 — 3D battle map | Spec: §10, §12 | Done: three.js grid with models, orbit/zoom camera, 2D/3D toggle | Dep: A065, A049

### Phase 6 — Exploration
- [done] A071
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
- [done] A094
- [todo] A095 — Music + SFX manager | Spec: §13 | Done: mood crossfade, SFX hooks (dice, hits, spells, UI, doors, steps), volumes | Dep: A094, A052
- [done] A096
- [todo] A097 — TTS narration pipeline | Spec: §13 | Done: background generation queue, skip, volume, toggle, never blocks; tests with MockTts | Dep: A096, A057

### Phase 11 — Content
- [todo] A098 — Starter arc part 1 | Spec: §7.2 | Done: exploration, dialogue, skill-check tutorial scenes (valid schema) | Dep: A078, A084
- [todo] A099 — Starter arc part 2 | Spec: §7.2, §9 | Done: combat, rest, shop, companion, world map, hook, defeat outcomes | Dep: A098
- [in-progress (helper)] A100 — Campaign arc design | Spec: §7.2 | Done: villain, factions, flag plan, chapter outlines, 2+ endings (in data/adventures/arc1/README or JSON) | Dep: A099
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
- Phase 2 part 2 + helpers (A029–A038, A034a, A071): d20Test core + checks/saves/passive/contest; attacks (crit/nat 1), damage rolls, defenses, temp HP; conditions engine from data modifiers (+ exhaustion); death saves, 0 HP, short/long rests; effect executor (shared damage, half on save, spell attacks, heal/upcast, conditions, hooks); spellcasting (slot tables incl. multiclass + pact, casting, rituals, cantrip scaling, concentration); character builder + derived stats (AC, speed, weapon attacks, HP) + inventory; leveling + feats; multiclassing; active effects + weapon masteries. Helpers: world lore (Orrimar: Aurelmark/Gloamfen/Brinescatter, Hollow Choir cult, start town Millbrook); 54 hand-written spell effects/hooks. See File Map for modules.
- Phase 2 part 3 + helpers (A039–A042a, A048, A094): class feature framework (FeatureImpl hooks + registry/queries) with key features for all 12 classes + SRD subclasses, Wild Shape; monster runtime (stat block → creature, recharge, multiattack, action effects) + encounter builder (2024 XP budgets); spell buff/debuff hooks as active effects + queries. Helpers: CC0 3D models (assets/manifest.json, 52 MB) and CC0 audio (assets/audio-manifest.json, 47 MB) with fetch scripts run by Setup. Details: File Map + Decisions.
- Phase 4 (A050): GameSession + WebSocket protocol + client socket signals — src/engine/session/{gameState,GameSession}.ts, src/shared/protocol.ts, src/client/net/gameSocket.ts, /ws in src/server/app.ts.
- Phase 2 tail + Phase 3 (A042a–c, A034c, A043–A049, A096 helpers): spell hooks (buffs/debuffs, projectiles/control, batch 3 riders + ~35 query helpers combat must call), spell audit (171 overrides), Eldritch Blast beams; character creator end to end (state machine, class/background/species/abilities (3 methods)/skills+class options/equipment/spells/appearance/identity+AI backstory/difficulty/review, Quick Build for all classes, `#creator` / `#quickbuild-<class>` test URLs); 3D preview (KayKit parts, head swap, skin recolour, tint, auto-frame); Piper voices (public-domain LibriVox, narrator en_GB-cori-medium); origin feat picks (A046b: Magic Initiate list/cantrips/spell/ability, Skilled) in creator + builder. See File Map + Decisions.



















## Decisions Log
- A050: One GameSession per server (single player); all sockets get its events; commands run serially via a promise queue. Hero is built client-side and sent in `new_game` (validated by CharacterSchema) — fine for a local single-player game. GameState keeps per-system data in `extensions[systemId]`. Session never throws: errors become `error` events. new_game autosaves immediately. Placeholder ActionPort logs "story engine not connected" until A051/A053. Rng.getState now returns unsigned values (states compare equal after save/load).
<!-- Choice — alternatives considered — why. Never delete; summarize if long. -->
- Infra decisions (A001–A012, condensed): TS 7 native tsc, Vite 8, Vitest 5, Preact 10; strict tsconfig w/ noUncheckedIndexedAccess + verbatimModuleSyntax, bundler resolution (no .js suffixes); server = tsx, 127.0.0.1:3210 (PORT env), opens browser itself (OPEN_BROWSER=1); zod 4 (.prefault({}) for nested defaults); settings in userdata/settings.json (salvage bad fields); LLM via injectable fetch, think:false only for reasoning models, keep_alive idle/60m, every call tagged with `task`; structured calls retry once (not when unreachable) then typed fallback; Piper spawned per utterance (--output_raw → WAV); providers in app.services (rebuilt on settings change); saves = {schemaVersion, meta, state} + migration chain, 3 rotating autosaves, slot-id regex; check-deps.mjs plain JS (DEFAULT_MODEL/GAME_PORT synced by test), allowScripts esbuild:false; RNG sfc32+cyrb128 (state in saves); math line format `d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success` with real minus sign; snake_case ids; Creature = current state, static data by id; exhaustion numeric; hit dice per die size.
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
- A030: Creature updates are pure (return new creature + report). Resist and vulnerable on the same type: halve then double. Massive damage flag = overflow ≥ max HP after hitting 0; death/unconscious handling is A032.
- Owner decision (2026-09-29): max 2 agents at once (main + 1 helper subagent in its own worktree, separate assignment, main merges + updates brain.md). CLAUDE.md §2, .claude/settings.json deny list and run-loop.bat prompt updated.
- A031: Condition functions take an optional ConditionTable (defaults to loadSrd().conditions). Mode helpers return {advantage[], disadvantage[], autoFail?} that spread straight into check/save options. Frightened 'source visible' defaults to true unless the caller says otherwise (LOS comes in A060).
- A032: Creature has `dead: boolean`. Death saves apply exhaustion (they are D20 Tests). Heroic-mode defeat is decided by the session (A068), the rules module always reports real death. Long rest also resets death saves.
- A033: EffectContext keeps a Map of creatures updated in place + a text log; targets are pre-selected (AoE geometry lives in combat/aoe). Condition sourceId convention for spells: `<casterId>:<spellId>` so ending concentration removes them. Durations: 1 minute = 10 rounds.
- A071: Starting location = Millbrook (tag `starting_location`, Aurelmark). Routes stored once (undirected). Faction defaultReputation 0 except Hollow Choir −60, Lantern Wardens −10. region.mapBounds boxes contain their locations.
- A034: Spell condition source id = `<casterId>:<spellId>`. castSpell hooks concentrationCheck into EffectContext.onDamaged. Third-casters supported in math (floor(level/3)) though no SRD class uses it.
- A035: Weapons/armor are stored one inventory entry per item (so each can be equipped); other items stack. Generic choice tags resolve via input.choiceItems or DEFAULT_CHOICE_ITEM (holy_symbol→amulet, gaming_set→dice_set, instrument→lute). Fighting style feats go into featIds. Level > 1 builds use fixed average HP (no ASIs/features; leveling = A036).
- A034a: Spell hook convention: `{kind:'hook', hook:'<spell_id>', params:{…}}`, params carry only what sibling core effects don't. Edit data/srd/overrides/spells.json directly, then `npx tsx scripts/srd/import-spells.ts`.
- A038: Temporary rules effects (mastery riders, and later spell buffs A042a) live in `creature.effects` (ActiveEffect). Combat must call onTurnEvent(start/end of each turn), consumeAttackEffects after each attack roll, and add attackEffectModes to attack modes. Effect ids are per-creature (`sap-1`), save-safe.
- A039: Class features = FeatureImpl objects (features/<class>.ts) keyed by (owner class/subclass id, feature id matching classes.json). A test asserts every impl id exists in the data. Resources come from features (syncResources keeps current values). Rage = active effect 'rage' (100 rounds; combat must end it early if not extended, unless Persistent Rage). Reckless = effect until start of own next turn. Resource 'shortRestRegain' for partial short-rest recovery (Rage +1). Retaliation/Intimidating Presence/Countercharm/Magical Secrets/Peerless Skill/Superior Inspiration not automated yet (combat/UI).
- A039b: Class option choices live in character.choices (divine_order, blessed_strikes, primal_order, elemental_fury, primal_strike_type, land). The session must pass spellOptions(c, db, spell, slot) into castSpell. Feature actions take params {rng, target, targets, choice}.
- A048: KayKit characters share one rig (76 animations) with swappable head/body/arm/leg meshes, toggleable helmet/hat/cape/shield meshes and hand-slot bones → equipment attach (A088). Quaternius models differ in scale: size by bounding box. Quaternius's newer packs use a non-CC0 license (QAL, 2026-08-28) — don't add new Quaternius packs without checking. Upgrade option: Quaternius Universal Base Characters (itch.io manual download) for deeper appearance customization.
- A040: Permanent class traits can be stored as effects without expiry (Evasion = effect 'evasion', read by effects.ts). Aura features are helpers taking a distance (combat supplies positions). Combat must use featureWeaponAttack(c, db, weaponAttack(...)) and critOn(c, db). Not automated yet: Horde Breaker extra attack, Defensive Tactics, Abjure Foes, Divine Sense, Relentless Hunter concentration immunity (helper exists), Acrobatic Movement, Self-Restoration, Perfect Focus, Quivering Palm, Holy Nimbus/Smite of Protection — add to A042a follow-up if needed.
- A041: Call spellOptions(c, db, spellInfo(spell, classId), slotLevel) and spread into castSpell; Sculpt Spells ids go in castSpell.sculptTargetIds. Not automated yet: Cunning Action (combat), Elusive, Supreme Sneak/Use Magic Device/Thief's Reflexes, most Metamagic effects (costs only), invocations other than Agonizing Blast, Mystic Arcanum, Contact Patron, Memorize Spell/Spell Mastery/Signature Spells, Overchannel, Hurl Through Hell, Dragon Wings/Companion.
- A042: Monsters keep printed save/skill totals in creature.saveBonuses/skillBonuses (checks.ts uses them first). Encounter XP uses no group multiplier (2024). Monster attack effects need ctx.attackBonus = action.attack.bonus.
- A039c: Combat must use wildShapeCombatant(c, db) as the druid's combat creature and route attacks through the beast's stat block (statBlockId). Nature Magician (Archdruid) not automated.
- A042a: Spell buffs = ActiveEffects keyed by spell id (slow spell = 'slow_spell', guiding bolt target = 'guided'), sourceId `<caster>:<spell>`, data = hook params. Combat must: use effectiveAc(c, wearingArmor); add rollEffectBonuses to attacks/saves; spread effectSaveAdjustments; add attackedEffectModes + consumeAttackedEffects; add effectDamageRiders on hits; call startOfTurnEffects; call revertExpiredEffects for expired effects; breakInvisibility on attack/cast. Haste lethargy on end and Slow repeat saves not automated yet.
- A042b: castSpell options choice/allocations feed hooks. Combat must call endOfTurnSpellEffects(c, rng) before end-of-turn expiry, and treat 'counterspelled' / 'commanded' / 'hypnotized' (ends on damage) effects. Chain Lightning/Meteor Swarm/Ice Knife burst rely on the caller passing all affected targets.
- A043: Client imports loadSrd() directly (SRD bundled into the JS, 1.5 MB / 337 KB gz); code-split in A112. UI state = Preact signals in src/client/ui/state.ts. Class blurbs are original game text in classInfo.ts. Creator step components register in Creator.tsx STEP_COMPONENTS (placeholders until built).
- A034c: hold_person/hold_monster hooks are top-level siblings with params.appliesIfCondition (hook must check the condition). Cantrips with hooks marked noDiceScaling are not dice-multiplied; beamsByLevel hooks fire one attack per beam (allocations or round-robin). beacon_of_hope has a stray `save: 'wis'` hint (harmless).
- A046: Creator stores weapon masteries in state.weaponMasteries, rogue expertise in state.expertise, all other class picks in state.choices[key] (fighting_style, divine_order, primal_order, eldritch_invocation, tool_proficiencies).
- A096: Lessac (old default narrator) and voices fine-tuned from it are research-only → not shipped. ryan/hfc voices are CC BY-NC-SA → rejected. Only public-domain voices are used.
- A047: Heroic is the default difficulty. The hero is stored client-side in `hero` until the GameSession exists (A050 moves it to the server). Backstory homeland hint = Millbrook (starting town).
- A049: Weapons/shields in the KayKit files are hidden for now (A088 equipment attach will show the right ones). Skin recolour is a heuristic (warm mid-saturation pixels) on a copy of the texture atlas — revisit if it tints leather. Client bundle is now 2.3 MB (521 KB gz) with three.js + SRD data (code-split in A112).
- A042c: Combat (A062/A063) must integrate the spellHooks3 query helpers (AC = max(effectiveAc, minAcFromEffects) + extraAcFromEffects; pass effectResistances/effectResistsAll into applyDamage; check canRegainHp before heals; mirror image/sanctuary on targeting; death ward after 0 HP; resetOncePerTurnEffects each turn). effects.ts dealDamage does not yet read spell resistances.
- A046b: Origin-feat picks live in creator choices under feat_bg_* / feat_sp_* keys → toBuildInput → `originFeatChoices` (builder). Background Magic Initiate list comes from bg.featOption (source:'background'). Feat spells are tagged classId `feat:magic_initiate:<list>`; ability stored in character.choices[`magic_initiate_ability:<list>`]; non-casters get a spellcasting block with 0 slots. Feat-granted level 1 spell is once per long rest free — casting code (A062/A066) must honour that (not tracked yet). Versatile list excludes the background's feat (no double Magic Initiate). Skilled offers skills only (no tools) in the UI.
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
- `src/client/three/` — loader.ts (GLTF cache, outfit files/mesh names), characterModel.ts (buildCharacterModel), CharacterPreview.tsx
- `src/client/` — index.html, main.tsx, styles.css, data.ts (db), ui/App.tsx (screens), ui/state.ts (signals), ui/creator/ (Creator shell + step components)
- `src/server/app.ts` — buildApp(opts): Fastify app factory (REST, /ws, static). Tests use inject()/injectWS()
- `src/server/main.ts` — entry; serves dist/client on 127.0.0.1:3210
- `src/shared/settings.ts` — SettingsSchema (llm, tts, audio, performance, accessibility, gameplay), defaultSettings, mergeSettings
- `src/server/settingsStore.ts` — SettingsStore(userDataDir): get/update, persisted to settings.json; exposed as `app.settings`
- `src/engine/core/rng.ts` — Rng.fromSeed, next/int/pick/shuffle, getState/setState
- `src/engine/core/dice.ts` — parseDice, roll, formatRoll, diceStats, resolveRollMode, rollD20, formatD20Test
- `src/engine/rules/basics.ts` — ABILITIES, SKILL_ABILITY, DAMAGE_TYPES, SIZES, CREATURE_TYPES, CONDITIONS (+ zod enums); abilityModifier, proficiencyBonus(ForCR), proficiencyContribution, parseCR/formatCR, formatModifier, sizeSquares
- `src/engine/core/creature.ts` — CreatureSchema, CharacterSchema, CombatantSchema, ActiveCondition, Resource, totalLevel
- `src/engine/rules/checks.ts` — d20Test (shared core), abilityCheck, skillCheck, savingThrow, checkModifiers, saveModifiers, passiveScore, contest
- `src/engine/rules/damage.ts` — attackRoll, rollDamage, doubleDice, adjustForDefenses, applyDamage, heal, grantTempHp, isBloodied
- `src/engine/rules/conditions.ts` — effectiveConditions, hasCondition, applyCondition, removeCondition(+FromSource), addExhaustion, tickConditions, endOfTurnSaves, attackModes, checkModes, saveModes, initiativeModes, canAct, effectiveSpeed, isCrawlOnly, resistsAllDamage, mayHarm
- `src/engine/rules/death.ts` — resolveDamageAtZero, rollDeathSave, stabilize, healFromZero, needsDeathSave
- `src/engine/rules/rest.ts` — shortRest, longRest, rechargeResources, hitDicePool, restoreCreature
- `src/engine/rules/effects.ts` — createEffectContext, executeEffects, upcastDice, durationRounds (HookFn registry)
- `src/engine/world/lore.ts` + `data/world/lore.json` — world lore schema/data + lookup helpers (MAP_WIDTH/HEIGHT, WEATHER_KINDS, SEASONS...)
- `src/engine/rules/spellcasting.ts` — spellSlots, pactSlots, spellSaveDc, spellAttackBonus, cantripMultiplier, scaleCantripEffects, slotProblem, expendSlot, recoverSlots, castSpell, concentrationCheck, endConcentration
- `src/engine/character/builder.ts` — CharacterBuildInput, validateBuild, buildCharacter, autoEquip
- `src/engine/character/derived.ts` — armorClass, baseSpeed, isProficientWith, weaponAttack, unarmedStrike, maxHitPoints, initiativeModifiers, classLevel, equipped
- `src/engine/character/leveling.ts` — levelForXp, canLevelUp, featureLevels, featuresAtLevel, pendingChoices, featProblems, applyFeat, levelUp, recompute
- `src/engine/character/multiclass.ts` — multiclassProblems, multiclassGains, addClass, attacksPerAction
- `src/engine/rules/activeEffects.ts` — addEffect, hasEffect, removeEffects, onTurnEvent, tickEffects, attackEffectModes, consumeAttackEffects, effectSpeedPenalty
- `src/engine/rules/mastery.ts` — applyMasteryOnHit, grazeDamage, cleaveDamageModifier
- `src/engine/character/features/` — types.ts (FeatureImpl, SpellInfo), index.ts (ALL_FEATURES, activeFeatures, feature*Modes/Bonuses, featureResistances, weaponHitRiders, critOn, featureWeaponAttack, spellOptions/spellInfo, syncResources, applyOnGain/OnLevelUp, featureActions, useFeatureAction), one file per class group (barbarian, bard, cleric, druid, fighter, monk, paladin, ranger, rogue, casters)
- `assets/manifest.json` + `scripts/assets-fetch.mjs` — 3D model packs, roles, monster stand-ins; models land in assets/models/ (gitignored)
- `src/engine/rules/monsters.ts` — monsterToCreature, actionAvailable, spendAction, rollRecharges, multiattackSequence, actionEffects, actionRange
- `src/engine/adventure/encounters.ts` — xpBudget, encounterXp, rateEncounter, buildEncounter
- `assets/voices-manifest.json` + `scripts/voices-fetch.mjs` — Piper binary + voices (tools/piper, assets/voices; gitignored)
- `assets/audio-manifest.json` + `scripts/audio-fetch.mjs` — music moods, ambience, sfx; files land in assets/audio/ (gitignored)
- `src/engine/rules/spellHooks.ts` — SPELL_HOOKS + buff/debuff queries (see A042a); `spellHooks2.ts` — SPELL_HOOKS_2, endOfTurnSpellEffects, curseDamageRider
- `src/engine/character/creator.ts` — CreatorState + step machine
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
- `src/shared/protocol.ts` — ClientCommandSchema (ping/new_game/get_state/say/choose/save/load), ServerEvent union, parseCommand
- `src/engine/session/gameState.ts` — GameStateSchema (hero, companions, location, time, flags, log, summary, rolls, extensions), LOG_LIMIT/ROLL_LIMIT
- `src/engine/session/GameSession.ts` — GameSession (handle/on/emit, addLog/addRoll/suggest, autosave, snapshot) + SavePort/ActionPort + newGameState
- `src/client/net/gameSocket.ts` — client WebSocket (reconnect, outbox) + signals (gameState, storyLog, rollHistory, suggestions, streaming) + applyEvent
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
- Bash heredocs containing many quotes/backticks (TS test files) can fail with "unexpected EOF" and write nothing — use the Write tool for TS files.
- Server tests that open /ws must pass a temp `savesDir` (new_game autosaves; default is <cwd>/saves).
- git core.autocrlf=true on this machine. The .bat launchers must stay CRLF; `.gitattributes` forces `*.bat` to CRLF (done). LF→CRLF warnings on `git add` are harmless.
- Tests needing exact dice: use a fixed-face Rng stub (see `fixed()` in dice.test.ts).
- The SRD Markdown source looked corrupted once, but that was two files' output concatenated in one shell command. Known real glitch: Typical DC table misses the Medium row. Still validate importer output and fix via overrides.
- SRD Markdown format: spells are `#### Name` + `_Level 3 Evocation (Sorcerer, Wizard)_` + `**Casting Time:**` lines; monsters are `### Name` + `_Size Type (Tag), Alignment_` + `**AC** 15 **Initiative** +2 (12)` + an HTML <table> of STR..CHA (score, MOD, SAVE) + `#### Actions` with `**_Name._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Slashing damage`. Tables are HTML (<tr><td>).
- Class feature tables in classes.md have captions `**<Class> Features**`; spellcasters have a 2-row header (slot levels in row 2) → skip 2 rows.
- Editing regexes with sed/python heredocs mangles backslashes; use the Edit tool for code containing regex escapes.
- Spells source: a few spells use `**Component:**` (singular) instead of `**Components:**`.
- monsters-A-Z.md uses `### Name` + `#### Actions`; animals.md uses `## Name` + `### Actions`. Ability tables sometimes merge cells ("10 +0") → parse rows as token streams.
- Downloaded asset packs: assets/_packs/ and assets/models/ are gitignored (fetched by scripts/assets-fetch.mjs, A048).
- Helper agents' worktrees live in `.claude/worktrees/` (gitignored). Never `git add` them.
- TS strict + zod: a fallback lambda's return type widens enums to string; annotate it (`(e): T => ...`).
- In .bat files escape `&` as `^&` (even in `title`). Edit .bat files with python (read bytes, normalize to CRLF); Git Bash `sed -i` mangles CRLF.
- Never add `2>/dev/null` to `git add` with a path list: one missing/deleted path makes the whole add fail silently. Check `git status` after committing.
- Headless WebGL screenshots work with `--use-angle=swiftshader --enable-unsafe-swiftshader` and `--virtual-time-budget=8000`.
- UI screenshots: build, run the server on a spare port, then `msedge.exe --headless=new --disable-gpu --window-size=1400,900 --virtual-time-budget=4000 --screenshot=<png> "http://127.0.0.1:<port>/#creator"` and Read the PNG.
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
- Owner Review: listen to the downloaded music/SFX (assets/audio after `node scripts/audio-fetch.mjs`) and flag tracks to swap — they were chosen by metadata only.
- Owner Review: default model qwen3:4b is provisional until A010 benchmarks it.
