/** Small text helpers for showing SRD Markdown snippets in the UI. */
import { ENGLISH, type Translator } from '../../shared/i18n';

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
export function formatCoins(cp: number, tr: Translator = ENGLISH): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && tr.t('coins.gp', { n: gp }), sp && tr.t('coins.sp', { n: sp }), c && tr.t('coins.cp', { n: c })].filter(Boolean).join(' ') || tr.t('coins.gp', { n: 0 });
}

/** "Clothes, Traveler's" → "Traveler's Clothes"; "Lantern, Hooded" → "Hooded Lantern". */
export function itemDisplayName(name: string): string {
  const m = /^([^,]+), (.+)$/.exec(name);
  return m ? `${m[2]} ${m[1]}` : name;
}

/** Groups identical names: ["Javelin", "Javelin", "Rope"] → ["2 × Javelin", "Rope"]. */
export function groupNames(entries: { name: string; quantity: number; note?: string }[]): string[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.name}${e.note ? ` (${e.note})` : ''}`;
    map.set(key, (map.get(key) ?? 0) + e.quantity);
  }
  return [...map].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k));
}

/** "Day 2, 14:05 (day)" from minutes since the campaign began (day 1, 00:00). */
export function formatClock(minutes: number, timeOfDay: 'dawn' | 'day' | 'dusk' | 'night', tr: Translator = ENGLISH): string {
  const day = Math.floor(minutes / 1440) + 1;
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return tr.t('game.clock', { day, time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, phase: tr.t(`time.${timeOfDay}`) });
}
