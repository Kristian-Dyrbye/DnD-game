/**
 * The player's journal (spec §15): free-form notebook pages the player writes and organises
 * themselves, saved with the game. There is deliberately no automatic quest log here.
 */
import { z } from 'zod';

export const JOURNAL_MAX_PAGES = 200;
export const JOURNAL_MAX_TITLE = 80;
export const JOURNAL_MAX_BODY = 20_000;

export const JournalPageSchema = z.object({
  id: z.string().regex(/^p\d+$/),
  title: z.string().max(JOURNAL_MAX_TITLE),
  body: z.string().max(JOURNAL_MAX_BODY),
  /** Campaign minutes when last edited (shown as an in-game date). */
  updatedAt: z.number().int().min(0),
});
export type JournalPage = z.infer<typeof JournalPageSchema>;

export const JournalSchema = z.object({
  /** In the player's chosen order. */
  pages: z.array(JournalPageSchema).max(JOURNAL_MAX_PAGES).default([]),
  nextPage: z.number().int().min(1).default(1),
});
export type Journal = z.infer<typeof JournalSchema>;

export class JournalError extends Error {}

/** Creates (no id) or updates a page. Returns its id. */
export function savePage(j: Journal, page: { id?: string; title: string; body: string }, now: number): string {
  const title = page.title.trim().slice(0, JOURNAL_MAX_TITLE) || 'Untitled';
  const body = page.body.slice(0, JOURNAL_MAX_BODY);
  if (page.id) {
    const existing = j.pages.find((p) => p.id === page.id);
    if (!existing) throw new JournalError('That page no longer exists.');
    Object.assign(existing, { title, body, updatedAt: now });
    return existing.id;
  }
  if (j.pages.length >= JOURNAL_MAX_PAGES) throw new JournalError(`The journal is full (${JOURNAL_MAX_PAGES} pages).`);
  const id = `p${j.nextPage++}`;
  j.pages.push({ id, title, body, updatedAt: now });
  return id;
}

export function deletePage(j: Journal, id: string): void {
  const i = j.pages.findIndex((p) => p.id === id);
  if (i < 0) throw new JournalError('That page no longer exists.');
  j.pages.splice(i, 1);
}

/** Reorders pages to `ids` (must be exactly the current ids). */
export function reorderPages(j: Journal, ids: string[]): void {
  const current = j.pages.map((p) => p.id);
  if (ids.length !== current.length || ids.some((id) => !current.includes(id)) || new Set(ids).size !== ids.length) {
    throw new JournalError('The page order does not match the journal.');
  }
  j.pages = ids.map((id) => j.pages.find((p) => p.id === id)!);
}
