/** Small text helpers for showing SRD Markdown snippets in the UI. */

/** Strips Markdown emphasis markers (_x_, **x**). */
export function plain(md: string): string {
  return md.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/_([^_]+)_/g, '$1');
}

/** First sentence (or first `max` characters) of a text, for compact cards. */
export function firstSentence(md: string, max = 160): string {
  const t = plain(md).replace(/\s+/g, ' ').trim();
  const end = t.search(/[.!?](\s|$)/);
  const s = end >= 0 ? t.slice(0, end + 1) : t;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "5000" CP → "50 GP"; mixes GP/SP/CP as needed. */
export function formatCoins(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp} GP`, sp && `${sp} SP`, c && `${c} CP`].filter(Boolean).join(' ') || '0 GP';
}
