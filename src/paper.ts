import type { Item } from "./types.js";
import { newspaper, marktplaats } from "./config.js";

// The newspaper half: general headlines and Marktplaats listings. No scoring —
// news is taken in the editors' order, listings newest first — so the only work
// here is ageing out, de-duplicating, and not sending anything twice.

export interface PaperSection {
  id: string;
  label: string;
  color: string;
  shown: Item[];    // dashboard: the section's current list, NEW-badged when unsent
  picked: Item[];   // email: the newest unsent, capped per section
}

export interface Paper {
  news: PaperSection[];
  market: PaperSection[];
}

export const isPaperItem = (i: Item): boolean => i.section !== undefined;

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Newest first, taking turns between a section's feeds. Pure recency would hand
 * a section to whichever outlet publishes most often (NU.nl posts several times
 * an hour); alternating keeps each outlet's lead stories in view.
 */
function alternate(items: Item[]): Item[] {
  const bySource = new Map<string, Item[]>();
  for (const i of items) bySource.set(i.source, [...(bySource.get(i.source) ?? []), i]);
  const time = (i: Item) => Date.parse(i.publishedAt ?? i.collectedAt);
  const queues = [...bySource.values()].map((q) => q.sort((a, b) => time(b) - time(a)));
  // Lead with the outlet that published most recently.
  queues.sort((a, b) => time(b[0]) - time(a[0]));
  const out: Item[] = [];
  for (let n = 0; queues.some((q) => n < q.length); n++) for (const q of queues) if (q[n]) out.push(q[n]);
  return out;
}

export function buildPaper(items: Item[], seenIds: Set<string>): Paper {
  const mark = (i: Item): Item => ({ ...i, isNew: !seenIds.has(i.id) });
  const cutoff = Date.now() - newspaper.maxAgeHours * 3_600_000;

  const news = newspaper.sections.map((s) => {
    const titles = new Set<string>();
    const fresh = items.filter((i) => {
      if (i.channel !== "news" || i.section !== s.id) return false;
      if (Date.parse(i.publishedAt ?? i.collectedAt) < cutoff) return false;
      // Feeds repeat a story under a new URL when they update it; the headline is
      // the stable part.
      const t = norm(i.title);
      if (titles.has(t)) return false;
      titles.add(t);
      return true;
    });
    const ordered = alternate(fresh).map(mark);
    return {
      id: s.id, label: s.label, color: s.color,
      shown: ordered.slice(0, newspaper.dashboardPerSection),
      picked: ordered.filter((i) => i.isNew).slice(0, newspaper.perSection),
    };
  });

  const market = marktplaats.searches.map((s) => {
    const seenUrl = new Set<string>();
    // Already newest-first from the collector; only the same listing appearing
    // twice (a boosted listing can) needs removing.
    const listed = items
      .filter((i) => i.channel === "marktplaats" && i.section === s.id)
      .filter((i) => !seenUrl.has(i.url) && seenUrl.add(i.url))
      .map(mark);
    return {
      id: s.id, label: s.label, color: s.color,
      shown: listed.slice(0, marktplaats.dashboardPerCategory),
      picked: listed.filter((i) => i.isNew).slice(0, marktplaats.perCategory),
    };
  });

  return { news, market };
}

export const pickedCount = (sections: PaperSection[]): number =>
  sections.reduce((n, s) => n + s.picked.length, 0);

export const allPicked = (p: Paper): Item[] =>
  [...p.news, ...p.market].flatMap((s) => s.picked);

export const priceLabel = (i: Item): string =>
  i.priceEur === undefined ? ""
    : `${i.bid ? "bid from " : ""}€${i.priceEur.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}`;
