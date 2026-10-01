# Campaign Design Bible: "The Hollow Crown" (Arc 2, Level 1 → 5)

> Status: **approved and queued** (owner, 2026-10-01) as Phase 17 (B001–B014 in brain.md). Nothing is built yet. It follows the conventions of `DESIGN.md` §0 and the schema in `ADVENTURE_FORMAT.md`. Flag ids here use the `arc.crown.*` namespace; shared world state stays in `world.*`.

## 0. Why a second campaign, and what it must do

- A **second New Game choice** next to "The Seven Teeth of Vashkul": a complete story that starts at level 1 and ends at level 5, playable in 4–6 sittings, in both editions and both languages.
- **Reads the first campaign's world when asked.** A new hero can start in a fresh world (defaults below) or in the world of a finished Seven Teeth save ("new hero, same world"): `world.maw_state`, `world.queen_alive`, `world.player_outlawed`, faction reputation and the four companions' fates colour NPC lines, prices and one ending beat. The plot never depends on them.
- **Shorter and sharper than arc 1.** Tier-1 play (levels 1–5) means goblins, bandits, cultists, ghouls, a hag, constructs, a wyrmling. The villain is a con, not a god.
- **Teaches nothing twice.** The starter arc already taught the systems; this arc assumes a returning player but still offers Quick Build and tips on first use (the tip system is global).

## 1. Premise, Themes and Tone

Hollow gold is turning up across Aurelmark: coins that ring true, pass every assay, and crumble to grey ash a month later. The Ironvault Consortium, whose vaults in Deepanvil Hold hold half the kingdom's gold, is quietly terrified. A doppelganger ring called **the Thousand Faces**, run by a disgraced Ironvault assayer, is forging more than coin: it is forging *people*, replacing clerks, captains and finally a Crown official, and it is buying its faces from a night hag who takes payment in memories. The end goal is the **Hollow Crown**: a forged royal regalia that will let a false monarch (or a false regent, if the Queen is dead) sign Aurelmark's debts over to the Faces.

- **Themes:** worth versus appearance; honest work (Korrath) against the easy lie (Fennick's bad side); who you are when nobody can prove it.
- **Tones by region** (lore tone profiles): Aurelmark high fantasy for Brightwater, Deepanvil and Dawnspire; Brinescatter swashbuckling for Fennick's Rest and Wreckers' Cove; Gloamfen dark fantasy for the Blightwood and the ruins of Old Vaelthorn.
- **Recurring motif:** the assay. Every chapter has one scene where the hero must prove something is real: a coin, a letter, a face, themself.

## 2. The Villain: Master Assayer Ondra Vexx and the Thousand Faces

- **Who:** Ondra Vexx, a human assayer struck from the Ironvault rolls for "an error in weight". The error was hers: she discovered the Consortium's vault was already a tenth hollow and was silenced. She bought a new face from the hag **Mother Tallow** (night hag) and built the ring to prove that worth is only ever what the ledger says.
- **Lieutenants:** **Gilt** (doppelganger, Vexx's "voice" in Deepanvil), **Captain Ferrin Salt** (bandit captain turned Red Gull deserter; launders the coin through Fennick's Rest), **Brother Pale** (cult fanatic of Vashkul who sees hollow gold as hunger made solid; links to the Choir only as a rumour, so arc 1 is not required).
- **The plan across chapters:**

| Ch | Vexx's step | What the player sees |
|---|---|---|
| 0 | Test the coin in a river town. | Hollow gold at Brightwater market; the wererat cellar mint. |
| 1 | Replace an Ironvault auditor with a Face. | A friend who is not a friend; the vault audit. |
| 2 | Launder the coin through the gambling hall; buy more faces. | Dice, boats, a sea cave, the hag's face-market. |
| 3 | Forge the Hollow Crown in the imperial foundry; crown a Face. | The Blightwood mint; the coronation that must not happen. |

- **How the player learns the truth** (6 boolean clue flags; any 3 unlock the "name Vexx" option in ch3):
  1. `arc.crown.clue_1`: the ash coin's die mark is the Ironvault's own (ch0 assay).
  2. `arc.crown.clue_2`: the wererats were paid in real gold "by a woman with two shadows" (ch0).
  3. `arc.crown.clue_3`: Auditor Hesk does not know his own daughter's name (ch1 insight).
  4. `arc.crown.clue_4`: the vault ledger shows the tenth-hollow entry in Vexx's hand (ch1).
  5. `arc.crown.clue_5`: Mother Tallow sells faces and keeps a "book of the unmade" (ch2).
  6. `arc.crown.clue_6`: the foundry's imperial seal matches the Hollow Crown's mould (ch3).
- **Possible fates** (`arc.crown.vexx_fate`): `unmasked` (exposed before the Ironvault court), `killed`, `bargained` (the hero trades her the one face she cannot forge: their own, a scar flag), `escaped`.

## 3. Starting state and cross-arc reads

**Fresh world defaults** (written by `new_game` when no earlier save is imported): `world.maw_state` = "sealed", `world.queen_alive` = true, `world.player_outlawed` = false, reputation 0 everywhere, arc 1 companions absent.

**Imported world** ("new hero, same world"): copied from the chosen finished save: `world.*`, `arc.main.*` (read only), reputation, time (+1 year), journal cleared. Effects:
- `world.queen_alive` = false → the Crown's target is **the Regent** (Dawn Lance, Ironvault or Chamberlain Hale per arc 1's ending 3); Isolde does not appear.
- `world.maw_state` = "stirring" → Brother Pale's lines reference "the voice under the fen"; one extra Blightwood encounter (`ghoul` ×2).
- `arc.main.money_trail_proven` → the Ironvault already distrusts its own books: clue 4 is handed over freely.
- `world.corwin_status` = "in_party" or "left" with `world.corwin_quest_done` → Ser Corwin cameo at Dawnspire (one conversation, no recruit).
- Reputation ≥ 50 with `ironvault_consortium` opens the vault scene without the audit check.

## 4. Chapter 0: The Hollow Coin (`arc2_ch0_hollow_coin`, Level 1 → 2, Brightwater)

- **Purpose:** hook, first companion, first fight, first assay. One sitting.
- **Scenes:**
  - `brightwater_market`: exploration. POIs: the moneychanger's stall (the coin crumbles in the hero's hand → `arc.crown.saw_ash`), the Korrath shrine (Brannoc), the mill-race gate. Shop: "Weir & Daughter" (general goods).
  - `assay_house`: dialogue. The town assayer **Mistress Dunmore** tests the coin: Investigation or Arcana DC 12 to spot the Ironvault die mark (clue 1). Conversation with ≥ 3 approaches (honest, bribe, Insight on why she is afraid).
  - `mill_cellars`: dungeon map with fog. Giant rats ×4, then `wererat` ×1 + `bandit` ×2 at the mint. Silver matters: the smith sells silvered bolts (teaches damage types without a tutorial). Deadline: the mint moves after 2 days (`arc.crown.mint_fled`).
  - `wererat_den_rest`: short rest, a captive clerk who says "a woman with two shadows" paid in true gold (clue 2). Choice: hand the wererat to the reeve (rep `crown_of_aurelmark` +5) or let it go for the name of the courier (clue 2 + `arc.crown.courier_known`).
  - `korrath_shrine_oath`: recruit **Brannoc Stonecount** (see §9). **[LEVEL 2]**.
  - `road_east`: world map; travel to Deepanvil Hold. Ending `ch0_to_deepanvil` → `next: arc2_ch1_faces`.
- **Encounters base (party of 4 at level 1; solo scaling drops minions first):** `giant_rat` ×4; `wererat` ×1, `bandit` ×2.

## 5. Chapter 1: Faces in the Ledger (`arc2_ch1_faces`, Level 2 → 3, Deepanvil Hold)

- **Purpose:** investigation and social play in a dwarven city; the first doppelganger.
- **Scenes:**
  - `deepanvil_gate`: toll and papers (Persuasion / Deception / show Dunmore's letter). Rep `ironvault_consortium` gates the price of everything in the Hold (price multiplier from lore).
  - `counting_house`: **Auditor Hesk** (replaced by a Face in the imported-world variant only if `arc.main.money_trail_proven` is false; otherwise the Face is his clerk). Insight DC 13 (clue 3). Three approaches to get at the ledgers: audit by the book (History), bribe, break in at night (Stealth, map scene).
  - `vault_audit`: the dungeon map: Ironvault's third vault, `animated_armor` ×2 guarding the hollow tenth; ledger entry in Vexx's hand (clue 4).
  - `hesk_unmasked`: the first doppelganger fight: `doppelganger` ×1 (CR 3; the scaling keeps the boss) with `guard` ×2 who believe it is Hesk until it is hurt. Non-combat route: name the daughter in public (clue 3) and it flees (`arc.crown.gilt_fled` = true, `arc.crown.gilt_exposed` stays false; the Face returns in ch3). Winning the fight sets `arc.crown.gilt_exposed` = true.
  - `ironvault_court`: outcome scene. The Consortium either hires the hero (letter of commission, −20% at Ironvault shops) or blames them (`world.player_outlawed` = true until ch3 clears it). Second companion offer: **Sister Ilse Varn** (see §9).
  - `thane_s_rest`: long rest; **[LEVEL 3]**. Ending → `next: arc2_ch2_gamblers_tide`.
- **Encounters:** `animated_armor` ×2; `doppelganger` ×1 + `guard` ×2.

## 6. Chapter 2: The Gambler's Tide (`arc2_ch2_gamblers_tide`, Level 3 → 4, Fennick's Rest and Wreckers' Cove)

- **Purpose:** the swashbuckling turn. Lighter tone, dice and boats, the hag.
- **Scenes:**
  - `fennicks_rest_hall`: the gambling hall where hollow gold is washed. A dice game as a check sequence (Sleight of Hand / Insight / honest luck with disadvantage) that can win the launderer's marker. Third companion: **Wren Thistle** (see §9), who cheats on the hero's side if asked (rep `red_gull_brotherhood` −5 if caught).
  - `salt_s_sloop`: Captain Ferrin Salt. Conversation ≥ 3 approaches: buy him out, threaten (he is a deserter: `red_gull_brotherhood` knows), trick (Deception with Wren's marker). Fight if it fails: `pirate` ×4 + `bandit_captain` ×1 on a ship-deck map. If Salt walks away alive without being bought out, `arc.crown.salt_unpaid` = true (he still holds the hero's marker).
  - `reef_run`: travel event chain by boat: Oshaya's weather (uses the weather system), Survival/Athletics checks, a `merrow` ×2 ambush if the hero chose the night crossing.
  - `wreckers_cove`: dungeon map with fog, sea caves; "something that eats": `gray_ooze` ×2 then `ghast` ×1 among the Red Gull stash (the Gulls expect a share: `world.red_gull_debt` += 50 unless rep ≥ 30).
  - `tallow_s_market`: **Mother Tallow** (night hag) sells faces. The hero can buy, bargain or burn. Buying a face (a disguise flag `arc.crown.borrowed_face` usable once in ch3) costs a memory: a permanent scar entry "the memory of a name" (scar system, cosmetic) and `world.hag_bargain` = true. Burning the market starts the fight early: `green_hag` ×1 stands in for Tallow here (she escapes; the real fight is ch3). Clue 5 either way.
  - `cove_camp`: long rest; **[LEVEL 4]**. Ending → `next: arc2_ch3_blightwood_mint`.
- **Encounters:** `pirate` ×4 + `bandit_captain`; `merrow` ×2; `gray_ooze` ×2; `ghast` ×1; `green_hag` ×1 (optional).

## 7. Chapter 3: The Blightwood Mint (`arc2_ch3_blightwood_mint`, Level 4 → 5, Blightwood and the Ruins of Old Vaelthorn)

- **Purpose:** the dark finale. Find the foundry, stop the coronation, decide what worth means.
- **Scenes:**
  - `dawnspire_muster_lite`: Dawnspire Keep. The Dawn Lance can lend a knight (`knight` ×1 ally for the finale) if rep `order_of_the_dawn_lance` ≥ 20 or the hero carries the Ironvault commission. Corwin cameo if imported (§3).
  - `blightwood_paths`: the forest whose paths change after dark: a dungeon map with a beat that rotates exits each hour (`revealRoom` + flag-driven exits), `worg` ×2 + `goblin_warrior` ×3 (`ghoul` ×2 extra in the stirring-Maw variant). Survival to keep the path; Nature to read the weeping sap.
  - `vaelthorn_foundry`: the imperial construct-foundry. Puzzle-light: three assay stations (Arcana / Investigation / Korrath's rite by Brannoc) to cool the moulds; `animated_armor` ×3 + `gargoyle` ×1 if skipped. Clue 6.
  - `coronation`: the set piece. A Face wearing the Regent's or the Queen's envoy's shape is about to be crowned with the Hollow Crown before a bought court. Options branch on clues held (≥ 3 → "name Vexx"), `arc.crown.borrowed_face` (walk in as one of them), the knight ally, and `arc.crown.gilt_exposed`. Boss: **Vexx** (`spy` statblock with `statOverrides`: HP ×1.5, a "false face" reaction once per fight) + `cultist_fanatic` ×2 (Brother Pale) + `doppelganger` ×1 (Gilt, if not exposed in ch1). Mother Tallow joins (`night_hag`, CR 5) only if her market was burned.
  - `hollow_crown_choice`: after the fight. The crown is real enough to work. Destroy it (Korrath's hammer: Brannoc approval +20), hand it to the Crown (rep `crown_of_aurelmark` +20; Ilse objects), keep it (`world.hollow_crown` = "player", a future hook), or bargain with Vexx (`vexx_fate` = "bargained": the hero's face is the price; scar "a stranger in the mirror", every later NPC first-meeting Insight check at disadvantage: a story condition). **[LEVEL 5]**.
  - `epilogue_deepanvil`: the Ironvault court, the endings (§10).
- **Encounters:** `worg` ×2 + `goblin_warrior` ×3 (+ `ghoul` ×2); `animated_armor` ×3 + `gargoyle` ×1; Vexx + `cultist_fanatic` ×2 (+ `doppelganger`, + `night_hag`).

## 8. Level pacing

Milestone levels at the scenes marked above (level-set outcome, as arc 1 does): 2 at the end of ch0, 3 at the end of ch1, 4 at the end of ch2, 5 after the coronation. Side quests between chapters give XP but cannot push the hero past the next milestone (the generator's cap, as today).

## 9. Companions (new, 3; data/companions.json)

| id | Name | Class | Hook | Loyalty likes / dislikes | Personal quest (small adventure, later) |
|---|---|---|---|---|---|
| `brannoc` | Brannoc Stonecount | Dwarf cleric of Korrath (Life domain) | The shrine-keeper who first tested the ash coin; wants the Ironvault's honour back. | honest deals, destroying forgeries / bribes, keeping the crown | "The Last Weight": his father's assay seal, buried in the hollow tenth. |
| `ilse` | Sister Ilse Varn | Human wizard (Veyra, dreams) | Dreams the Sleeping Forge; reads the unmade book. | clues shared, mercy to the unmade / burning the market | "The Book of the Unmade": restore one bought face. |
| `wren` | Wren Thistle | Halfling rogue (Fennick) | Cheats for a living, hates being cheated; the launderer stiffed her. | winning, sparing Salt / handing people to the law | "Double or Nothing": Salt's rematch at the hall. |

Flags (B003, `world.*` like arc 1's companions so later arcs can read them): `world.brannoc_status` / `world.brannoc_loyalty`, `world.ilse_status` / `world.ilse_loyalty`, `world.wren_status` / `world.wren_loyalty`. Their roster entries list `arcs: ["crown"]`: the validator rejects a `recruit` of them from any other arc.

Models: existing CC0 packs cover dwarf, human and halfling body types with the outfit system; no new assets required (confirm with `equipmentLook`).

## 10. Endings (evaluated in `epilogue_deepanvil`, first match wins)

| # | id | Name | Conditions |
|---|---|---|---|
| 1 | `ending_false_coin` | The False Coin (bad) | the coronation happened (`arc.crown.crowned` = true) |
| 2 | `ending_true_weight` | True Weight (triumph) | crown destroyed or handed over AND `vexx_fate` ∈ {unmasked, killed} |
| 3 | `ending_hollow_king` | The Hollow Keeper (grey) | `world.hollow_crown` = "player" |
| 4 | `ending_stranger` | A Stranger in the Mirror (bittersweet) | `vexx_fate` = "bargained" |
| 5 | `ending_thousand_faces` | The Thousand Faces (open) | `vexx_fate` = "escaped" |

Faction epilogues: `ironvault_consortium` (vault honest again or austerity), `crown_of_aurelmark` / the Regent, `red_gull_brotherhood` (Salt's fate), `order_of_the_dawn_lance` (the lent knight), companions (three lines), Brightwater (Dunmore's assay house). Defeat count joke as arc 1.

## 11. Defeat outcomes

Reuse `defeat-outcomes.json`; add three arc-specific entries: "sold to the hall" (wake in Fennick's Rest owing `world.red_gull_debt` +30), "a borrowed face" (wake with `arc.crown.borrowed_face` spent), "the Wardens' escort" (Blightwood only).

## 12. Side-quest hooks (generator priority)

| Hook | Created by | Template | Write-back |
|---|---|---|---|
| "Ash in the Till": a village paid in hollow gold | `arc.crown.saw_ash` | investigate (`millbrook`, `brightwater`) | rep `crown_of_aurelmark` +5 |
| "The Courier's Road" | `arc.crown.courier_known` | hunt_fugitive (`brightwater`, `deepanvil_hold`) | clue 2 shared with Ilse |
| "Hesk's Daughter" | `arc.crown.gilt_exposed` = false | rescue (`deepanvil_hold`) | sets `gilt_exposed` = true |
| "Salt's Marker" | Salt alive and unpaid | negotiate (`fennicks_rest`) | clears `world.red_gull_debt` |
| "The Unmade" | `world.hag_bargain` | fetch (`wreckers_cove`) | restores the memory scar (`arc.crown.memory_restored` = true; the epilogue reads it) |

Built in B003 as `data/tables/sidequests.json` threads `ash_in_the_till`, `couriers_road`, `hesks_daughter` (if `arc.crown.gilt_fled` and not exposed), `salts_marker` (if `arc.crown.salt_unpaid`; also clears it), `the_unmade`. The three defeat outcomes of §11 are `wardens_escort`, `sold_to_the_hall` and `borrowed_face` in `data/tables/defeat-outcomes.json`, limited to this campaign by `when.campaigns`.

## 13. What has to be built (proposed queue, one session each unless split)

Engine and UI first, then content, then Danish. Ids `B0xx` so they sort after the A-series.

- **B001 — Campaign picker.** `new_game` gains `campaign` (adventure id of the first chapter); the title screen and creator's Review step offer "The Seven Teeth of Vashkul" / "The Hollow Crown" (en + da); `STARTING_ADVENTURE` becomes a per-campaign table (`src/host/campaigns.ts`); save meta shows the campaign; tests. Done when a new game can start in either campaign in both editions.
- **B002 — New hero, same world.** Optional import of a finished save's `world.*` / `arc.main.*` / reputation / time into a fresh campaign (reuse `continueWorld`), a one-screen picker listing saves whose state has an ending flag; fresh-world defaults written otherwise; tests.
- **B003 — Companions and lore for arc 2.** Three companions in `companions.json` (+ Danish overlay stubs), two new lore locations if needed (`silverrun_assay_house` as part of Brightwater, `tallow_market` as part of Wreckers' Cove: prefer POIs over new locations), arc 2 defeat outcomes, side-quest hooks table entries; validator and content tests.
- **B004 — Chapter 0 JSON** (`data/adventures/arc2/ch0_hollow_coin.json`) with solver legs, chapter test, bundled.ts registration.
- **B005 — Chapter 1 JSON.** Same bar.
- **B006 — Chapter 2 JSON.** Same bar (boat travel chain through travel events).
- **B007 — Chapter 3 JSON + endings + epilogue.** Same bar; `statOverrides` for Vexx.
- **B008 — Arc 2 smoke tests.** Policy playthrough ch0 → ending in both editions (InPage and server), random-walk playtest extended to pick either campaign.
- **B009–B012 — Danish overlays** for ch0–ch3 (stub with `i18n:check --stub`, translate, glossary terms for assay/forge/face vocabulary).
- **B013 — Real-model playtest of arc 2** (`playtest-llm.ts --campaign=hollow_crown`), narration spot check, prompt facts for the new NPCs.
- **B014 — Docs:** README campaign list, DESIGN_ARC2 marked built, ADVENTURE_FORMAT note on campaigns.

Rough size: 14 assignments, roughly the same shape as Phase 11 + Phase 16 for one arc.
