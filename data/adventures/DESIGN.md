# Campaign Design Bible: "The Seven Teeth of Vashkul"

Design source of truth for the hand-authored content (Build Prompt §7.2). Later sessions convert it into adventure JSON (see `ADVENTURE_FORMAT.md` once it exists). Companion file: `data/adventures/flags.json` (the world-flag registry, validated by `tests/campaignDesign.test.ts`).

## 0. Conventions

- **Ids.** All place, faction and god ids come from `data/world/lore.json`. Scene ids are snake_case and unique across the campaign. Monster ids come from `data/srd/monsters.json` and are written as the backticked id followed by "×" and the count (e.g. three giant rats). Magic items from `data/srd/magic-items.json` use the same notation.
- **Flags.** Every world flag is in backticks and listed in `flags.json`. There are three namespaces:
  - `arc.starter.*` is for the starter arc only.
  - `arc.main.*` is for the five-chapter campaign.
  - `world.*` is for anything a future arc may read: companions, the Maw, the queen, outlaw status.
- **String flags** have an enumerated `values` list in `flags.json`. Unset flags read as their `default`.
- **Checks** are written as `Skill DC n`. "Group" means that every active party member rolls and half or more must succeed. A check marked (adv: X) grants advantage when condition X holds.
- **Encounters** list base monsters for a party of 4 at the chapter's level. The engine rescales them using SRD encounter budgets (Build Prompt §6). A "boss" is never removed by scaling; its minions are removed first.
- **Rep** is faction reputation (Build Prompt §11.2), with a scale from -100 to +100. Tiers: Hostile ≤ -60, Unfriendly ≤ -20, Neutral, Friendly ≥ 20, Honored ≥ 50, Revered ≥ 80.
- **Loyalty** is companion approval, from 0 to 100, starting at 50. "Very low" means ≤ 20, which triggers the authored leave or betray points. "High" means ≥ 70.
- **Defeat** names a Heroic-mode outcome id from §13. In Hardcore mode, defeat is death, and the flags stay intact for the next hero.
- **Levels** are advanced by milestone at the scenes marked **[LEVEL n]**.

## 1. Premise, Themes and Tone

**Premise.** Fourteen centuries ago, imperial delvers opened the Maw and woke Vashkul, the Hungering Dark. The founders of the Lantern Wardens re-sealed it by driving seven of its teeth into the seal-stone. They then scattered the seven Tooth relics across Orrimar so the seal could never be undone. Two years ago the Whispering Sickness began: its victims hear a choir promising that hunger will end. The Hollow Choir is hunting the seven Teeth. If all seven are set back into the Maw's jaw, the seal inverts and Vashkul wakes. The hero stumbles onto the first Tooth in a sleepy village and becomes the one person racing the Choir for all of them.

**Core themes.**
- *Hunger and mercy.* Every region is starving for something: food, coin, glory. The villain's promise is to end want forever, and the true cost is everything.
- *Who deserves saving.* The Wardens burn the sick while the Briarkin heal them at a price. Saltwind hangs pirates while the pirates feed islands. No faction is purely right.
- *Oaths kept and broken.* This covers knights, pirates' codes, witches' bargains, and a noble's betrayal of her queen.

**Tone per region** (from lore `toneProfile`; the narrator uses the region's profile):

| Region | Tone | Campaign flavour |
|---|---|---|
| `aurelmark` | High fantasy: grandeur, oaths, wonder | Knights, a lost holy lance, a dragon, and court intrigue behind golden masks. Heroism is rewarded, but the rot lies at the very top. |
| `gloamfen` | Dark fantasy: grim, scarce, morally gray | Plague villages, pyres, witches and drowned bells. Choices here cost lives either way. It opens (Ch1) and closes (Ch5) the arc. |
| `brinescatter_isles` | Swashbuckling: light, witty, adventurous | Gallows rescues, card games, treasure maps, singing reefs and riddling clockwork parrots. The villain's plot is present but is played as a caper. |

**Arc shape.** The starter arc is in Aurelmark, at its fen border (Millbrook). Ch1 is in Gloamfen, Ch2 in Brinescatter, Ch3 and Ch4 in Aurelmark, and Ch5 back in Gloamfen, where the Maw lies.

## 2. The Villain: The Cantor

- **Identity.** Lady Seraphine Vell is the Royal Almoner of Aurelmark, a Highcrown noble. She runs the crown's famine relief and is godmother and chief confidante to Queen Isolde Varannis. She is the "adviser who is lying" from the lore.
- **Public face.** She is warm, tireless and beloved by the poor. She founded the Almonry grain ships and personally tends the sick in Highcrown's hospices.
- **Backstory.** At 14 she lived in Cinderdale, one of the three valleys Pyrraxis burned in the Ashfall Winter 23 years ago. She starved through that winter, and her little sister Liesel died in her arms. The Dawn Lance arrived too late. In fever-dreams she heard Vashkul's choir: *"You will never want again."* She believed it.
- **Motive.** She truly believes that waking Vashkul will "devour hunger itself" and join every soul into one sated Choir with no more famine, grief or kings. She is a zealot, not a sadist. She hates the Dawn Lance, which came too late, and the crown's neglect of the poor. The one thing she loves is Isolde, whom she wants to "spare" by converting her.
- **Method.** The Almonry's relief grain, shipped from Port Sorrel, is laced with Maw-rot spores, which cause the Whispering Sickness. The sick hear the Cantor's voice in dreams and become cultists or fodder. Choir cells hide in noble salons (`highcrown`), on the docks (`port_sorrel`) and among the starving (`hollowmere`).
- **Lieutenants** (each can escape and seed side quests):
  - Brother Ashby leads the Millbrook cell (starter). Statblock `cultist`, later `cultist_fanatic`.
  - Mother Sallow is the plague-preacher of Hollowmere (Ch1). Statblock `cultist_fanatic`.
  - Captain Harrow Vey is the Choir's smuggler-captain (Ch2). Statblock `bandit_captain`, later `pirate_captain`.
  - Vosk the Hollow is a renegade Veyran scholar and the Choir's archivist-mage (Ch3–5). Statblock `mage`.
- **Stat block (finale).** The Cantor uses `archmage` with these changes:
  - Voice of the Choir: bonus action, 30 ft, Wis save DC 17, or the target is frightened until the end of its next turn.
  - Hunger Pull: once per round at initiative 20, with the teeth-steal rule in `choir_of_teeth`.

### 2.1 The plan across chapters

| When | The Choir's move | What the player sees |
|---|---|---|
| Starter | Ashby's cell digs up the Tooth of Want beneath the Millbrook barrow and kidnaps villagers to "feed" it awake. | Disappearances; a seven-tooth sigil. |
| Ch1 | Mother Sallow spreads the Sickness in Hollowmere to force the Wardens to burn the village, driving survivors into the Choir. The Choir hunts the Abbey Tooth and Grandmother Wick's Tooth. | A plague, pyres, and a Warden–Briarkin standoff. |
| Ch2 | Relief grain spreads the Sickness through Port Sorrel. Harrow Vey races for the Parrot Tooth and the Reef Tooth. Governor Pell is bribed to look away. | Almonry seals on the crates and a Choir ledger. |
| Ch3 | Vosk hunts the Vaelthorn Tooth. The Cantor consolidates power at court and poisons the Queen with the Sickness when exposed. | A masquerade and an unmasking. |
| Ch4 | The Cantor uses the Ember Tooth lodged in Pyrraxis to drive the dragon mad with hunger. Meanwhile a Choir coup strikes Highcrown. | Dragonfire and a burning capital. |
| Ch5 | The Cantor retreats to the Maw with every Tooth the Choir holds and begins the Choir of Teeth ritual. | A siege, a haunted wood, and the final descent. |

### 2.2 How the player learns the secret

Seven clues exist. **Private knowledge** (`arc.main.cantor_identity_known`) needs any 2 clues, plus the masquerade Insight check. **Public unmasking** (`arc.main.cantor_unmasked_publicly`) needs 3 clues, of which at least one is physical evidence (marked P). Chapter 3 checks these thresholds directly from the clue flags, with the chapter-local flags `~ch3_clues_2` and `~ch3_clues_3`.

1. Dream voice. Scene `barrow_shrine_rest` sets `arc.starter.dream_heard`. At the masque, the voice sounds familiar (Insight DC 12 instead of DC 17).
2. (P) Almonry seal on the plague grain. Scene `port_sorrel_docks` sets `arc.main.almoner_seal_seen`.
3. (P) The Choir ledger, with payments "per the Almonry". Scene `wreckers_cove_caves` sets `arc.main.choir_ledger_found`.
4. (P) The Ironvault money trail. Scene `deepanvil_ledgers` sets `arc.main.money_trail_proven`.
5. Mother Sallow's confession. `arc.main.sallow_fate` is "captured", followed by Intimidation or Persuasion DC 14 in `lantern_hold_tribunal` or `night_of_bells`. She reveals that the Cantor wears the Queen's-godmother ring.
6. Aurek's confidence. In `highcrown_audience` or later, if `world.aurek_loyalty` ≥ 60, Aurek admits that his aunt vanishes on the nights the Choir sings.
7. Vosk's notes. `arc.main.vosk_fate` is "captured" or "killed" in `vaelthorn_sky_towers`. Investigation DC 15 finds a letter in Seraphine's hand.

### 2.3 Possible fates (`arc.main.cantor_fate`)

- **killed**: She is slain in `choir_of_teeth`. This is the default if combat is won without a parley.
- **redeemed**: This requires `arc.main.cantor_identity_known` and `arc.main.cantor_parley` = "accepted". Parley opens if she is at or below half HP, *and* one of these holds:
  - Aurek is in the party with `world.aurek_loyalty` ≥ 70.
  - Or the player shows Liesel's locket (from `palace_undercroft`) and passes Persuasion DC 20.
  - Or `world.queen_alive` is true and Isolde's letter of forgiveness was obtained in `highcrown_burning`.

  If redeemed, she turns the ritual inward and uses her own voice to seal the jaw. She dies (or lives, if `world.maw_state` ends "sealed" with a strength of 7 or more) as the Maw closes.
- **captured**: She is reduced to 0 HP with a nonlethal blow. She is dragged back to trial in Highcrown (epilogue).
- **escaped**: This happens if the party is defeated in the finale in Heroic mode and the second attempt fails, *or* if the seal ends "stirring". She sinks into the Maw's depths and becomes its voice. This is the hook for the next arc.

## 3. The Seven Teeth

The Maw can only be sealed by Teeth placed back *in reverse*, inside the Maw. The Cantor opens it by placing all seven in order. Each Tooth has a holder flag with these values:
- "unclaimed": still in place.
- "player": in the party's pack.
- "wardens", "briarkin", "red_gull", "dawn_lance": a safe ally keeps it. It counts as secured, and that ally brings it to Ch5.
- "choir": the Cantor has it.

| # | Tooth | Where | Holder flag | Chapter |
|---|---|---|---|---|
| 1 | Tooth of Want | Millbrook barrow (`millbrook`) | `arc.main.tooth_want_holder` | Starter |
| 2 | Drowned Tooth | Drowned Abbey reliquary (`drowned_abbey`) | `arc.main.tooth_abbey_holder` | Ch1 |
| 3 | Briar Tooth | Grandmother Wick's jar-shelf (`thornwife_hollow`) | `arc.main.tooth_wick_holder` | Ch1 |
| 4 | Brass Tooth | Brass Parrot vault (`isle_of_brass_parrots`) | `arc.main.tooth_parrot_holder` | Ch2 |
| 5 | Singing Tooth | The sea hag's lagoon (`singing_reef`) | `arc.main.tooth_reef_holder` | Ch2 |
| 6 | Sky Tooth | Vaelthorn sky-tower (`ruins_of_old_vaelthorn`) | `arc.main.tooth_vaelthorn_holder` | Ch3 |
| 7 | Ember Tooth | Lodged in Pyrraxis's old wound (`emberpeak`) | `arc.main.tooth_ember_holder` | Ch4 |

- `arc.main.teeth_secured` is the number of Teeth held by the player or an ally.
- `arc.main.teeth_choir` is the number held by "choir".

The engine recomputes both counts whenever a holder flag is written.

**Tooth mechanics (while carried).** Each carried Tooth grants advantage on saves against the Whispering Sickness. At each long rest, one carrier makes a Wis save with DC 10 + Teeth carried. On a failure, the carrier gains no Hit Dice back that rest and has a Maw-dream, which the narrator uses as a Choir hint. Allies who hold Teeth are safe from this rule.

## 4. Starter Arc: "The Millbrook Disappearances" (Level 1 → 2, 1–2 sessions)

- **Chapter id:** `starter`
- **Region:** `aurelmark`, at its southwestern edge near the fens.
- **Hub:** `millbrook`
- **Premise.** Four villagers have vanished in two weeks, and doors are barred at dusk. The hero arrives, as a traveller, hired sword or returning local (depending on background), on the evening of the fifth disappearance.
- **Teaches, in order:** exploration → dialogue and persuasion → skill checks → grid combat → resting → shops and recruiting → world map and travel.
- **Tutorial rule.** On the first occurrence of each system, the UI shows a one-line tip. The narrator does not explain mechanics.

**Starter NPCs (new):**
- **Reeve Hollis Tamsin.** Human, `commoner`. Tired, honest and proud, and ashamed he cannot protect his village. Voice: slow, farmer's drawl.
- **Widow Agna Marrow.** Halfling, `commoner`. Runs Marrow's General Goods. Sharp, gossip-hungry, and a hard haggler. Secret: her dead husband's ring was stolen from her shop, and the cultists took it.
- **Pip Hallard.** Human child, aged 12, `commoner`. The miller's son and the most recent captive. Brave, and wants to be a knight.
- **Miller Oda Hallard.** Human, `commoner`. Pip's mother. Secretly paid "a hooded brother" to stay away from her mill, which is why she hides things.
- **Brother Ashby.** Human, `cultist` (starter) → `cultist_fanatic` (if met again). A former village sexton, soft-spoken and fervent. He fled the Sickness in Ravensgate and heard the Choir.
- **Ser Corwin Ashvale.** The first companion; see §11.

### 4.1 `millbrook_arrival`: Exploration
- **Location:** `millbrook`, in the village green at dusk.
- **Purpose:** Teach points of interest (POIs), free movement, passive and active Perception, time of day, and the journal.
- **Key beats:**
  1. The hero arrives as shutters slam. A dog howls at the well.
  2. There are 4 POIs: the Well, the Chapel of Solenne, the Plough and Lantern tavern, and Marrow's General Goods (closed at night; opens at dawn).
  3. At the well, a chalk sigil shows a black mouth ringed with seven teeth. A journal entry is added.
  4. Wet footprints lead from the well toward Gallows Hill.
- **Checks:**
  - Perception DC 10 at the well spots the sigil. It is automatic if the hero examines the well.
  - Investigation DC 12 on the footprints finds that they are barefoot, several people, and carry mud from the barrow clay.
  - Religion DC 10 identifies the sigil as the mark of Vashkul.
- **Encounter:** none. At night, a single `giant_rat` ×1 scurries at the well. It is harmless and teaches the combat-ready prompt, then flees.
- **Rewards:** Journal quest "The Millbrook Disappearances".
- **Flags written:** `arc.starter.sigil_found` (true if the sigil is spotted).
- **Defeat:** n/a.

### 4.2 `plough_tavern_talk`: Dialogue and Persuasion
- **Location:** `millbrook`, at the Plough and Lantern tavern.
- **Purpose:** Teach NPC dialogue, attitudes, Persuasion, Insight and Intimidation, and that choices have social cost.
- **Key beats:**
  1. Reeve Tamsin drinks alone. Miller Oda weeps in a corner. Ser Corwin argues loudly with the Reeve: "Let me search the hill!" The Reeve refuses because Corwin was "dismissed from the Lance."
  2. Corwin storms out, which foreshadows his recruitment. He goes to the hill alone that night and is captured.
  3. The Reeve can give the list of the missing and the key to the old barrow gate.
  4. Oda hides that she paid the "hooded brother."
- **Checks:**
  - Persuasion DC 12 (adv: `arc.starter.sigil_found`, because showing the sigil proves you're serious) makes the Reeve friendly. He gives the missing list and the barrow key.
  - Intimidation DC 10 also gets the key, but the Reeve turns hostile.
  - Insight DC 13 on Oda reveals her guilt. Persuasion DC 11 then gets her confession: "the hooded brother came from the hill; he wanted my millstones' grain."
  - Failing all checks: the Reeve is neutral and gives only the key, after a 5 gp "deposit".
- **Encounter:** none. A bar brawl is optional if the hero picks a fight: `commoner` ×2, nonlethal only.
- **Rewards:**
  - The barrow key (a quest item).
  - The Reeve's letter of introduction if friendly, used later at the Ravensgate gates.
  - A free room if friendly.
- **Flags written:**
  - `arc.starter.reeve_attitude`: "friendly" if Persuasion succeeds, "hostile" if Intimidation is used, otherwise "neutral".
  - `arc.starter.missing_list`: true if the Reeve gives the list or Oda confesses.
- **Defeat:** In the brawl only, `robbed_and_left`: wake in the tavern stable, minus 2d10 gp.

### 4.3 `gallows_hill_trail`: Skill Checks
- **Location:** `millbrook`, on the Gallows Hill track outside the village at night.
- **Purpose:** Teach choosing between skills, group checks, failure that moves the story forward, and passive checks.
- **Key beats:** The tracks run along the flooded millrace, through bramble, to a barrow on a hill. Two cultist lookouts watch from the barrow's mound.
- **Checks:**
  1. Survival DC 12 follows the tracks (adv: `arc.starter.missing_list`, which names where Pip was taken). On a failure, add 1 hour; the hero reaches the barrow at midnight and a `stirge` ×2 nest disturbs the approach.
  2. Athletics DC 10 or Acrobatics DC 12 crosses the millrace. On a failure, take 1d4 bludgeoning damage and the hero's gear is soaked (no mechanical effect).
  3. Group Stealth DC 13 approaches the barrow. On a success, the lookouts are surprised or bypassed. On a failure, they ring a bone chime and the barrow is alerted.
- **Encounter:** `stirge` ×2 (on the failure branch only).
- **Rewards:** A lookout's cudgel and 3 sp.
- **Flags written:** `arc.starter.ambush_avoided`: true on a Stealth success.
- **Defeat:** `dragged_to_safety`. The Reeve's search party finds the hero at dawn. The captives are moved deeper, and the cap on `arc.starter.captives_saved` drops by 1.

### 4.4 `barrow_of_the_first_sheaf`: Grid Combat
- **Location:** `millbrook`, in the barrow beneath Gallows Hill. This is an old shrine of Thaloren, with 3 rooms on a fog-of-war grid.
- **Purpose:** Teach the grid, movement, opportunity attacks, cover, difficult terrain, and taking prisoners or letting enemies flee.
- **Rooms:**
  1. **Root Hall** (10×8). Tutorial combat: `giant_rat` ×3 among fallen roots (difficult terrain).
  2. **Sheaf Crypt** (12×10). Corwin is chained here, beaten, at 0 HP but stable. Enemies: `cultist` ×2. If `arc.starter.ambush_avoided` is true, the hero gets a surprise round. Otherwise the cultists are behind barricades (half cover).
  3. **The Tithe Altar** (14×12). Brother Ashby (`cultist`, max HP) and `cultist` ×1 are here, plus a `swarm_of_rats` ×1, but only if the barrow was alerted. Four captives are chained to the altar: Pip, the shepherd Tobin, the twins Maddy and Moll. The black Tooth of Want sits in the altar's jaw-shaped basin.
- **Special rules:**
  - Ashby flees down a collapsing tunnel when reduced to half HP. He escapes unless grappled, knocked prone, or dropped in the same turn.
  - Each round the altar "feeds," and a captive takes 1d4 necrotic damage. After 4 rounds, the nearest captive dies. An action with Athletics DC 12 or thieves' tools DC 12 frees a captive.
- **Encounters (in order):**
  - Root Hall: `giant_rat` ×3.
  - Sheaf Crypt: `cultist` ×2.
  - Tithe Altar: `cultist` ×2 (Ashby is one of them), plus `swarm_of_rats` ×1 if alerted.
- **Rewards:**
  - The Tooth of Want.
  - Widow Marrow's stolen ring.
  - 25 gp.
  - `potion_of_healing` ×1.
  - A cultist's sickle (SRD sickle).
  - **[LEVEL 2]** on leaving the barrow.
- **Flags written:**
  - `arc.starter.captives_saved`: a number from 0 to 4.
  - `arc.starter.pip_rescued`: true if Pip survives.
  - `arc.starter.ashby_fate`: "captured", "killed", or "escaped".
  - `arc.main.tooth_want_holder`: "player".
  - `world.corwin_status`: "met" (freed).
- **Defeat:** `captured_by_choir`. The hero wakes chained beside Corwin in the Sheaf Crypt, with gear on a table in the room. A Dex (thieves' tools) or Str check DC 12 frees them, or Corwin works the chain loose after 2 attempts. Ashby has fled with 1 captive, which lowers the maximum captives saved by 1. The Tooth remains.

### 4.5 `barrow_shrine_rest`: Resting
- **Location:** `millbrook`, in the barrow's inner shrine, then the tavern.
- **Purpose:** Teach short rests (spending Hit Dice), long rests, the safety of rest locations, and the Tooth's dream mechanic.
- **Key beats:**
  1. The rescued villagers are too weak to walk. The hero can short rest in the shrine of Thaloren while Corwin recovers.
  2. Rekindling the shrine's antler-brazier makes the rest uninterrupted and grants 1 extra Hit Die of healing.
  3. Returning to Millbrook, the hero long rests at the tavern. The Reeve pays for the room if he is friendly; otherwise it costs 5 sp.
  4. At night, the Tooth's dream: a woman's voice, cultured and sad, sings "you will never want again."
- **Checks:**
  - Religion DC 10 or Nature DC 12 rekindles the shrine.
  - During the long rest, Wis save DC 10: *success* means the hero remembers the voice clearly; *failure* means the hero wakes shaken (no Hit Dice regained) and still hears the voice.
- **Encounter:** If the hero short rests *without* rekindling the shrine, a random-interruption tutorial occurs: `giant_rat` ×2.
- **Rewards:** Level 2 features are applied at the long rest. Journal: "A voice in the dark."
- **Flags written:**
  - `arc.starter.shrine_rekindled`: true on success.
  - `arc.starter.dream_heard`: true on a successful Wis save. A failure also sets it if the hero writes about the dream in the journal (free-text "remember the voice").
- **Defeat:** n/a.

### 4.6 `marrows_goods_and_oath`: Shops and the First Companion
- **Location:** `millbrook`, at Marrow's General Goods and the Chapel of Solenne, by day.
- **Purpose:** Teach buying, selling, haggling, limited stock, and recruiting a companion (loyalty, the AI/player-control toggle, and banter).
- **Key beats:**
  1. **The shop.** Widow Marrow's stock: `potion_of_healing` ×3 (50 gp each), rations, rope, a shortbow, a shield, leather armor, chain shirt ×1, holy water ×1, and a healer's kit.
     - Returning her ring makes her friendly: 20% off and she gives a free `potion_of_healing`.
     - Selling the cult sickles teaches supply: each extra sickle sells for less.
  2. **Haggle.** Persuasion DC 12 gets 10% off (DC 15 if she is not friendly). Only one attempt per shop visit.
  3. **Corwin at the chapel.** Freed and bandaged, Corwin kneels at Solenne's altar. He asks to ride with the hero: "The Choir took children from under my nose. I will not wait for the Lance's permission."
- **Checks:**
  - Recruiting Corwin is automatic if he was freed. Persuasion DC 10 is needed only if the hero was cruel to prisoners in 4.4; on a failure, he joins at loyalty 35.
  - Insight DC 12 learns that he was dismissed from the Dawn Lance for striking a superior who ordered a village abandoned.
- **Encounter:** none.
- **Rewards:**
  - Corwin joins. The UI teaches the AI and player-control toggle.
  - Rep `crown_of_aurelmark` +5 (the Reeve reports well of the hero) if `arc.starter.captives_saved` ≥ 3.
- **Flags written:**
  - `world.corwin_status`: "in_party".
  - `world.corwin_loyalty`: 50, or 60 if all captives were saved, or 35 as above.
  - `arc.starter.marrow_ring_returned`: true if the ring is returned.
- **Defeat:** n/a.

### 4.7 `road_south`: World Map and Travel
- **Location:** `millbrook`, where the world map opens. Routes lead to `ravensgate` (30 mi road) or `brightwater` (25 mi road).
- **Purpose:** Teach the world map, route choice, travel pace (fast, normal, slow), travel time and clock, random travel events, and arriving at dusk (the Ravensgate curfew).
- **Key beats:**
  1. The Reeve (or Corwin, if the Reeve is hostile) says the Tooth is unholy. Someone must take it.
  2. The hero chooses between two destinations:
     - **Ravensgate**, to the Lantern Wardens, who "know fen-evil."
     - **Brightwater**, to the Crown's district magistrate, the "proper authority."

     Either way, the story leads into the Gloamfen: Ch1 starts at `ravensgate`. From Brightwater, the magistrate's clerk takes the Tooth and "forwards it to the Royal Almonry for safekeeping." The hero is then sent to Ravensgate with a crown writ to investigate the plague's source.
  3. **Travel event (scripted, first trip):**
     - On the Ravensgate road at dusk, the event is Wolves in the Barley: `wolf` ×2.
     - On the Brightwater road, the event is a Toll-Bridge Shakedown: `bandit` ×2, which can be talked down with Persuasion DC 12 or a 5 gp toll.
  4. Slow pace allows foraging (Survival DC 10 for 1 day of rations). Fast pace gives -5 to passive Perception, and the event starts with the hero surprised.
- **Checks:** Survival DC 10 (forage), Persuasion DC 12 (toll).
- **Encounter:** `wolf` ×2 (Ravensgate road) or `bandit` ×2 (Brightwater road).
- **Rewards:**
  - A crown writ (Brightwater path; it grants entry at Ravensgate).
  - Or Warden favor (Ravensgate path; rep `lantern_wardens` +10 on handing over the Tooth).
- **Flags written:**
  - `arc.starter.first_destination`: "ravensgate" or "brightwater".
  - `arc.main.tooth_want_holder`:
    - "wardens" if handed to the Wardens in `ravensgate_gates`.
    - "choir" if given to the Brightwater magistrate (a silent consequence: the Almonry is the Cantor's office).
    - Stays "player" if the hero keeps it.
- **Defeat:** `robbed_and_left`. The hero wakes on the roadside at dawn, having lost 50% of their gold. If the Tooth was carried, it is **not** taken; the robbers flee it in terror.
- **Hook into Chapter 1.** Ravensgate is sealed against the plague. Warden-Sergeant Odo Brask needs outsiders who "aren't sick yet" to go into Hollowmere, where the sick hear the same voice the hero heard in the barrow. The journal adds "The Whispering Fen."

## 5. Main Arc Overview

| Ch | id | Title | Region(s) | Levels | Teeth in play |
|---|---|---|---|---|---|
| 1 | `ch1_whispering_fen` | The Whispering Fen | `gloamfen` | 2–3 | Drowned, Briar |
| 2 | `ch2_salt_and_treason` | Salt and Treason | `brinescatter_isles` | 3–5 | Brass, Singing |
| 3 | `ch3_the_gilded_lie` | The Gilded Lie | `aurelmark` | 5–7 | Sky |
| 4 | `ch4_wyrmfire` | Wyrmfire | `aurelmark` | 7–9 | Ember |
| 5 | `ch5_the_hungering_dark` | The Hungering Dark | `gloamfen` | 9–10 | all (the finale) |

**Between chapters**, side quests unlock (§14). The engine offers 1–2 woven-in quests at each chapter break, drawn from quest boards, taverns and faction contacts.

**Faction web used by the arc** (lore relationships):
- `lantern_wardens` ⟷ `briarkin` are hostile. So are `crown_of_aurelmark` ⟷ `briarkin`.
- `saltwind_trading_company` is allied with `crown_of_aurelmark` and `ironvault_consortium`, and hostile to `red_gull_brotherhood` and `tidewright_guild`.
- `order_of_the_dawn_lance` is allied with `crown_of_aurelmark` and `lantern_wardens`.
- The `hollow_choir` is hostile to everyone.
- **Rule of thumb:** gaining rep with a faction gives −50% of that gain (rounded) to each faction hostile to it, and +25% to each faction allied with it. The engine applies this automatically through the lore relationships (Build Prompt §11.2). The rep numbers below are the direct gains.

---

## 6. Chapter 1: The Whispering Fen (`ch1_whispering_fen`, Level 2–3, Gloamfen)

**Summary.** The Whispering Sickness is burning through Hollowmere. The Lantern Wardens under Warden-Captain Maud Grell plan to burn the village, the living included, at the new moon. Grandmother Wick's Briarkin claim they can cure it, using ash from the Drowned Abbey's dead-bells. Mother Sallow, a Choir plague-preacher, wants the pyre: survivors who flee the flames go to the Maw. Two Teeth are in play:
- The Drowned Tooth, in the Abbey's flooded reliquary.
- The Briar Tooth, kept by Wick "so no one can use it."

**Deadline.** The purge happens 6 in-game days after the hero enters Ravensgate. If the hero hasn't resolved `lantern_hold_tribunal` by then, `arc.main.hollowmere_fate` becomes "purged" automatically.

**Chapter NPCs (new):**
- Warden-Sergeant Odo Brask: `warrior_veteran`. Dour but decent, and doubts Grell privately.
- Abbot Cendric: `priest`. An old priest of Mireth, the last keeper of the Abbey.
- Mother Sallow: `cultist_fanatic`. Kindly-seeming, and gives the sick bread laced with spores.
- Nettle: a companion; see §11.

**Lore NPCs used:** Maud Grell (`lantern_wardens`) and Grandmother Wick (`briarkin`).

### Scenes

**`ravensgate_gates`** (`ravensgate`)
- **Purpose:** Chapter entry, the curfew, and reactions to starter flags.
- **Beats:**
  - The gates close at sunset.
  - Refugees plead outside. A man shows the Sickness' black-veined hands.
  - Sergeant Brask interrogates the hero.
- **Checks:** Persuasion DC 13 to enter after dusk (auto if carrying the Reeve's letter or the crown writ). Medicine DC 12 identifies the Sickness as spore-borne, not a curse.
- **Encounter (night only, if left outside):** `zombie` ×2 shamble from the gibbets, and the refugees beg for help.
- **Reads:**
  - `arc.starter.first_destination`: "brightwater" means Brask respects the writ. "ravensgate" means he takes the Tooth: the hero can hand it over, which sets `arc.main.tooth_want_holder` = "wardens" and gives rep `lantern_wardens` +10, or keep it.
  - `arc.starter.reeve_attitude` = "friendly": the Reeve's letter works.
- **Rewards:** Warden quarantine pass; rep `lantern_wardens` +5 if the hero protected the refugees.
- **Writes:** `arc.main.tooth_want_holder` (optional hand-over).
- **Defeat:** `rescued_by_wardens`.

**`hollowmere_stilts`** (`hollowmere`)
- **Purpose:** Explore the plague village. Meet Mother Sallow and Nettle. Recruit Nettle.
- **Beats:**
  - Stilt-houses over black water, half of them empty.
  - Sallow hands out bread to the sick.
  - Nettle, a Briarkin healer, lances buboes. She's hunted by Warden patrols.
- **Checks:**
  - Insight DC 13 on Sallow senses "her kindness is a hook."
  - Medicine DC 14 on the bread finds spores.
  - Persuasion DC 12 recruits Nettle (auto if `arc.starter.shrine_rekindled`, because she smells Thaloren's smoke on the hero). She refuses if the hero wears a Warden pass openly and fails Deception DC 13.
- **Encounter:** Stepping in when Sallow's "deacons" try to drag a sick child to the Choir boat starts the fight: `cultist` ×3 and `giant_toad` ×1 (their pet from the water). Sallow withdraws.
- **Reads:** `arc.starter.ashby_fate`:
  - "escaped": Brother Ashby is here as Sallow's aide, now a `cultist_fanatic` (replacing 1 `cultist`). He recognizes the hero and taunts them.
  - "captured": his interrogation notes (passed via the Reeve) let the hero spot Sallow's boat in advance, giving advantage on initiative.
- **Rewards:** Nettle joins. Rep `briarkin` +10 if the child is saved.
- **Writes:** `world.nettle_status` = "in_party" (or "met" if the party is full), and `world.nettle_loyalty` = 50.
- **Defeat:** `captured_by_choir` (wake on Sallow's boat, bound for the Drowned Abbey).

**`thornwife_moot`** (`thornwife_hollow`)
- **Purpose:** Grandmother Wick's bargain. The Briar Tooth. The cure recipe.
- **Beats:**
  - The briars shift. Without Nettle or Briarkin leave, the hero gets lost.
  - Wick offers a cure if the hero brings "the ash of the dead-bells" from the Drowned Abbey.
  - She keeps the Briar Tooth on a shelf among jars, one of which holds her true name.
  - She will trade the Tooth for "a memory you'd miss", which inflicts a permanent −1 to one ability check of the player's choice (a story scar), or for the hero's oath to protect Hollowmere.
- **Checks:**
  - Survival DC 13 navigates the briars (auto with Nettle). On a failure, `will_o_wisp` ×1 leads the party into a sinkhole.
  - Persuasion DC 15, or DC 12 with Nettle loyalty ≥ 60, gets the Tooth freely.
  - Sleight of Hand DC 17 steals it, which makes Wick an enemy.
- **Encounter:** `will_o_wisp` ×1 (on the failure branch).
- **Reads:** `arc.starter.shrine_rekindled` (Wick is friendlier: Persuasion checks gain advantage).
- **Rewards:** the Briar Tooth; the cure recipe (after the bell-ash is delivered); `potion_of_healing` ×2.
- **Writes:**
  - `arc.main.tooth_wick_holder`: "player" (given, traded or stolen) or "briarkin" (she keeps it as an ally).
  - `arc.main.wick_fate` = "ally", or "wronged" if stolen.
  - `arc.main.cure_recipe` = true after the ash.
  - `world.briarkin_favor_owed` = true if the hero traded an oath.
- **Defeat:** `rescued_by_briarkin`.

**`drowned_abbey_undercroft`** (`drowned_abbey`)
- **Purpose:** A dungeon crawl. The Drowned Tooth. The bell-ash.
- **Beats:**
  - Abbot Cendric burns the dead upstairs. The undercroft is flooded, and its bells toll at midnight.
  - Sallow's divers are already searching the reliquary.
  - Choice: save the Abbot from the drowned dead, or chase the divers who have the Tooth.
- **Checks:**
  - Athletics DC 12 swims the flooded nave. Each failure costs 1 level of exhaustion (removed by a long rest).
  - Religion DC 13 rings the upper bell. The undead then have disadvantage for 1 minute.
  - Perception DC 14 spots the divers' boat.
- **Encounter:** `zombie` ×4 and `ghoul` ×1 in the nave. At midnight, add `specter` ×1. In the reliquary, `cultist` ×2 divers.
- **Reads:** `world.nettle_status` = "in_party" (Nettle knows the Abbey's burial rites, giving advantage on Religion).
- **Rewards:** the Drowned Tooth; bell-ash; `potion_of_healing` ×1; 60 gp of drowned offerings (Mireth's priests approve only if the hero returns half). **[LEVEL 3]** on completion.
- **Writes:**
  - `arc.main.tooth_abbey_holder`: "player", or "choir" if the divers escaped.
  - `arc.main.abbot_cendric_alive`.
- **Defeat:** `temple_revival` (the Abbot drags the hero upstairs). If the Abbot is dead, the outcome is `captured_by_choir` instead.

**`lantern_hold_tribunal`** (`lantern_hold`)
- **Purpose:** The big faction choice.
- **Beats:**
  - Maud Grell holds a tribunal and demands the hero's support for the Purge.
  - The hero may argue for the cure, betray the Briarkin to the Wardens, or leave.
  - Grell wants any Teeth "in Warden keeping."
- **Checks:**
  - Persuasion DC 15 (adv: `arc.main.cure_recipe`; −2 if Nettle is present and loyalty < 40, because she's hostile) stops the Purge.
  - Intimidation DC 17 does the same, but costs rep `lantern_wardens` −10.
  - Deception DC 14 fakes support, which triggers Nettle's leave check.
- **Branches:**
  - **A) Cure path.** Grell grants 3 days. Hollowmere becomes "cured" after `night_of_bells`. Rep `briarkin` +15, `lantern_wardens` −5.
  - **B) Purge path.** The hero joins the Wardens. Hollowmere is "purged", Thornwife Hollow is raided, and Wick either flees or burns (Grell raids at dawn). Rep `lantern_wardens` +20, `order_of_the_dawn_lance` +5, `briarkin` −40.
  - **C) Abandon.** The hero leaves. Hollowmere becomes "abandoned": the Choir takes the survivors.
- **Encounter:** none (social). On path B, the Thornwife raid adds: `scout` ×2 (Briarkin archers) and `giant_spider` ×1 (Wick's briar-guardian).
- **Reads:**
  - `arc.main.sallow_fate` = "captured" (a confession clue; see §2.2).
  - `arc.main.tooth_want_holder` = "wardens" (Grell trusts the hero, giving advantage on Persuasion).
- **Writes:**
  - `arc.main.hollowmere_fate`.
  - `arc.main.wick_fate` = "burned" (path B, if Wick didn't flee because the raid came before `thornwife_moot` was completed).
  - `arc.main.tooth_wick_holder` = "wardens" (on path B, if still with Wick).
  - `world.nettle_status` = "left" (path B with Nettle in the party always; Deception with Nettle loyalty ≤ 20).
- **Defeat:** `rescued_by_wardens` (path B raid) or `rescued_by_briarkin` (if defending Wick).

**`night_of_bells`** (`hollowmere`)
- **Purpose:** The chapter climax.
- **Beats:**
  - At the new moon, Sallow's Choir boats come to "harvest" the sick.
  - Path A: the hero defends the cure-tents alongside the Briarkin.
  - Path B: Warden pyres burn while the Choir raids in the chaos.
  - Path C: the hero returns to an emptied village and Sallow's farewell sermon.
- **Checks:**
  - Medicine DC 13 ×3 administers the cure during combat (path A). Each success saves a family.
  - Perception DC 15 spots Sallow's escape boat.
- **Encounter:** `cultist_fanatic` ×1 (Sallow, the boss), `cultist` ×2, `ghoul` ×2 (the risen sick), plus `swarm_of_insects` ×1 (plague flies).
- **Reads:**
  - `arc.starter.ashby_fate` = "escaped": Ashby also fights (`cultist_fanatic` ×1 extra) and may escape again.
  - `arc.main.tooth_wick_holder` = "briarkin": Sallow targets Wick, who is present and must survive (escort objective).
- **Rewards:** Sallow's letters (the Port Sorrel manifest, "grain via Almonry ships"); 80 gp; `potion_of_healing` ×2.
- **Writes:**
  - `arc.main.sallow_fate` ("killed", "captured", "escaped").
  - `world.sickness_cure`: "briarkin_cure" on path A with the recipe; "warden_fire" on path B; "none" otherwise.
  - `arc.main.hollowmere_fate` is finalized.
- **Defeat:** `dragged_to_safety` (Sallow escapes automatically; the fate becomes "escaped").
- **Hook to Ch2:** The manifest says Almonry relief-grain from Port Sorrel is spreading the Sickness. The Tooth hunters are "sailing for the Brass Parrot."

**Key story beats and triggers**
- *The Voice.* The first long rest in Gloamfen triggers the Cantor's dream, if the hero carries ≥ 1 Tooth.
- *The Purge ultimatum.* Triggered on entering `lantern_hold` or on day 3, whichever is first.
- *The Choir's offer.* If the hero is at 1 Tooth or fewer after `drowned_abbey_undercroft`, Sallow sends a message: "Give us the Teeth and Hollowmere lives." Accepting sets every carried Tooth's holder to "choir", gives `world.nettle_loyalty` −30, and makes `arc.main.hollowmere_fate` "abandoned". This is a dark branch.

**Faction tension.**
- Helping the Briarkin (path A): rep `lantern_wardens` falls, the Warden shop charges +20%, and Lantern Hold refuses safe-house use until Ch5.
- The Purge (path B): Briarkin become hostile, Thornwife Hollow closes, Nettle is lost, and random Briarkin curse-hunters appear (side hook).

**Flags that visibly change later chapters:**
- `arc.main.hollowmere_fate` changes who defends Lantern Hold in Ch5 and changes the epilogues.
- `arc.main.wick_fate` = "ally" gives Wick's Name-Chant at the finale (+1 seal strength). "burned" means Briarkin hunters appear in Ch5 `blightwood_crossing`.
- `arc.main.sallow_fate` = "escaped" means Sallow returns in `lantern_hold_siege` as the siege leader.
- `world.sickness_cure` changes whether the Queen can be saved in `palace_undercroft` (the cure auto-succeeds).

---

## 7. Chapter 2: Salt and Treason (`ch2_salt_and_treason`, Level 3–5, Brinescatter Isles)

**Summary.** The tone lightens: gallows, gambling halls and treasure maps, with plague grain in the holds. Relief grain stamped with the Almonry seal is spreading the Sickness in Port Sorrel. Governor Pell takes Choir bribes and blames pirates. Captain Harrow Vey, the Choir's smuggler, races for two Teeth: the Brass Tooth, in the legendary Brass Parrot treasure vault, and the Singing Tooth, held by the sea hag of the Singing Reef. The hero must pick a side:
- The Saltwind Company (lawful, allied to the Crown).
- The Red Gull Brotherhood and the Tidewright Guild (free islands).

**Race rule.** After `gullhaven_truce`, the Choir needs 4 days to reach either Tooth. The hero reaches one first. The other goes to Vey, which sets the holder to "choir", unless one of these holds:
- `arc.main.isles_alliance` = "red_gull". Captain Quint sails for the second Tooth; its holder becomes "red_gull".
- `arc.main.isles_alliance` = "saltwind". A Saltwind gunboat escorts the hero, and the second site takes only +1 day.
- The party uses fast sea travel with the Tidewright chart (from `gullhaven_truce`).

**Chapter NPCs:**
- Lore: Governor Cassius Pell, Captain Marisol "Two-Hats" Quint, Harbormaster Oswin Tull.
- New:
  - Captain Harrow Vey: `bandit_captain`, later `pirate_captain`. A charming Choir smuggler.
  - Commander Lusk of Fort Kestrel: `guard_captain`. Bribable.
  - Rook Marrowby: a companion; see §11.
  - Old Sal Brine: `commoner`. The sea hag's former victim, who trades riddles for rum.

### Scenes

**`port_sorrel_docks`** (`port_sorrel`)
- **Beats:**
  - The harbor is quarantined, with cages of "pirates".
  - Almonry grain crates arrive.
  - Pell welcomes the hero if `world.player_outlawed` is false and rep with the Crown is ≥ 0.
- **Checks:**
  - Investigation DC 14 finds the Almonry seal and spores in the crates (adv: `world.sickness_cure` ≠ "none", because the hero knows the spore signs).
  - Stealth DC 13 enters the bonded warehouse at night.
- **Encounter:** Choir dockworker cell: `tough` ×2 and `cultist` ×2 (warehouse, night).
- **Reads:** `world.sickness_cure`, `arc.main.sallow_fate` (if she was captured, her manifest makes the crate check automatic).
- **Rewards:** 50 gp (a Saltwind bounty if the cell is reported). Rep `saltwind_trading_company` +10.
- **Writes:** `arc.main.almoner_seal_seen`.
- **Defeat:** `thrown_in_fort_kestrel`.

**`fort_kestrel_gallows`** (`fort_kestrel`)
- **Beats:**
  - Rook Marrowby is to be hanged at noon for "piracy". His real crime: he saw Vey's cargo.
  - Rook knows half of the Brass Parrot map.
- **Checks:**
  - Persuasion or Deception DC 14 plus a 50 gp bribe to Commander Lusk.
  - Or Stealth DC 14 plus thieves' tools DC 13 for a night break-out.
  - Or Deception DC 16 with forged papers.
  - Or let him hang, and take his half-map from his effects later with Sleight of Hand DC 15.
- **Encounter (break-out alarm only):** `guard` ×4 and `guard_captain` ×1 (Lusk).
- **Reads:**
  - `world.player_outlawed` (Lusk refuses bribes and the DCs rise by 2).
  - `world.red_gull_debt` > 0 (the Red Gulls offer to forgive 100 of the debt if the hero springs Rook, and they tip off the hero about the guard rota, giving advantage on Stealth).
- **Rewards:** Rook joins; the half-map.
- **Writes:**
  - `world.rook_status`: "in_party", "met", or "dead" if he's hanged.
  - `world.rook_loyalty` = 50 (65 if rescued personally at the gallows).
  - Rep `saltwind_trading_company` −15 on a break-out.
- **Defeat:** `thrown_in_fort_kestrel` (the hero shares Rook's cell, and the escape scene is the break-out).

**`fennicks_rest_wager`** (`fennicks_rest`)
- **Beats:**
  - In the Grinning Coin gambling hall, Captain Quint's quartermaster holds the other half-map.
  - Quint herself arrives and offers alliance: "Expose Pell, and the Brotherhood sails with you."
  - A Saltwind agent in the hall offers a counter-deal: "Lead us to Gullhaven and the Company will rewrite your debts and name you Captain-Agent."
- **Checks:**
  - Game of Knucklebones: best of 3 contested Wis (Insight) checks versus the quartermaster.
  - Sleight of Hand DC 15 to cheat (on a failure, a bar brawl breaks out with `pirate` ×3, nonlethal).
  - Insight DC 14 spots the Saltwind agent.
- **Encounter:** `pirate` ×3 (brawl branch, nonlethal).
- **Reads:** `world.rook_status` = "in_party" (Rook is Quint's cousin-in-law, so Quint is automatically friendly).
- **Rewards:** the full Brass Parrot map; 1d6 × 10 gp in winnings.
- **Writes:** `arc.main.isles_alliance`: "red_gull", "saltwind", or "neutral".
- **Defeat:** `fished_out_by_red_gulls`.

**`gullhaven_truce`** (`gullhaven`)
- **Beats:**
  - Harbormaster Tull sells the Singing Reef chart for 100 gp, or for a favor.
  - **Saltwind path:** the hero leads a Company raid. Gullhaven is occupied, or burned if the fight goes badly.
  - **Red Gull path:** the hero defends Gullhaven from a Saltwind punitive squadron.
- **Checks:** Persuasion DC 13 lowers the chart price by half. History DC 12 identifies the Brass Parrot riddle source.
- **Encounters:**
  - Saltwind path: `pirate` ×4 and `pirate_captain` ×1 (the Gullhaven militia boss, "Iron Jenny").
  - Red Gull path: `guard` ×4, `warrior_veteran` ×1 and `scout` ×2 (marines).
- **Reads:** `arc.main.isles_alliance`.
- **Rewards:** the reef chart (removes the navigation check at the reef); a `ring_of_swimming` (Tull's gift, Red Gull path) **or** a Saltwind letter of marque (Saltwind path; −20% prices at Company shops). **[LEVEL 4]**.
- **Writes:** `arc.main.gullhaven_fate`: "free", "occupied", or "burned". Rep changes as per the side chosen: +20 to the ally, −20 to the enemy faction.
- **Defeat:** `fished_out_by_red_gulls` (Red Gull path) or `thrown_in_fort_kestrel` (Saltwind path).

**`wreckers_cove_caves`** (`wreckers_cove`)
- **Beats:**
  - The Red Gull loot-caves, where Vey's Choir smugglers have a stash room.
  - "Something that eats the careless" is a `mimic` posing as a treasure chest.
  - The Choir ledger is found here.
- **Checks:**
  - Perception DC 14 spots false lights and tide timing.
  - Athletics DC 13 climbs out before the tide (a timer of 6 rounds after the alarm).
  - Investigation DC 12 reads the ledger's cipher (auto if Aurek or a wizard is present).
- **Encounter:** `bandit` ×3, `bandit_captain` ×1 (Vey's first mate, "Salt-Eye Mora"), and `mimic` ×1.
- **Reads:** `arc.main.isles_alliance` = "red_gull" (Red Gull guards let the hero in; the stash is unguarded by pirates).
- **Rewards:** the Choir ledger; 150 gp in stashed loot (the Red Gulls expect a 50% share, or rep `red_gull_brotherhood` −10).
- **Writes:** `arc.main.choir_ledger_found`.
- **Defeat:** `robbed_and_left` (wake on a sandbar at low tide).

**`singing_reef_lagoon`** (`singing_reef`)
- **Beats:**
  - The coral spires hum.
  - The sea hag "Auntie Brackwater" guards the Singing Tooth in her lagoon hut.
  - She bargains: the Tooth for "one year of your memories" (lose 1 skill proficiency of the player's choice until the personal quest in Ch5 restores it), or a fight.
- **Checks:**
  - Navigation (Wis + navigator's tools, or Survival) DC 15 without the chart. On a failure, the ship takes a hull breach and the lagoon fight starts with the party split.
  - Wis save DC 12 versus the reef's song. On a failure, the character is charmed and must walk toward the water on its first turn.
- **Encounter:** `sea_hag` ×1 and `merrow` ×2. Add `reef_shark` ×2 if Vey arrived first.
- **Rewards:** the Singing Tooth; a pearl (100 gp); `potion_of_water_breathing` ×1.
- **Writes:**
  - `arc.main.tooth_reef_holder`: "player", "choir" if the race was lost, or "red_gull" if Quint took it.
  - `arc.main.hag_bargain` (true if the hero traded memories).
- **Defeat:** `fished_out_by_red_gulls`, but the hag keeps a memory anyway, which sets `arc.main.hag_bargain` = true.

**`brass_parrot_vault`** (`isle_of_brass_parrots`)
- **Beats:**
  - Jungle, clockwork parrots squawking riddles, and a volcano vault.
  - Captain Vey's Choir expedition is digging.
  - Three riddle-doors lead to the treasure and the Brass Tooth.
- **Checks:**
  - Riddle-doors ×3: each is Int (Investigation) or Int (History) DC 13. On a failure, a trap triggers: 2d6 fire damage, Dex save DC 13 for half.
  - Survival DC 12 crosses the jungle in 1 day instead of 2.
- **Encounter:**
  - Vault guardians: `animated_armor` ×2 and `animated_flying_sword` ×3 (the "brass parrots").
  - Then Vey: `bandit_captain` ×1 and `cultist` ×3.
- **Reads:** `arc.main.isles_alliance`. On the Red Gull path, Quint's crew holds the beach (no second wave of cultists). On the Saltwind path, Company marines arrive and claim the treasure.
- **Rewards:** the Brass Tooth. The Brass Parrot treasure (1,000 gp in gems) is split according to the alliance. `cape_of_the_mountebank` (the tinkerer's cape). **[LEVEL 5]** at chapter end.
- **Writes:**
  - `arc.main.tooth_parrot_holder`.
  - `arc.main.parrot_treasure`: "player", "red_gull", "saltwind", "choir", or "unclaimed" if the hero never went.
  - `arc.main.harrow_vey_fate`: "killed", "captured", or "escaped". It can also be set in `pells_reckoning`.
- **Defeat:** `captured_by_choir` (Vey's brig; escape during a storm).

**`pells_reckoning`** (`port_sorrel`)
- **Beats:**
  - The chapter climax. The hero confronts Governor Pell with the evidence.
  - The Choir strikes the harbor to silence him.
  - Pell can be:
    - Exposed: arrested by his own Company, if the evidence is presented to the Saltwind board.
    - Allied: he flips on the Choir in exchange for silence, which the Saltwind path permits.
    - Killed.
    - Fled.
- **Checks:**
  - Intimidation DC 15 or presenting the ledger (automatic) forces Pell's confession.
  - Persuasion DC 14 convinces the Saltwind board.
  - Athletics DC 14 catches a fleeing Pell.
- **Encounter:** Harbor strike: `cultist_fanatic` ×2, `cultist` ×4, and `bandit_captain` ×1 (Vey, if `arc.main.harrow_vey_fate` = "escaped", now upgraded to a `pirate_captain`). On the Saltwind path, `guard` ×2 allies join the hero.
- **Reads:**
  - `arc.main.choir_ledger_found` and `arc.main.almoner_seal_seen`: with both, Pell's confession is automatic.
  - `arc.main.isles_alliance`.
  - `arc.main.harrow_vey_fate`.
  - `world.rook_loyalty` and `world.rook_status`: this is Rook's betray point (§11).
- **Rewards:**
  - Pell's letters, which point to "S.V., the Almonry, Highcrown". This counts as physical evidence and as the confirmation of clue 2 or 3 if either was missed.
  - 200 gp (a board reward).
- **Writes:**
  - `arc.main.pell_fate`: "exposed", "allied", "dead", or "fled".
  - `arc.main.harrow_vey_fate`.
  - `arc.main.gullhaven_fate` (if the board lifts or maintains the occupation).
  - `world.player_outlawed` = true if the hero killed Pell publicly, or fought Company marines on the Red Gull path.
- **Defeat:** `thrown_in_fort_kestrel`. Pell flees during the confusion, so `arc.main.pell_fate` = "fled".
- **Hook to Ch3:** "S.V., the Almonry, Highcrown." The Queen herself summons the hero (if Crown rep ≥ 0 and not outlawed), or the hero must sneak into Highcrown as a wanted outlaw.

**Key beats and triggers.**
- *The Race* starts on leaving `gullhaven_truce`.
- *Rook's gamble*: at `pells_reckoning`, if `world.rook_loyalty` ≤ 20, Rook betrays the party.
- *A storm-season event* on sea routes in Longlight to Leaffall: 50% chance of +1 day, which can cost the race.

**Faction tension.**
- The Saltwind path makes the Red Gulls and Tidewright hostile. Gullhaven closes as a safe house, and Rook's loyalty drops by 20.
- The Red Gull path costs rep `crown_of_aurelmark` −10 and `ironvault_consortium` −10 (the Crown's allies). The Ch3 audience is colder, and the Ironvault Consortium demands restitution.

**Flags that visibly change later chapters:**
- `arc.main.isles_alliance` decides whether the Saltwind fleet or the Red Gull flotilla joins `dawnspire_muster`. It also sets the Ch3 reception at court.
- `arc.main.pell_fate` = "allied" means Pell sends Saltwind gunpowder to Ch4. "fled" makes him a side-quest target.
- `arc.main.harrow_vey_fate` = "escaped" means Vey returns in `highcrown_burning`, ferrying Choir troops.
- `arc.main.hag_bargain` means the hag appears in Ch5 `blightwood_crossing` as a night hag's sister and offers the memory back for a price.

---

## 8. Chapter 3: The Gilded Lie (`ch3_the_gilded_lie`, Level 5–7, Aurelmark)

**Summary.** The tone turns to high fantasy and court intrigue. The trail leads to Highcrown's golden salons. The hero must:
- Assemble proof against the Royal Almoner.
- Recover the Sky Tooth and the lost lance Dawnbreaker from the Ruins of Old Vaelthorn before Vosk the Hollow does.
- Unmask the Cantor at the Almoner's midsummer masque.

Whatever happens, the Cantor escapes to begin her endgame. What matters is what she leaves behind: a poisoned Queen, a stolen Tooth, and a public that believes the hero or doesn't.

**Chapter NPCs:**
- Lore: Queen Isolde Varannis, Lord-Commander Aldric Thane, Guildmistress Brunhild Ashgrove.
- New:
  - Lady Seraphine Vell (the Cantor): `noble` in public.
  - Aurek Vell: companion; see §11.
  - Vosk the Hollow: `mage`.
  - Chamberlain Oberin Hale: `noble`. Pompous, loyal, and suspicious of the hero.

### Scenes

**`highcrown_audience`** (`highcrown`)
- **Beats:**
  - An audience with Queen Isolde in the Tower Hall. Seraphine stands at her side, kind and helpful. She "offers the Almonry's full aid" and asks to see any Teeth "for safekeeping."
  - Aurek, a young Veyran scholar, approaches the hero afterwards about "strange readings" from his aunt's library.
- **Checks:**
  - Persuasion DC 14 obtains a royal warrant to investigate.
  - Insight DC 16 notices Seraphine's too-eager interest in the Teeth.
  - Persuasion DC 12 recruits Aurek (auto if the hero shows a Tooth: "it's in my aunt's books!").
- **Encounter:** none. If `world.player_outlawed` is true, there is an arrest at the gate instead: `guard` ×4 and `knight` ×1, which can be avoided with Deception DC 15, Stealth DC 15, or Corwin vouching (loyalty ≥ 50).
- **Reads:**
  - `arc.main.isles_alliance`: "saltwind" earns a warm welcome and a free warrant. "red_gull" makes the hero a suspect; Persuasion DC +3.
  - `arc.main.pell_fate`: "exposed" lets the Queen commend the hero, giving rep `crown_of_aurelmark` +10.
  - `world.player_outlawed`.
  - `arc.main.tooth_want_holder` = "choir": Seraphine greets the hero with "we have met, in a sense," a chilling hint.
- **Rewards:** a royal warrant (DCs −2 for official inquiries this chapter); Aurek joins.
- **Writes:**
  - `world.aurek_status` ("in_party" or "met").
  - `world.aurek_loyalty` = 50.
  - `world.player_outlawed` (cleared if the Queen pardons the hero on Persuasion DC 18).
- **Defeat:** `thrown_in_fort_kestrel`, adapted as the Highcrown dungeons: the same outcome with a different cell location.

**`deepanvil_ledgers`** (`deepanvil_hold`)
- **Beats:**
  - Guildmistress Ashgrove holds the Crown's debts. The Almonry has been borrowing enormous sums against the royal seal, and the money flows to Port Sorrel and to "deep-mine excavations."
  - She'll open the books only if the Crown's overdue debt is addressed, or for a favor: clear the sealed deep mine where "diggers in black" broke in.
- **Checks:**
  - Investigation DC 15 on the ledgers (adv: `arc.main.choir_ledger_found`, for cross-referencing).
  - Persuasion DC 16 to open them without the favor. With the royal warrant the DC is 13, but that angers Ashgrove: rep `ironvault_consortium` −10.
- **Encounter (the sealed mine):** `grick` ×2, `rust_monster` ×1 and `grimlock` ×4 (Choir-blinded delvers).
- **Reads:** `arc.main.isles_alliance` = "red_gull" (the Consortium demands 300 gp restitution before any dealings, or Persuasion DC 18).
- **Rewards:** the money trail (evidence); `dwarven_thrower` or `adamantine_armor` (a Consortium favor reward, for the player's choice of chain mail or breastplate); rep `ironvault_consortium` +20.
- **Writes:** `arc.main.money_trail_proven`.
- **Defeat:** `dragged_to_safety` (dwarven miners haul the party out).

**`vaelthorn_sky_towers`** (`ruins_of_old_vaelthorn`)
- **Beats:**
  - The broken imperial sky-towers.
  - Constructs still guard the Vault of Oaths, where Dawnbreaker and the Sky Tooth lie together. The first oath-knights sealed the Tooth under the holy lance.
  - Vosk the Hollow and his cultists are already climbing.
- **Checks:**
  - Athletics DC 14 ×2 climbs between towers. On a failure, take 3d6 falling damage and lose the lead to Vosk.
  - Arcana DC 15 disables the tower wards. Without it, one `shield_guardian` activates.
  - Religion DC 13 recites the First Oath (auto if Corwin is in the party) to lift the lance.
- **Encounter:** `animated_armor` ×3 and `shield_guardian` ×1 (if the wards are not disabled). Then Vosk: `mage` ×1 and `cultist_fanatic` ×2. **[LEVEL 6]** after this scene.
- **Reads:** `world.corwin_status` = "in_party" (the Oath is automatic, and Corwin's personal quest advances).
- **Rewards:** Dawnbreaker (a `dragon_slayer` lance; the only lance version in the campaign), the Sky Tooth, and Vosk's notes (clue 7).
- **Writes:**
  - `arc.main.tooth_vaelthorn_holder` ("player", or "choir" if Vosk escapes with it).
  - `arc.main.dawnbreaker_holder` ("player", or "choir" if Vosk wins the race).
  - `arc.main.vosk_fate` ("killed", "captured", "escaped").
- **Defeat:** `left_for_dead`. Vosk takes the Tooth, which becomes "choir", but cannot lift Dawnbreaker, which stays "player" when the party wakes.

**`dawnspire_vigil`** (`dawnspire_keep`)
- **Beats:**
  - The hero brings Dawnbreaker to Lord-Commander Thane.
  - Choice: return the lance to the Order (Dawn Lance allies in Ch4 and Ch5) or keep it (a personal weapon for the Pyrraxis fight).
  - At night, Choir assassins strike to silence the hero before the masque.
  - Corwin's leave point.
- **Checks:**
  - Persuasion DC 15 has Thane reinstate Corwin (auto if the lance is returned).
  - Perception DC 15 senses the assassins (a surprise round).
- **Encounter:** `spy` ×2, `cultist_fanatic` ×2 and `shadow` ×2 (Choir night-hymn summoning).
- **Reads:**
  - `arc.starter.pip_rescued`: Pip is now a page at Dawnspire. He wakes the hero before the assassins arrive, so there is no surprise.
  - `arc.main.dawnbreaker_holder`.
  - `world.corwin_loyalty` and `world.corwin_status`.
- **Rewards:**
  - If the lance is returned: rep `order_of_the_dawn_lance` +25 and `+1 war council ally` banked for Ch4.
  - If kept: the player wields Dawnbreaker.
- **Writes:**
  - `arc.main.dawnbreaker_holder` ("dawn_lance" or "player").
  - `world.corwin_quest_done` (if knighted).
  - `world.corwin_status` = "left" (at the leave point).
- **Defeat:** `dragged_to_safety` (the knights carry the hero to the chapel; Pip is wounded, which is a scar story beat).

**`almoners_masque`** (`highcrown`)
- **Beats:**
  - The midsummer masquerade at the Almonry.
  - The hero moves among nobles. Seraphine sings for the guests, and her voice is *the* voice.
  - The hero may accuse her publicly (needs 3 clues), confront her privately, or play along.
  - This is Aurek's betray point.
- **Checks:**
  - Insight DC 17 recognizes the voice (DC 12 with `arc.starter.dream_heard`).
  - Performance DC 14 or Deception DC 14 blends in, avoiding Choir notice.
  - Persuasion DC 15 makes the public accusation. With 3 clues it is automatic; with 2 it is DC 15; with fewer it fails.
- **Encounter:** none unless the accusation fails. Then the palace guard seizes the hero: `guard` ×6 and `knight` ×2, nonlethal. Fleeing is an option.
- **Reads:**
  - `arc.starter.dream_heard`, `arc.main.almoner_seal_seen`, `arc.main.choir_ledger_found`, `arc.main.money_trail_proven`, `arc.main.sallow_fate`, `arc.main.vosk_fate`.
  - `world.aurek_loyalty` and `world.aurek_status`.
- **Writes:**
  - `arc.main.cantor_identity_known`.
  - `arc.main.cantor_unmasked_publicly`.
  - `world.player_outlawed` (on a failed accusation).
  - `arc.main.cantor_warned` (if Aurek betrays).
- **Defeat:** `thrown_in_fort_kestrel` (the Highcrown dungeons variant; Aurek visits if loyalty ≥ 50 and frees the hero).

**`palace_undercroft`** (`highcrown`)
- **Beats:**
  - Unmasked, whether publicly or when she realises the hero knows, Seraphine flees through the palace catacombs. Her parting act: she infects Queen Isolde with a concentrated dose of the Sickness.
  - **Branch point:** save the Queen, or pursue the Cantor to retake a Tooth.
    - Pursuing retakes one Choir-held Tooth, or saves a carried Tooth if she grabs one. Also, Liesel's locket falls from Seraphine's cloak.
    - Saving the Queen requires Medicine DC 18 (auto if `world.sickness_cure` = "briarkin_cure" or `arc.main.cure_recipe`).
- **Checks:** Medicine DC 18; Athletics or Acrobatics DC 15 ×3 for the chase.
- **Encounter:** `ghast` ×2, `cultist_fanatic` ×2 and `shadow` ×2 in the catacombs. If `arc.main.cantor_warned` is true, the Cantor is already gone: the fight is an ambush with `ghast` ×1 extra and no chase.
- **Reads:** `arc.main.cantor_warned`, `world.sickness_cure`, `arc.main.cure_recipe`, `arc.main.cantor_identity_known`.
- **Rewards:** Liesel's locket (chase branch, a redemption key); **[LEVEL 7]**.
- **Writes:**
  - `world.queen_alive`: false if she is not saved. She dies in `highcrown_burning` unless saved before the end of that scene. Medicine can be retried there at DC 20.
  - One Tooth holder flag, if retaken (the choice of which is scripted: the most recently lost Tooth).
- **Defeat:** `dragged_to_safety`. The Cantor escapes; the Queen is saved by court physicians only if the cure is known.
- **Hook to Ch4:** Seraphine's escape note: "The dragon will do what the Choir cannot. Hungry things always come home." Pyrraxis stirs in the Emberpeaks.

**Faction tension.**
- Pressing the Consortium with a royal warrant costs Ironvault rep.
- Keeping Dawnbreaker offends the Dawn Lance (rep −15), but gives a stronger player.
- A failed public accusation outlaws the hero from Crown lands until Ch4, when Seraphine's flight clears them if the Queen lives.

**Implementation choices (adventure JSON, `data/adventures/arc1/ch3_the_gilded_lie.json`):**
- The chapter endings are `court_unmasked` (public unmasking), `court_secret` (identity known privately), `court_hunted` (still outlawed) and `court_vanished` (identity never learned).
- The race for the Vault: 4 days after the audience, Vosk empties the Vault if the hero has not started the climb. Then the Sky Tooth and Dawnbreaker both become "choir". A failed climb also loses the race: Vosk reaches the Vault first and must be beaten there to recover both.
- Handing a Tooth to Seraphine "for safekeeping" in `highcrown_audience` sends it to the Choir. The chase in `palace_undercroft` retakes the Sky Tooth first, then an entrusted Tooth, then older Choir-held Teeth, newest chapter first. The chase needs 2 of 3 checks.
- Dawnbreaker (`dragon_slayer`) enters the inventory only when the hero keeps it at Dawnspire, because outcomes cannot remove items.
- Liesel's locket is the chapter-local flag `~ch3_locket`, set by a won chase. Ch5 (`choir_of_teeth`) reads it.

**Flags that visibly change later chapters:**
- `arc.main.dawnbreaker_holder` changes the Pyrraxis options and the finale seal strength.
- `world.queen_alive` changes Ch4's defence of Highcrown and the endings.
- `arc.main.cantor_unmasked_publicly` changes whether the Crown musters openly in Ch4 or the hero must gather allies secretly.
- `arc.main.vosk_fate` = "escaped" means Vosk commands the dragon-callers at `emberpeak_ascent`.

---

## 9. Chapter 4: Wyrmfire (`ch4_wyrmfire`, Level 7–9, Aurelmark)

**Summary.** The Ember Tooth has been lodged in Pyrraxis since the Ashfall Winter. An older Choir cell (the young Seraphine's first masters) had secretly set the Tooth into the tip of the lance the Dawn Lance carried into battle. When Aldric Thane's strike wounded the dragon, the Tooth broke off inside her. The Tooth is why the dragon's wound never healed, and why it hungers. The Cantor's agents now "sing" to the Tooth, driving Pyrraxis mad to burn Highcrown. At the same time, a Choir coup rises in the capital. The hero must:
- Gather the realm (a war council).
- Face Pyrraxis in her lair: slay her, free her, or bargain with her.
- Save the capital.

This chapter pays off the most earlier flags.

### Scenes

**`ashfall_road`** (`brightwater`)
- **Beats:**
  - Refugees stream north from burned farms.
  - Choir "ember-singers" herd them toward the fires.
  - The first sight of Pyrraxis overhead (a Wis save DC 15 versus frightened; this is narrative, with no combat).
- **Checks:** Survival DC 14 leads the refugees to safety via the river. Persuasion DC 13 calms the panicking crowd.
- **Encounter:** `cultist_fanatic` ×2, `magma_mephit` ×4 and `hell_hound` ×1.
- **Reads:** `world.player_outlawed` (Crown patrols won't help the hero).
- **Rewards:** 150 gp from grateful barge-masters. Rep `crown_of_aurelmark` +10.
- **Writes:** none (a flavour scene; the refugees' fate feeds the epilogue via rep).
- **Defeat:** `left_for_dead`.

**`millbrook_remembers`** (`millbrook`)
- **Beats:** Millbrook is in the dragon's path. This is the most flag-reactive scene in the game:
  - If `arc.starter.captives_saved` ≥ 3 and `arc.starter.reeve_attitude` = "friendly": Reeve Tamsin has raised a militia. The villagers give supplies and a hay-wagon firebreak, and the defence is easy.
  - If `arc.starter.marrow_ring_returned`: Widow Marrow gives her late husband's `potion_of_heroism` ×2 ("he'd want it used on someone brave").
  - If `arc.starter.pip_rescued`: Pip (a page) rides in with a Dawn Lance message.
  - If `arc.starter.captives_saved` ≤ 1 or `arc.starter.reeve_attitude` = "hostile": the village has turned to the Choir out of despair. Choir-converted villagers must be subdued without killing (Persuasion DC 15 to break the Choir's hold on each group of three).
- **Checks:**
  - Persuasion DC 15 (the converted branch).
  - History DC 10 remembers the barrow's old Thaloren wards, which can be re-lit against fire. It is automatic if `arc.starter.shrine_rekindled`.
- **Encounters:**
  - Faithful branch: `hell_hound` ×2 raiding.
  - Converted branch: `commoner` ×6 (nonlethal only), `cultist_fanatic` ×1 and `hell_hound` ×2.
- **Reads:** `arc.starter.captives_saved`, `arc.starter.reeve_attitude`, `arc.starter.marrow_ring_returned`, `arc.starter.pip_rescued`, `arc.starter.shrine_rekindled`.
- **Rewards:** the Millbrook militia (a war council bonus); potions as above.
- **Writes:** `arc.main.millbrook_militia` (true if the village fights for the hero).
- **Defeat:** `dragged_to_safety` (villagers hide the hero in the mill cellar).

**`dawnspire_muster`** (`dawnspire_keep`)
- **Beats:**
  - The council of war. Each ally present adds 1 to `arc.main.war_council_allies`.
  - Each ally gives a concrete benefit at Emberpeak or Highcrown:
    - Ballista or artillery support: 2d10 damage to Pyrraxis each round for 3 rounds.
    - Reinforcements in `highcrown_burning`.
    - Or a safe house.
- **Allies and their conditions:**
  1. **Dawn Lance:** rep `order_of_the_dawn_lance` ≥ 20, or `arc.main.dawnbreaker_holder` = "dawn_lance". This gives knights at Highcrown.
  2. **Crown:** `world.queen_alive`, or `arc.main.cantor_unmasked_publicly`. This gives the royal guard.
  3. **Ironvault:** `arc.main.money_trail_proven`, and rep `ironvault_consortium` ≥ 0. This gives dwarven ballistae at Emberpeak.
  4. **Isles fleet:** `arc.main.isles_alliance` ≠ "neutral". Saltwind gunpowder (doubled if `arc.main.pell_fate` = "allied") or Red Gull flotilla fire-ships on the river. This gives artillery.
  5. **Millbrook:** `arc.main.millbrook_militia`. This gives firebreaks, so Highcrown fire damage is halved.
  6. **Treasure:** `arc.main.parrot_treasure` = "player". The hero can hire the Deepanvil mercenaries (`warrior_veteran` ×4 allies).
- **Checks:** Persuasion DC 16 persuades one reluctant ally if its condition fails by a single step, such as rep being below threshold.
- **Encounter:** none.
- **Reads:** all of the above, plus `world.player_outlawed` (the Crown ally is lost unless the hero is pardoned), `arc.starter.pip_rescued` (Pip carries messages, a free Persuasion reroll), and `arc.main.gullhaven_fate`.
- **Writes:** `arc.main.war_council_allies` (a number from 0 to 6).
- **Defeat:** n/a.

**`emberpeak_ascent`** (`emberpeak`)
- **Beats:**
  - The climb up the volcanic slopes, past the melted armor of failed heroes.
  - A Choir camp of dragon-callers "sings" the Tooth into rage.
  - Scars likely.
- **Checks:**
  - Group Athletics DC 15 climbs.
  - Con save DC 13 per hour against extreme heat (1 level of exhaustion on a failure; fire resistance negates it).
  - Stealth DC 16 reaches the singers unseen.
- **Encounter:** `salamander` ×2 and `fire_elemental` ×1 at the lava tubes. The Choir camp: `mage` ×1 (Vosk, if `arc.main.vosk_fate` = "escaped"; else a Choir cantor-mage) and `cultist_fanatic` ×3.
- **Reads:** `arc.main.vosk_fate`, `arc.main.war_council_allies` (Ironvault ballistae destroy the camp's defences, removing 1 `cultist_fanatic`).
- **Rewards:** Vosk's song-stone (disrupting it gives Pyrraxis −2 to attacks next scene); `potion_of_resistance` (fire); **[LEVEL 8]**.
- **Writes:** `arc.main.vosk_fate` (if Vosk is here).
- **Defeat:** `left_for_dead` (dragonfire scar; the hero wakes at the mountain's foot).

**`pyrraxis_hoard`** (`emberpeak`)
- **Beats:**
  - Pyrraxis in her lair: vast, wounded, maddened. The Ember Tooth glows in the scar on her breast.
  - Her brood-wyrmling guards the hoard.
- **Three solutions:**
  1. **Slay.** A combat set-piece: `adult_red_dragon` ×1, with "wounded" modifiers:
     - She starts at 60% HP.
     - She has no Legendary Resistance.
     - She has 2 legendary actions instead of 3.
     - Each war-council artillery ally deals 2d10 per round for 3 rounds.
     - Dawnbreaker (`dragon_slayer`) is available if `arc.main.dawnbreaker_holder` is "player" or "dawn_lance". With "dawn_lance", Thane's knights bring it and a knight wields it as an ally.
  2. **Free.** Draw the Tooth out of the wound. This takes 3 successes before 3 failures on Medicine DC 18, Religion DC 18, or Athletics DC 20. Each attempt provokes a claw attack. Freed, Pyrraxis regains her mind and leaves Orrimar ("the debt is paid, small thing"). This is a hard but merciful path.
  3. **Bargain.** Persuasion DC 20 (adv: carrying ≥ 3 Teeth, because she hungers for them). She takes one of the party's Teeth *other than* the Ember Tooth as the price and spits out the Ember Tooth. That traded Tooth becomes "choir" (she flies to the Maw to devour it, and the Cantor recovers it).
- **Encounter (all paths, to reach her):** `young_red_dragon` ×1 (the brood-guardian). The slay path adds `adult_red_dragon` ×1.
- **Reads:** `arc.main.dawnbreaker_holder`, `arc.main.war_council_allies`, `world.corwin_status` (Corwin can take Dawnbreaker's blow; his loyalty gives +1 to the attack).
- **Rewards:** the Ember Tooth. The hoard: 2,500 gp, `flame_tongue`, `ring_of_resistance`, and `dragon_scale_mail` (slay path only).
- **Writes:**
  - `arc.main.pyrraxis_fate`: "slain", "freed", "bargained", or "raging" if the party is defeated or flees.
  - `arc.main.tooth_ember_holder`.
- **Defeat:** `dragons_disdain`. Pyrraxis stays "raging" and burns Highcrown next scene; the Ember Tooth becomes "choir".

**`highcrown_burning`** (`highcrown`)
- **Beats:**
  - The chapter climax. The Choir coup: the palace is seized by converted nobles and Vosk's or Vey's troops.
  - If Pyrraxis is raging, the tiers burn.
  - The Queen, if alive and still sick, must be saved (the second Medicine chance, DC 20). Isolde, recovered, writes a letter of forgiveness to Seraphine, which is a redemption key.
- **Checks:**
  - Medicine DC 20 (the Queen).
  - Athletics DC 15 ×2 to clear burning streets (halved by the Millbrook firebreak).
- **Encounter:** `wight` ×1, `ghast` ×3 and `cultist_fanatic` ×2. Add `pirate_captain` ×1 (Vey) if `arc.main.harrow_vey_fate` = "escaped". Add `mage` ×1 (Vosk) if `arc.main.vosk_fate` = "escaped". Allies from the war council join as friendly units. If `arc.main.pyrraxis_fate` = "raging": a fire hazard applies (2d6 fire per round in marked squares), and the dragon strafes once per 3 rounds for 4d10 fire (Dex save DC 17 for half).
- **Reads:** `arc.main.pyrraxis_fate`, `arc.main.war_council_allies`, `arc.main.millbrook_militia`, `arc.main.harrow_vey_fate`, `arc.main.vosk_fate`, `arc.main.cantor_unmasked_publicly`, `world.queen_alive`, `world.player_outlawed`, `arc.main.tooth_ember_holder`.
- **Rewards:**
  - A royal pardon (clears `world.player_outlawed`), if the Queen is alive.
  - Isolde's letter (a redemption key).
  - Rep `crown_of_aurelmark` +30.
  - **[LEVEL 9]**.
- **Writes:** `world.queen_alive`, `world.player_outlawed`, `arc.main.vosk_fate`, `arc.main.harrow_vey_fate`.
- **Defeat:** `dragged_to_safety` (the royal guard pulls the hero from the fire). The Queen dies if she was still sick.
- **Hook to Ch5:** The Choir retreats with every Tooth it holds. The Gloamfen sky turns black: the Choir of Teeth has begun at the Maw.

**Faction tension.** The war council forces priorities. Each ally's condition depends on an earlier choice, so helping one faction in Ch1–3 visibly adds or removes an army here.

**Implementation choices (adventure JSON, `data/adventures/arc1/ch4_wyrmfire.json`):**
- The chapter endings are `crown_endures` (palace retaken, the Queen lives), `regency_council` (palace retaken, the Queen dead), `crown_in_ashes` (palace retaken while Pyrraxis rages) and `highcrown_fallen` (the coup fight is lost).
- The Millbrook race uses the `since` condition: the hero sees Pyrraxis on arriving at `ashfall_road`, and Millbrook burns if the hero arrives more than 24 hours later (via Dawnspire it is always too late). A burned Millbrook gives no militia.
- Millbrook has three branches: faithful (as designed), converted (as designed; Persuasion DC 15 per group of three, one try each, counted by the number flags `~ch4_hold_tries` and `~ch4_groups_freed`), and a new "wavering" middle branch (neither condition holds) where Persuasion DC 15 can still raise the militia. Freeing both converted groups and beating the fanatic also raises the militia. Without the wards, the lone defence costs 2d6 fire (Dex DC 13 half).
- War council: each ally sets a local `~ch4_ally_*` flag and adds 1 to `arc.main.war_council_allies`. Near misses (Persuasion DC 16, advantage when Pip carries messages): the Dawn Lance at rep 0–19 or when the hero holds Dawnbreaker; the Crown when the hero knows the Cantor privately; Ironvault at rep −20 to −1; Oswin Tull's Tidewright fire-barges when the isles stayed neutral and Gullhaven is free. The Deepanvil mercenaries can also be hired for 1,500 gp. The quartermaster sells one `potion_of_resistance` (300 gp) that negates the Emberpeak heat save.
- Artillery (the Ironvault or isles ally) cannot yet deal per-round damage to Pyrraxis (no `statOverrides`). Instead it drives off the brood-guardian, and the Ironvault ballistae remove one `cultist_fanatic` from the singers' camp. Pyrraxis's "wounded" modifiers are terrain notes for now.
- The Free path is a skill challenge with the number flags `~ch4_free_successes` and `~ch4_free_failures`. Every attempt draws a claw (2d6+4 slashing, Dex DC 15 half). Silencing the song-stone gives advantage on every attempt. Three failures end the Free option (slay, bargain or retreat remain).
- The Bargain lets the player choose which carried Tooth to pay. Retreating from the lair, or losing to the brood-guardian or Pyrraxis, sets "raging" and gives the Ember Tooth to the Choir.
- At Highcrown, Vey (court) and Vosk (grand stair) each hold a room of the palace map before the throne hall, instead of joining the main fight. The throne-hall fight takes one war-council contingent as allies (the Dawn Lance's `knight` ×3, the royal guard's `guard` ×4 or the Deepanvil `warrior_veteran` ×4). A raging Pyrraxis strafes the party once on arrival (4d10 fire, halved by Millbrook's firebreak).
- A Queen who is still sick (`world.queen_alive` false after Ch3) gets the DC 20 Medicine retry (automatic with the fen cure). A deadline of 2 days runs from the lair; missing it, losing the palace, or failing the check kills her (`~ch4_queen_dead`).
- Isolde's letter of forgiveness is the chapter-local flag `~ch4_isolde_letter`, available when the Queen lives and knows who the Cantor is. Ch5 (`choir_of_teeth`) reads it.
- A disloyal Corwin (loyalty ≤ 20) stays with the Dawn Lance at `dawnspire_muster` and appears as a friendly NPC at Highcrown.
- Level milestones are XP beats: +11,000 when the Emberpeak camp is resolved (level 8) and +14,000 when Highcrown is resolved (level 9).
- Maps: `emberpeak_lair` (scorched slope, lava tubes, singers' crater, brood ledge, hoard) and `highcrown_palace` (Queen's Gate, palace court, grand stair, throne hall). Fights happen in their own rooms.

**Flags that visibly change later chapters:**
- `arc.main.pyrraxis_fate` and `arc.main.tooth_ember_holder` decide whether the dragon and the Ember Tooth await the hero at the Maw.
- `world.queen_alive` and `~ch4_isolde_letter` open the redemption parley and decide the ending.
- `arc.main.war_council_allies` changes the Ch5 siege of Lantern Hold.

---

## 10. Chapter 5: The Hungering Dark (`ch5_the_hungering_dark`, Level 9–10, Gloamfen)

**Summary.** The finale returns to where the arc began, the fen. Lantern Hold is besieged by the plague-dead. The Blightwood's paths writhe. The Drowned Abbey's bells might weaken the Maw. At the bottom of the Maw, the Cantor conducts the Choir of Teeth. Every Tooth the party and its allies bring is a key to sealing the Maw, and a prize the Cantor can steal.

### Scenes

**`lantern_hold_siege`** (`lantern_hold`)
- **Beats:**
  - The plague-dead besiege the Hold.
  - Who defends it depends on Ch1:
    - `arc.main.hollowmere_fate` = "cured": Briarkin and cured Hollowmere folk fight alongside Grell. Their losses are low, and they give an extra ally.
    - "purged": Grell's Wardens stand alone and exhausted, and the Briarkin refuse aid.
    - "abandoned": Hollowmere's converts are *among the attackers* (add `ghoul` ×2).
  - If `arc.main.sallow_fate` = "escaped", Sallow leads the siege.
- **Checks:**
  - Group Athletics DC 14 carries lantern-oil to the walls.
  - Persuasion DC 15 rallies the Wardens (adv if `arc.main.tooth_want_holder` = "wardens", because the Wardens trust the hero).
- **Encounter:** `ghoul` ×4, `ghast` ×2 and `wight` ×1. Add `cultist_fanatic` ×1 (Sallow) if she escaped.
- **Reads:** `arc.main.hollowmere_fate`, `arc.main.sallow_fate`, `arc.main.tooth_want_holder`, `arc.main.wick_fate`, `world.sickness_cure`, `arc.main.war_council_allies` (≥ 4: Dawn Lance knights arrive in round 3).
- **Rewards:** the Wardens' Maw map (removes the navigation check in `maw_descent`); `potion_of_healing_greater` ×3.
- **Writes:** `arc.main.lantern_hold_held`. Warden-held Teeth now travel with the party.
- **Defeat:** `rescued_by_briarkin` if `arc.main.hollowmere_fate` = "cured", otherwise `temple_revival`. The Hold falls: `arc.main.lantern_hold_held` = false.

**`blightwood_crossing`** (`blightwood`)
- **Beats:**
  - Grey trees weeping black sap. The paths change after dark.
  - The hag's sister stalks the party.
  - This is Nettle's homeland-in-grief.
- **Checks:**
  - Survival DC 16 (by day DC 13; auto with Nettle or Wick's guidance when `arc.main.wick_fate` = "ally").
  - Wis save DC 15 versus the Blightwood's whispers.
- **Encounters:**
  - `worg` ×4 (the many-eyed wolves) and `shambling_mound` ×1.
  - At night, `night_hag` ×1. She offers to return the hag's stolen memory if `arc.main.hag_bargain` is true, in exchange for a Tooth. Refusing leads to combat.
  - If `arc.main.wick_fate` = "burned": Briarkin curse-hunters join the enemies (`scout` ×3).
  - If `world.briarkin_favor_owed` is true, Wick calls in her favor here: the hero must spare the shambling mound (a wood-spirit), which gives Nettle loyalty +10.
- **Reads:** `arc.main.hag_bargain`, `arc.main.wick_fate`, `world.briarkin_favor_owed`, `arc.starter.shrine_rekindled` (Thaloren's blessing gives advantage on the whisper save), `world.nettle_status`.
- **Rewards:** Nettle's personal-quest completion (see §11); the restored memory.
- **Writes:** `world.nettle_quest_done`; possibly a Tooth holder becomes "choir" (if traded to the night hag).
- **Defeat:** `left_for_dead`.

**`abbey_bells_toll`** (`drowned_abbey`) — optional, costs half a day
- **Beats:** Ringing all nine drowned bells at midnight weakens the Maw's song.
- **Checks:**
  - Religion DC 15 (auto if `arc.main.abbot_cendric_alive`, because Cendric leads the rite).
  - Athletics DC 14 ×3 (dives to the sunken bells).
- **Encounter:** `specter` ×3 and `wraith` ×1.
- **Reads:** `arc.main.abbot_cendric_alive`, `arc.main.tooth_abbey_holder` ("player" makes the bells resonate, giving advantage).
- **Rewards:** Mireth's blessing: the party gains advantage on death saves in the finale.
- **Writes:** `arc.main.abbey_bells_rung`.
- **Defeat:** `temple_revival`.

**`maw_descent`** (`the_maw`)
- **Beats:**
  - The breathing sinkhole. Spiral stairs in the Choir's sanctum.
  - Pools of black bile.
  - This is Nettle's betray point (§11).
- **Checks:**
  - Group Stealth DC 16 bypasses the sentries.
  - Con save DC 15 versus the Maw's breath (poisoned for 1 hour).
  - Navigation Survival DC 17 (auto with the Wardens' Maw map).
- **Encounter:** `chuul` ×2 in the bile pools, `cultist_fanatic` ×4 and `ghast` ×2. Add `mage` ×1 if `arc.main.vosk_fate` = "escaped" (his final stand).
- **Reads:** `arc.main.lantern_hold_held`, `arc.main.vosk_fate`, `world.nettle_status`, `world.nettle_loyalty`.
- **Rewards:** **[LEVEL 10]**; `potion_of_healing_superior` ×2.
- **Writes:** `arc.main.vosk_fate`; `world.nettle_status` ("betrayed" on the betray point).
- **Defeat:** `maws_spit`.

**`choir_of_teeth`** (`the_maw`)
- **Beats:**
  - The Cantor stands at the Jaw-Stone, with every Choir-held Tooth in its sockets.
  - Her Choir sings. The Maw breathes.
  - Seraphine speaks to the hero by name, and to Aurek if he is present.
- **Mechanics:**
  - **The Jaw-Stone.** Each round the Choir's song advances. If `arc.main.teeth_choir` reaches 7, the Maw opens at the end of that round.
  - **Hunger Pull.** Once per round at initiative 20, one party member carrying a Tooth makes a Str or Wis save DC 17. On a failure, a carried Tooth flies to the Jaw-Stone: its holder becomes "choir", and `arc.main.teeth_choir` goes up by 1. There is advantage if `arc.main.abbey_bells_rung`.
  - **Pry a Tooth.** An action adjacent to the Jaw-Stone with Athletics DC 18 pries a Tooth back.
  - **Parley.** Available when the Cantor is at or below half HP and `arc.main.cantor_identity_known` is true. See §2.3 for the conditions. Success means `arc.main.cantor_parley` = "accepted". Offering it and failing, or the hero refusing, means "refused". If never offered, the value stays "not_offered".
- **Encounter:** `archmage` ×1 (the Cantor), `gibbering_mouther` ×2 (the Maw's spittle), and `cultist_fanatic` ×2. Add `wraith` ×1 if `arc.main.teeth_choir` ≥ 5. If `world.aurek_status` = "betrayed", add `mage` ×1 (Aurek at his aunt's side). If `world.rook_status` = "betrayed", Rook appears (use `spy` ×1) and tries to steal a Tooth. He may switch sides on Persuasion DC 15.
- **Reads:** `arc.main.teeth_choir`, `arc.main.teeth_secured`, every Tooth holder flag, `arc.main.abbey_bells_rung`, `arc.main.dawnbreaker_holder`, `arc.main.cantor_identity_known`, `world.aurek_status`, `world.aurek_loyalty`, `world.rook_status`, `world.queen_alive`.
- **Writes:** `arc.main.cantor_parley`, `arc.main.cantor_fate`, every Tooth holder flag.
- **Defeat:** `maws_spit` (one retry). A second defeat leads to "escaped" for the Cantor, and the seal is computed without the party's actions.

**`maw_final_seal`** (`the_maw`)
- **Beats:** The hero places the Teeth back in reverse order.
- **Seal strength** is the sum of:
  - `arc.main.teeth_secured` (the Teeth the party or its allies hold).
  - +1 if `arc.main.abbey_bells_rung`.
  - +1 if `arc.main.dawnbreaker_holder` is "player" or "dawn_lance" (the holy lance pins the jaw).
  - +1 if `arc.main.wick_fate` = "ally" (Wick's Name-Chant), or if `world.nettle_quest_done` and Nettle is in the party (she sings it instead).
  - +1 if `world.aurek_quest_done` (the reverse-song).
  - +1 if `arc.main.lantern_hold_held` (the Wardens hold the rim).
  - +2 if `arc.main.cantor_fate` = "redeemed".
- **Outcomes:**
  - `arc.main.teeth_choir` = 7 at the end of `choir_of_teeth` means "opened".
  - Otherwise, strength ≥ 5 means "sealed", and strength ≤ 4 means "stirring".
  - If the result is "stirring" and the Cantor is not dead or captured, her fate becomes "escaped".
- **Writes:** `world.maw_state`, `arc.main.cantor_fate` (as above), `world.sickness_cure` (a "sealed" result sets it to "maw_sealed" if it was "none": the spores die with the Maw).
- **Defeat:** n/a.

**Implementation choices (adventure JSON, `data/adventures/arc1/ch5_the_hungering_dark.json`):**
- The endings are the five §12 endings with the same ids, chosen in `maw_final_seal`. None has a `next`: chapter 5 ends the campaign.
- The engine does not recompute `arc.main.teeth_secured` or `arc.main.teeth_choir` yet, so the chapter reads the seven holder flags directly. "Opened" means all seven holders are "choir"; the wraith joins at five or more; the seal counts one point per secured holder in the local number flag `~ch5_seal`, filled by beats on entering `maw_final_seal`. Unclaimed Teeth count for neither side.
- Every Tooth theft (a failed Hunger Pull, Nettle's betrayal, Rook's theft, each Maw's-spit defeat) takes the lowest-numbered carried Tooth in §3 table order, through event flags `~ch5_take_<event>`. Each event takes at most one Tooth.
- Siege: one "Hold the walls" action; beats pick one of twelve encounter variants from Hollowmere's fate (abandoned adds the converts), Sallow's fate (she joins as a second boss) and the war council (4+ allies: two Dawn Lance knights fight as allies). A cured Hollowmere adds two Briarkin archers as allies. Carrying the oil and rallying the Wardens each prevent a breach (story damage). After the siege, Warden-held Teeth become "player". Winning gives the Maw map and sets `arc.main.lantern_hold_held`.
- Blightwood: the heart-tree fight blocks the way. `world.briarkin_favor_owed` makes the hero spare the mound (wolves only; Nettle +10; the favor is paid). A burned Wick adds the curse-hunters. The hag's sister appears at night: with `arc.main.hag_bargain` she trades the memory back for a carried Tooth of the player's choice (it goes to the Choir); otherwise, or on refusal, she fights. Nettle's personal quest is a Nature DC 15 check at the heart-tree (loyalty 60+).
- Abbey (optional): a 12-hour vigil to midnight, the rite (automatic with Cendric), three Athletics dives, then the drowned-dead fight. Mireth's death-save blessing is narrated only; mechanically the rung bells give advantage on the Hunger Pull saves and +1 seal strength.
- Maw descent: the Maw's breath is Con-save story damage (the poisoned condition is not modelled). A failed navigation leads into the bile-pools fight; slipping past the sentries skips their fight, but an escaped Vosk still makes his final stand at the sanctum gate. Level 10 is an XP beat (+16,000) at the sanctum gate.
- Choir of Teeth: two Hunger Pulls, one before the fight and one when the Cantor is at bay, each a Str or Wis save DC 17 (advantage when the bells were rung; the Wis save also with `arc.starter.dream_heard` or Nettle's confession; disadvantage when the song is late or the Blightwood's whispers got in). The fight has four variants (the wraith, Aurek at her side). Winning leaves the Cantor at bay: up to two Pry attempts (Athletics DC 18), then parley, kill or capture. Parley routes: Aurek (automatic), Liesel's locket `~ch3_locket` (Persuasion DC 20, advantage from either Aurek's or Corwin's quest), Isolde's letter `~ch4_isolde_letter` (automatic while the Queen lives).
- A betrayed Rook is settled with Persuasion DC 15: success means he pries a Choir-held Tooth back for the party, failure means he steals a carried one. He cannot rejoin (betrayed companions cannot be recruited).
- Defeat in the finale is the Maw's spit with one retry; a second loss makes the Cantor "escaped", and the seal is made without her.
- Design gap resolved: a "sealed" result needs the Cantor not "escaped". An escaped Cantor sings inside the seal, so the result is "stirring" (ending 5) whatever the strength.
- Deadline: 4 days from the chapter start to reach the Jaw-Stone; missing it gives disadvantage on the Hunger Pull saves.
- The §12 epilogue lines (factions, companions, Millbrook) are beats that fire after the seal, before the ending action.
- Map: `the_maw` (rim, spiral stair, bile-pools, sentry gallery, sanctum gate, Jaw-Stone). Fights happen in their own rooms.

---

## 11. Companions

**General rules:**
- Up to 3 companions travel with the hero. Extra recruits wait at the nearest safe house (tag `safe_house`) and can be swapped there.
- Each companion's status flag has one of these values: "unmet", "met" (recruitable but not in the party), "in_party", "waiting", "left", "betrayed", or "dead".
- Loyalty is stored in `world.<name>_loyalty`, from 0 to 100, and starts at 50.
- Approval changes are ±5 for minor choices, ±10 for significant ones, and ±20 for defining ones.
- When loyalty is 20 or lower, the authored leave or betray point triggers the next time the story reaches it. Below 20 at other times, the companion only grumbles in banter.
- Personal quests unlock at loyalty ≥ 60. Completing one sets `world.<name>_quest_done` and grants +15 loyalty.

### 11.1 Ser Corwin Ashvale ("the dismissed knight")
- **Build:** human, paladin (`oath_of_devotion`), background `soldier`. Joins at level 1, recruited in `marrows_goods_and_oath` at `millbrook`.
- **Personality:** earnest, stubborn, dry-humoured. He is ashamed but doesn't mope. Voice: clipped and formal, softening as trust grows.
- **Goal:** Prove that the Dawn Lance's creed matters more than its orders, and be reinstated. Secretly, he wants to be the one who returns Dawnbreaker.
- **Faction ties:** `order_of_the_dawn_lance` (dismissed; Thane was his mentor) and `crown_of_aurelmark`.
- **Likes (+):** protecting innocents, mercy to surrendering foes, keeping promises, returning Dawnbreaker (+20), saving the Queen, the cure path in Ch1 (+10).
- **Dislikes (−):**
  - Lying to allies, torturing prisoners (−10).
  - The Purge path, where he objects to burning the living (−10).
  - Siding with pirates against the Crown (−5).
  - Stealing from Wick (−5).
  - Leaving captives behind in the barrow (−10 per captive lost).
  - Accepting Sallow's Teeth-for-Hollowmere offer (−20).
- **Leave point:** in `dawnspire_vigil`, if `world.corwin_loyalty` ≤ 20. He asks Thane for reinstatement and stays at Dawnspire, and `world.corwin_status` becomes "left". If the party kept Dawnbreaker, he formally demands it back. Refusing costs rep `order_of_the_dawn_lance` −20. He reappears as a friendly NPC in `highcrown_burning` but never rejoins.
- **Personal quest seed, "The Broken Oath":** the officer who ordered Cinderdale village abandoned in the Ashfall Winter was... Aldric Thane. Corwin learns this in the Dawnspire archives. The choice: expose Thane (the Lance is shaken, and Thane resigns) or forgive him publicly (Corwin is knighted). Either way `world.corwin_quest_done` is set. Tie-in: it was Cinderdale, Seraphine's village. If the hero knows this at the finale, it gives advantage on the parley Persuasion.

### 11.2 Nettle ("the hedge-witch's apprentice")
- **Build:** halfling, druid (`circle_of_the_land`, swamp), background `acolyte` (of Thaloren). Recruited in `hollowmere_stilts` at `hollowmere` (level 2).
- **Personality:** blunt, funny and fearless around the sick, and sharp around authority. She hums while healing. Voice: quick, fen-dialect, swears by roots and rot.
- **Goal:** Find a true cure for the Whispering Sickness. Secretly, she wants to learn her own true name, which Grandmother Wick keeps in a jar "until she's ready."
- **Faction ties:** `briarkin` (Wick's granddaughter), hostile to `lantern_wardens`.
- **Likes (+):**
  - Healing the sick, sparing beasts and plants, the cure path (+20).
  - Respecting Wick, honest bargains.
  - Rekindling Thaloren's shrine: she starts at 55 if `arc.starter.shrine_rekindled`.
- **Dislikes (−):**
  - Burning anything alive, the Purge (she leaves immediately).
  - Working with Grell (−5 per favor), stealing from Wick (−20).
  - Killing converted villagers who could be saved (−10), destroying the Blightwood (−10).
- **Leave or betray points:**
  - *Leave*, in `lantern_hold_tribunal`: path B always, or Deception at loyalty ≤ 20. `world.nettle_status` becomes "left". She returns only if the hero completes the side quest "Ashes and Apologies" (§14, hook 6).
  - *Betray*, in `maw_descent`, if `world.nettle_loyalty` ≤ 20. The Cantor has whispered to her that the Maw's opening will "cure every sickness forever." She steals the carried Tooth with the lowest number and runs to the Jaw-Stone. That Tooth becomes "choir", and `world.nettle_status` becomes "betrayed". At high loyalty, she instead confesses the whisper and gains advantage on saves against the Voice of the Choir.
- **Personal quest seed, "The Name in the Jar":** Wick's jar-shelf holds Nettle's true name. To earn it, Nettle must heal the Blightwood's heart-tree (resolved in `blightwood_crossing`, or earlier as a side quest). Reward: Nettle learns *her* name. It is also the key to Wick's Name-Chant if Wick is dead: +1 seal strength even when `arc.main.wick_fate` = "burned".

### 11.3 Rook Marrowby ("the gallows-dodger")
- **Build:** tiefling, rogue (`thief`), background `criminal`. Recruited in `fort_kestrel_gallows` at `fort_kestrel` (level 3).
- **Personality:** a charming liar, loyal only to people who've risked something for him. He gambles compulsively and hates bullies. Voice: theatrical and quick. He calls the hero "Boss" at high loyalty and "Partner" at low.
- **Goal:** Clear a 2,000 gp debt owed to the Saltwind Company, one his dead mother incurred, and buy his own ship. Secretly, he once smuggled for Harrow Vey without knowing the cargo was plague grain.
- **Faction ties:** `red_gull_brotherhood` (cousin-in-law to Captain Quint) and `tidewright_guild`. Hostile to `saltwind_trading_company`.
- **Likes (+):**
  - Cleverness over violence, sharing treasure fairly.
  - Humiliating Saltwind officials, the Red Gull alliance (+10).
  - Risking yourself for him at the gallows (+15).
  - Gambling.
- **Dislikes (−):**
  - Saltwind alliance (−20), bootlicking nobles, killing surrendered sailors (−10).
  - Taking his share of treasure, breaking a promise (−10).
- **Betray point:** in `pells_reckoning`, if `world.rook_loyalty` ≤ 20. He sells the Brass Tooth, or any carried Tooth, to Harrow Vey for his debt, and vanishes during the harbor strike. That Tooth becomes "choir", and `world.rook_status` becomes "betrayed". He reappears at `choir_of_teeth` ashamed and may switch back. *Leave* (non-hostile): if Gullhaven is burned while he's in the party, he leaves and `world.rook_status` becomes "left".
- **Personal quest seed, "Debt of Salt":** forge, repay or steal back his mother's debt-bond from Fort Kestrel's archive, or convince Pell (if allied or exposed) to void it. Reward: Rook buys a sloop, which gives free sea travel in the Brinescatter Isles and sets `world.rook_quest_done`.

### 11.4 Aurek Vell ("the Almoner's nephew")
- **Build:** human, wizard (`evoker`), background `sage` (a Veyran scholar). Recruited in `highcrown_audience` at `highcrown` (level 5).
- **Personality:** brilliant, anxious and bookish. He is kind to a fault and craves his aunt's approval. Voice: rapid, precise, apologetic, prone to footnotes.
- **Goal:** Understand the Teeth and "prove the Maw can be studied safely." Secretly, he suspects his aunt and cannot bear it.
- **Faction ties:** `crown_of_aurelmark` (minor nobility), the priests of Veyra, and family ties to the Cantor.
- **Likes (+):** preserving knowledge (Vosk's notes, the Vaelthorn archives), diplomacy, mercy to the Cantor, choosing the parley, saving the Queen (+10), respecting his feelings about his aunt.
- **Dislikes (−):**
  - Destroying books or relics (−10).
  - Killing unarmed cultists (−10), torture (−20).
  - Publicly humiliating his family before he's ready (−10). Instead, confront Seraphine privately first, or tell him first.
- **Betray point:** in `almoners_masque`, if `world.aurek_loyalty` ≤ 20. He warns his aunt, and `arc.main.cantor_warned` = true. She escapes the chase cleanly (no locket, no Tooth retaken). `world.aurek_status` becomes "betrayed", and he joins her at `choir_of_teeth`. At loyalty ≥ 60, he gives clue 6 instead. At ≥ 70 at the finale, he enables the redemption parley.
- **Personal quest seed, "Veyra's Lantern":** Aurek wants to recover his late father's research on "reverse-singing" the Teeth, which is hidden in the Almonry library. Completing it sets `world.aurek_quest_done`, grants +1 seal strength (added to the sum in `maw_final_seal`), and gives him Liesel's full story, which gives advantage on the parley.

(Implementation note: the `world.aurek_quest_done` +1 bonus is part of the seal-strength formula in `maw_final_seal`.)

---

## 12. Endings

These are evaluated in `maw_final_seal`, in this priority order. The first match wins.

| # | Ending id | Name | Exact flag conditions |
|---|---|---|---|
| 1 | `ending_hungering_dawn` | The Hungering Dawn (bad) | `world.maw_state` = "opened" |
| 2 | `ending_pale_mothers_mercy` | The Pale Mother's Mercy (redemption) | `world.maw_state` = "sealed" AND `arc.main.cantor_fate` = "redeemed" |
| 3 | `ending_hollow_throne` | The Hollow Throne (pyrrhic) | `world.maw_state` = "sealed" AND `world.queen_alive` = false |
| 4 | `ending_dawn_over_orrimar` | Dawn over Orrimar (triumph) | `world.maw_state` = "sealed" AND `world.queen_alive` = true AND `arc.main.cantor_fate` ∈ {"killed", "captured"} |
| 5 | `ending_quiet_hunger` | A Quiet Hunger (open, next-arc hook) | `world.maw_state` = "stirring" (the Cantor is "escaped" or dead) |

**Ending beats:**
1. **The Hungering Dawn.** The Maw opens. The hero, and allies with loyalty ≥ 70, hold the breach long enough for survivors to flee north. Aurelmark endures under siege as the Gloamfen falls silent.
   - Heroic mode: the hero survives, scarred ("the Maw's kiss").
   - Future arc: "The Long Hunger."
2. **The Pale Mother's Mercy.** Seraphine sings the jaw shut with her own voice, and Aurek or the hero holds her hand. If seal strength ≥ 7, she lives, mute forever, and becomes a penitent at the Drowned Abbey. The Sickness ends. Isolde weeps for her godmother.
3. **The Hollow Throne.** The Maw is sealed, but the Queen is dead. A regency council forms:
   - The Dawn Lance rules if rep `order_of_the_dawn_lance` ≥ 50.
   - Otherwise Ironvault's creditors, if rep `ironvault_consortium` ≥ 50.
   - Otherwise Chamberlain Hale, which is weak and invites future strife.
   - The hero is offered a seat if rep `crown_of_aurelmark` ≥ 50.
4. **Dawn over Orrimar.** Bells ring in Highcrown. The hero is honoured by the Queen.
   - If `arc.main.cantor_fate` = "captured": Seraphine's trial, where the hero may testify for mercy.
   - If "killed": a quiet state funeral, because Isolde insists.
5. **A Quiet Hunger.** The seal holds, barely. The Sickness wanes but doesn't end. Dreams still carry a voice. If the Cantor escaped, she becomes the Maw's voice: this sets the stage for the next arc. `world.maw_state` = "stirring" is readable by future arcs.

**Faction epilogues** (one line each, chosen by flags and rep):
- `crown_of_aurelmark`: `world.queen_alive` means Isolde reforms the Almonry and feeds the fen towns. Otherwise, the regency (ending 3).
- `order_of_the_dawn_lance`:
  - `arc.main.dawnbreaker_holder` = "dawn_lance" means the Order is reborn and recruits flood Dawnspire. If `arc.starter.pip_rescued`, Pip is knighted in the epilogue.
  - "player" means the hero is offered a Lance commission.
  - "choir" or "lost" means the Order dwindles.
  - `world.corwin_quest_done` decides whether Corwin leads the Order or Thane does.
- `ironvault_consortium`: `arc.main.money_trail_proven` means the Crown's debt is renegotiated and the deep mines reopen. Otherwise, the Consortium calls in its debts, bringing austerity to Aurelmark.
- `lantern_wardens`: `arc.main.hollowmere_fate` = "cured" means the Wardens lay down their torches and become healers' escorts. "purged" means Grell is feted, but the fens remember. `arc.main.lantern_hold_held` = false means the Wardens are scattered.
- `briarkin`:
  - `arc.main.wick_fate` = "ally" means the Briarkin are granted the last wild marshes by royal charter (if the Queen is alive).
  - "burned" means Nettle, if loyal, leads the clans in grief. Otherwise, they vanish into the deep fen.
- `hollow_choir`:
  - `arc.main.cantor_fate` "killed" or "captured" means the Choir's cells collapse. Escaped lieutenants (`arc.main.sallow_fate`, `arc.main.harrow_vey_fate`, `arc.main.vosk_fate`, `arc.starter.ashby_fate` = "escaped") remain as side-quest villains.
  - "escaped" means the Choir goes quiet, and waits.
- `saltwind_trading_company`: `arc.main.pell_fate` = "exposed" means the charter is reformed and tariffs are halved. "allied" means Pell thrives, which is corrupt but stable. `arc.main.gullhaven_fate` = "occupied" means the monopoly is total.
- `red_gull_brotherhood`: `arc.main.isles_alliance` = "red_gull" means Quint is granted a royal pardon and the Brotherhood becomes privateers. `arc.main.parrot_treasure` = "red_gull" means a legendary party at Fennick's Rest.
- `tidewright_guild`: `arc.main.gullhaven_fate` = "free" means Gullhaven builds its first warship in a century. "burned" means Tull rebuilds, bitterly.
- **Companions:** one line each, based on status, loyalty and `world.<name>_quest_done` (Corwin, Nettle, Rook, Aurek).
- **Millbrook:** `arc.starter.captives_saved` = 4 means a statue of the hero on the green. `arc.main.millbrook_militia` means the Reeve is knighted.
- **Defeats:** if `world.times_defeated` ≥ 5, the bards call the hero "the Unkillable", with a comic epilogue line.

---

## 13. Defeat Outcomes (Heroic Mode)

The engine picks the first matching outcome by condition. Each outcome:
- Heals the hero to 1 HP (companions to 1 HP, or 0 and stable if they were also down).
- Advances the clock.
- Increments `world.times_defeated`.
- Logs a journal entry.

The hero keeps quest items unless the outcome says otherwise. **Tooth rule:** a Tooth is only lost if the outcome says so.

| id | Condition (evaluated in order) | Result |
|---|---|---|
| `maws_spit` | Location is `the_maw` | The Maw vomits the party to the rim, and the clock advances +1 hour. One carried Tooth is taken ("choir", and `arc.main.teeth_choir` +1). The party gets one retry. Scar: "the Maw's kiss" (black veins on the neck). |
| `dragons_disdain` | Enemy is a dragon | Tossed from the lair, the hero wakes at the foot of the peak after 8 hours. Burn scar. The dragon keeps any treasure the hero dropped. |
| `captured_by_choir` | Enemy faction is `hollow_choir` and at least 1 enemy is conscious | Wake in a Choir holding cell. Gear is stored in the same dungeon. There is an escape scene with a Dex, Str or thieves' tools check at DC 10 + chapter number. One captive, if any, is lost. On a failure, `world.times_defeated` +1 and the hero is rescued by the regional ally (see below). |
| `rescued_by_wardens` | Region is `gloamfen` and rep `lantern_wardens` ≥ −20 | The hero wakes at `lantern_hold` a day later. Quarantine: Con save DC 12, or the hero must stay another day. Wardens fine 10 gp. |
| `rescued_by_briarkin` | Region is `gloamfen`, and either rep `briarkin` ≥ 20 or `world.nettle_status` = "in_party" | The hero wakes at `thornwife_hollow` and must owe a favor: `world.briarkin_favor_owed` = true. |
| `temple_revival` | The enemy is undead, or the location is `drowned_abbey` | Priests of Mireth or Solenne revive the hero at the nearest `temple`-tagged location. A tithe of 10% of gold. Scar chance 50%. |
| `fished_out_by_red_gulls` | Region is `brinescatter_isles`, and either at sea or on a coastal site, and rep `red_gull_brotherhood` > −60 | The hero wakes aboard a Red Gull sloop. A salvage fee: 25% of gold or a job; unpaid fees add 100 to `world.red_gull_debt`. |
| `thrown_in_fort_kestrel` | Enemies are lawful (Saltwind, Crown or guards) | The hero wakes in a cell: at `fort_kestrel` in the Isles, or in the Highcrown dungeons in Aurelmark. Bribe 50 gp × chapter, a break-out check (DC 13 + chapter), or wait 3 days. Escaping sets `world.player_outlawed` = true. |
| `robbed_and_left` | Enemies are bandits, pirates or intelligent non-cult foes | The hero wakes at the roadside, having lost 50% of their gold and 1 random non-quest item, which goes to a fence (a recovery side quest). |
| `left_for_dead` | Enemies are beasts, monstrosities or elementals | The hero wakes at the site after 8 hours with 1 level of exhaustion. Monsters have moved on or remain (50%). |
| `dragged_to_safety` | Fallback, when a conscious companion or allied NPC is present | The hero wakes at the last rest point, and the clock advances 4 hours. The encounter resets with the enemy at full HP, but the hero's objective timers advance. |

**Scar-worthy story moments** (authored permanent scars, placed per §12 of the Build Prompt, logged with origin):
1. The Tithe Altar feeding (`barrow_of_the_first_sheaf`), if the hero shields a captive: "Left palm: the Tithe Altar's bite, Millbrook."
2. Wick's memory-trade (`thornwife_moot`): a thorn-shaped white mark behind the ear.
3. Swimming the drowned nave (`drowned_abbey_undercroft`) after failing twice: "Throat: drowned-bell chill."
4. The hag's bargain (`singing_reef_lagoon`): coral-scale patterning on the temple.
5. The gallows break-out (`fort_kestrel_gallows`), if the alarm is raised: rope-burn on the neck.
6. The Vaelthorn fall (`vaelthorn_sky_towers`): a failed climb costs a split brow.
7. Assassins' poison (`dawnspire_vigil`), when surprised: a black-veined shoulder.
8. Dragonfire (`emberpeak_ascent` or `pyrraxis_hoard`), when dropped to 0 by fire: a burned forearm.
9. Freeing Pyrraxis (`pyrraxis_hoard`), on a claw hit during the extraction: "Chest: Pyrraxis's claw, Chapter 4."
10. The burning of Highcrown (`highcrown_burning`): scorched hair and ear.
11. The Hunger Pull (`choir_of_teeth`), whenever a Tooth is torn away: a tooth-shaped bite mark on the wrist.
12. The Maw's kiss (`maws_spit` outcome): black veins on the neck.

---

## 14. Side-Quest Hooks (for the woven-in generator, Build Prompt §7.4)

The generator gives these hooks priority when their creating flags are set. Each hook lists its template, typical location, and write-back.

| # | Hook | Created by (flag condition) | Template | Write-back |
|---|---|---|---|---|
| 1 | "The Sexton's Return": Brother Ashby preaches in a new village | `arc.starter.ashby_fate` = "escaped" | Hunt a fugitive (`brightwater` or `ravensgate`) | Sets `arc.starter.ashby_fate` = "captured" or "killed". Rep `crown_of_aurelmark` +10. Removes Ashby from `night_of_bells`. |
| 2 | "Sallow's Seed": plague bread in a fen town | `arc.main.sallow_fate` = "escaped" | Stop a poisoner (`hollowmere` or `ravensgate`) | Sets `arc.main.sallow_fate`. Removes Sallow from the Ch5 siege. |
| 3 | "Vey's Last Run": the Choir smuggler's ghost-ship | `arc.main.harrow_vey_fate` = "escaped" | Naval chase (`gullhaven`, `wreckers_cove`) | Sets `arc.main.harrow_vey_fate`. Removes Vey from `highcrown_burning`. |
| 4 | "The Hollow Library": Vosk's hidden archive | `arc.main.vosk_fate` = "escaped" | Dungeon delve (`ruins_of_old_vaelthorn`, `deepanvil_hold`) | Sets `arc.main.vosk_fate`. Gives clue 7 if it was missed. |
| 5 | "A Squire's Errand": Pip asks for help (a grateful NPC) | `arc.starter.pip_rescued` | Escort or fetch (`millbrook`, `dawnspire_keep`) | +5 `world.corwin_loyalty`. Pip later gives a free reroll at `dawnspire_muster`. |
| 6 | "Ashes and Apologies": Briarkin curse-hunters and Nettle's return | `arc.main.hollowmere_fate` = "purged" or `arc.main.wick_fate` = "burned" | Vengeful NPC (`blightwood`, `thornwife_hollow`) | Rep `briarkin` +20. Can return Nettle: `world.nettle_status` "left" → "waiting". |
| 7 | "Company Business" / "Gull's Grudge": a faction reprisal | `arc.main.isles_alliance` = "red_gull" (Saltwind bounty hunters) or "saltwind" (Red Gull raiders) | Faction grudge (`port_sorrel`, `fennicks_rest`) | Rep ±15. Can repair `arc.main.gullhaven_fate` from "occupied" to "free". |
| 8 | "The Governor's Ledger": Pell hires or blackmails the hero | `arc.main.pell_fate` = "fled" or "allied" | Blackmail or heist (`port_sorrel`, `fort_kestrel`) | Sets `arc.main.pell_fate`. If "allied" becomes "exposed", Saltwind gunpowder is lost from the war council. |
| 9 | "Auntie's Due": the sea hag's family collects | `arc.main.hag_bargain` | Bargain or hunt (`singing_reef`, `hollowmere`) | Restores the memory early. `arc.main.hag_bargain` = false. |
| 10 | "The Unclaimed Parrot": the Brass Parrot treasure still lies buried | `arc.main.parrot_treasure` = "unclaimed" | Unexplored location (`isle_of_brass_parrots`) | Sets `arc.main.parrot_treasure` = "player". Enables the treasure ally at `dawnspire_muster`. |
| 11 | "The Turncoat's Debt": find Rook | `world.rook_status` = "betrayed" | Hunt or forgive (`fennicks_rest`, `gullhaven`) | Can set `world.rook_status` = "waiting" and retake the Tooth, making it "player". |
| 12 | "Bells of Mercy": the Abbot's pilgrims need escort | `arc.main.abbot_cendric_alive` | Escort (`drowned_abbey`, `lantern_hold`) | Rep `lantern_wardens` +10. `arc.main.abbey_bells_rung` becomes cheaper in Ch5 (auto-success on Religion). |
| 13 | "Debt Collectors": the Red Gulls want their salvage fee | `world.red_gull_debt` > 0 | Job or pay (`fennicks_rest`) | Clears `world.red_gull_debt`. |
| 14 | "Wanted": bounty hunters pursue the hero | `world.player_outlawed` | Survive or clear your name (any Aurelmark town) | Can clear `world.player_outlawed`. |

Side quests must never change a Tooth holder except through hooks 11 and 4 (the Tooth-related write-backs above), and they never kill a named main-arc NPC who is not a lieutenant.

---

## 15. Implementation Notes (for the adventure-JSON conversion)

- **One adventure file per chapter:**
  - `data/adventures/starter_millbrook.json`
  - `data/adventures/ch1_whispering_fen.json`
  - and so on.
- **Scene ids** in `flags.json` → `scenes` are the canonical scene ids for the adventure files.
- **Derived flags.** `arc.main.teeth_secured` and `arc.main.teeth_choir` are recomputed by the flag engine from the seven holder flags. Content should never write them directly. They are listed as written by the scenes that change a holder.
- **Special reader and writer ids** in `flags.json`:
  - `ending`: the ending evaluator.
  - `side_quests`: the Build Prompt §7.4 generator.
  - `defeat_outcomes`: the Heroic defeat system.
  - `companion_quests`: the four personal-quest mini-adventures in §11. They are built later as small adventures in the same schema.
- **Monsters and items used.** `flags.json` → `monstersUsed` lists every monster id in the encounter lines. `itemsUsed` lists every magic item id this bible names.
- **Encounters.** The monster lists are the base for a party of 4 at the chapter's level. Solo play uses the Build Prompt §6 scaling, which drops minions first.
- **Boss fights** (Pyrraxis, the Cantor) use named "modifier" blocks on top of the SRD statblock: an HP percentage, legendary action count, and extra actions. These need a small `statOverrides` field in the encounter schema.
- **Cross-arc reads.** Future arcs should read `world.maw_state`, `world.queen_alive`, `world.player_outlawed`, the companion flags, and `world.sickness_cure`.
