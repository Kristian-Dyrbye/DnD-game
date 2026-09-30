/**
 * Reading save files from outside the game (Import save): runs the migration chain, checks the
 * envelope and validates the game state, so a bad file is refused up front instead of on load.
 */
import { SaveFileSchema, type SaveFile } from '../../shared/save';
import { GameStateSchema } from './gameState';
import { migrateSave } from './migrations';

export class SaveFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFileError';
  }
}

/** Migrates and validates a raw save envelope (state checked by the GameState schema). Throws SaveFileError. */
export function parseSaveFile(raw: unknown): SaveFile {
  let migrated: unknown;
  try {
    migrated = migrateSave(raw).save;
  } catch (err) {
    throw new SaveFileError((err as Error).message);
  }
  const envelope = SaveFileSchema.safeParse(migrated);
  if (!envelope.success) throw new SaveFileError(`Not a save file: ${issue(envelope.error.issues[0])}`);
  const state = GameStateSchema.safeParse(envelope.data.state);
  if (!state.success) throw new SaveFileError(`The saved game is damaged: ${issue(state.error.issues[0])}`);
  return envelope.data;
}

/** Parses the text of an exported .json save. Throws SaveFileError. */
export function parseSaveText(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveFileError('Not a save file: the file is not valid JSON');
  }
  return parseSaveFile(raw);
}

function issue(i: { path: PropertyKey[]; message: string } | undefined): string {
  if (!i) return 'invalid';
  return i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message;
}
