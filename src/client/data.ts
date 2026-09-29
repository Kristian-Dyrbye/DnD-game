/** Static game data for the client: the SRD database and world lore (same validated data the server uses). */
import { loadSrd } from '../engine/data/srdBundle';
import { LoreSchema } from '../engine/world/lore';
import loreJson from '../../data/world/lore.json';
import { ShopTableSchema } from '../engine/world/shops';
import shopsJson from '../../data/world/shops.json';

export const db = loadSrd();
/** World lore (map, regions, locations) for the world map screen. */
export const lore = LoreSchema.parse(loreJson);
/** Shops (names and locations; prices always come from the server). */
export const shops = ShopTableSchema.parse(shopsJson);
