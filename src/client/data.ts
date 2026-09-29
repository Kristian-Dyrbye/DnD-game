/** SRD database for the client (same validated data the server uses). */
import { loadSrd } from '../engine/data/srdBundle';

export const db = loadSrd();
