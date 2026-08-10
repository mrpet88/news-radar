import type { Item, Lane } from "./types.js";
import { canonicalUrl } from "./util/id.js";
import { noise, channelWeight } from "./config.js";

// Word-boundary match so short tokens can't hit inside longer words ("mcp" must
// not match "mcphee", "rag" must not match "storage"). Terms containing spaces or
// hyphens are matched as phrases.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function hasTerm(haystack: string, term: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(term.toLowerCase())}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

export const matchAny = (haystack: string, terms: string[]): boolean =>
  terms.some((t) => hasTerm(haystack, t));

// A group matches only when ALL its terms appear; a tier matches when ANY group does.
const groupMatches = (haystack: string, group: string[]): boolean =>
  group.every((t) => hasTerm(haystack, t));

/**
 * Reference documentation dressed as a search result. Only applied to the channels
 * that return arbitrary web pages: a GitHub repo whose description says "SDK" is a
 * legitimate find, and Reddit/Twitter are discussions rather than pages.
 */
export function isDocumentation(item: Item): boolean {
  if (item.channel !== "exa" && item.channel !== "rss") return false;
  const url = (item.url || "").toLowerCase();
  const title = (item.title || "").toLowerCase();
  return noise.docUrlPatterns.some((p) => url.includes(p)) ||
    noise.docTitlePatterns.some((p) => title.includes(p));
}

/**
 * How much the publish date moves an item. A daily radar is about what changed, so
 * a two-year-old page that matches perfectly should still lose to a post from
 * yesterday that matches adequately.
 */
export function recencyAdjustment(item: Item): number {
  const r = noise.recency;
  if (!item.publishedAt) return r.undatedPenalty;
  const t = Date.parse(item.publishedAt);
  if (Number.isNaN(t)) return r.undatedPenalty;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 0) return 0;                       // future-dated: treat as neutral
  if (days <= r.freshDays) return r.freshBonus;
  if (days <= r.recentDays) return r.recentBonus;
  if (days >= r.staleDays) return r.stalePenalty;
  return 0;
}

/**
 * Assign lane, tier and score. An item is tested against every lane and keeps the
 * best-scoring match, so a story about testing AI agents lands in whichever lane
 * it fits more strongly rather than being duplicated into both.
 *
 * Returns null when nothing matches, an exclusion fires, or the item is reference
 * documentation — the caller drops it.
 */
export function scoreItem(item: Item, lanes: Lane[]): Item | null {
  if (isDocumentation(item)) return null;
  const title = (item.title || "").toLowerCase();
  const body = `${title} ${(item.summary || "").toLowerCase()} ${(item.source || "").toLowerCase()}`;

  let best: { lane: string; tier: string; score: number } | null = null;

  for (const lane of lanes) {
    // Exclusions scan the full text — a single pharma/crypto signal kills the item
    // for that lane regardless of how well the keywords matched.
    if (matchAny(body, lane.excludeKeywords)) continue;

    for (const tier of lane.keywordTiers) {
      if (!tier.groups.some((g) => groupMatches(body, g))) continue;
      // Title hits are worth more than body hits: a story *about* the topic beats
      // one that merely mentions it in passing.
      const inTitle = tier.groups.some((g) => groupMatches(title, g));
      const score = tier.weight + (inTitle ? 3 : 0);
      if (!best || score > best.score) best = { lane: lane.id, tier: tier.tier, score };
    }
  }

  if (!best) return null;
  // Recency can pull a match below zero; that item is old enough to not be news.
  const raw = (best.score + recencyAdjustment(item)) * (channelWeight[item.channel] ?? 1);
  const score = Math.round(raw * 10) / 10;
  if (score <= 0) return null;
  return { ...item, lane: best.lane, tier: best.tier, score };
}

const richer = (a: Item, b: Item) =>
  (a.score ?? 0) > (b.score ?? 0) ||
  ((a.score ?? 0) === (b.score ?? 0) && (a.summary?.length ?? 0) > (b.summary?.length ?? 0));

// Titles differing only in punctuation, case or whitespace are the same headline.
const titleKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Collapse the same story arriving more than once, keeping the richest copy.
 *
 * Two passes are needed. URL catches the same link from different channels, but
 * not the case that actually showed up in testing: an aggregate feed carrying one
 * post twice under different permalinks (a blog entry and its link-blog echo).
 * Those share a headline and nothing else, so the second pass keys on the title.
 */
export function dedupe(items: Item[]): Item[] {
  const byUrl = new Map<string, Item>();
  for (const it of items) {
    const key = canonicalUrl(it.url) || titleKey(it.title);
    const prev = byUrl.get(key);
    if (!prev || richer(it, prev)) byUrl.set(key, it);
  }

  const byTitle = new Map<string, Item>();
  for (const it of byUrl.values()) {
    const key = titleKey(it.title);
    if (!key) continue;
    const prev = byTitle.get(key);
    if (!prev || richer(it, prev)) byTitle.set(key, it);
  }
  return [...byTitle.values()];
}

// Drop anything older than maxAgeDays. Items with no publishedAt are kept: most
// channels report one, and discarding the silent ones would lose real stories.
export function withinAge(items: Item[], maxAgeDays: number): Item[] {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  return items.filter((it) => {
    if (!it.publishedAt) return true;
    const t = Date.parse(it.publishedAt);
    return Number.isNaN(t) || t >= cutoff;
  });
}

export const markNew = (items: Item[], seen: Set<string>): Item[] =>
  items.map((it) => ({ ...it, isNew: !seen.has(it.id) }));

/**
 * Choose the digest rows. Lanes are filled independently against their own caps
 * before the global ceiling applies, so a busy AI week can't crowd QA out of the
 * email entirely — the whole point of running two lanes rather than one feed.
 */
export function pickPerLane(items: Item[], lanes: Lane[], maxRows: number): Item[] {
  const ranked = [...items].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) ||
      Date.parse(b.publishedAt ?? b.collectedAt) - Date.parse(a.publishedAt ?? a.collectedAt),
  );
  const out: Item[] = [];
  for (const lane of lanes) {
    out.push(...ranked.filter((i) => i.lane === lane.id).slice(0, lane.maxPerDigest));
  }
  return out
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxRows);
}
