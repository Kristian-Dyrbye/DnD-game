/**
 * Campaigns a new game can start (B001). A campaign is named by the adventure id of its first
 * chapter; later chapters chain through ending `next`. Plain data, no engine imports: the title
 * screen bundles it (ui/state.ts), the host checks `new_game.campaign` against it, and the save
 * browser shows the campaign of a save. A campaign whose first chapter is not yet written is
 * listed but not `playable` (shown greyed out until its chapter lands in src/host/bundled.ts).
 */

export interface Campaign {
  /** Short id used in UI keys (`campaign.<id>.name` / `.blurb`). */
  id: string;
  /** Adventure id of the first chapter (what `new_game.campaign` carries). */
  adventure: string;
  /** Level range the story covers (shown in the picker). */
  levels: [number, number];
  /** False while the first chapter is not in the repo yet. */
  playable: boolean;
  /** "New hero, same world" (B002): a new game may import the world of a finished save. */
  importsWorld: boolean;
  /** Flags a fresh (not imported) world of this campaign starts with. */
  freshWorld?: Readonly<Record<string, boolean | number | string>>;
}

export const CAMPAIGNS: readonly Campaign[] = [
  { id: 'seven_teeth', adventure: 'millbrook_disappearances', levels: [1, 10], playable: true, importsWorld: false },
  {
    id: 'hollow_crown',
    adventure: 'arc2_ch0_hollow_coin',
    levels: [1, 5],
    playable: true,
    importsWorld: true,
    // DESIGN_ARC2 §3: as if the Seven Teeth ended well, without the player having been there.
    freshWorld: { 'world.maw_state': 'sealed', 'world.queen_alive': true, 'world.player_outlawed': false },
  },
];

/** The campaign a new game starts when none is chosen (the starter arc). */
export const DEFAULT_CAMPAIGN: Campaign = CAMPAIGNS[0]!;

/** The campaign whose first chapter is `adventureId`, if any. */
export function campaignOf(adventureId: string | undefined): Campaign | undefined {
  return adventureId === undefined ? undefined : CAMPAIGNS.find((c) => c.adventure === adventureId);
}

/** UI catalog keys for a campaign's name and blurb (the catalogs hold en + da texts). */
export function campaignKeys(id: string): { name: `campaign.${string}.name`; blurb: `campaign.${string}.blurb` } {
  return { name: `campaign.${id}.name`, blurb: `campaign.${id}.blurb` };
}
