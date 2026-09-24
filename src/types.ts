// One normalized shape every agent-reach channel maps into.
export type Channel =
  | "exa"        // semantic web search (mcporter → exa MCP)
  | "github"     // gh search repos
  | "reddit"     // opencli reddit  (needs live Chrome + OpenCLI extension)
  | "twitter"    // twitter-cli     (needs TWITTER_AUTH_TOKEN + TWITTER_CT0)
  | "rss"        // direct feed fetch
  | "v2ex"       // public API
  | "news"       // newspaper: general headlines from publisher feeds
  | "marktplaats"; // newspaper: Marktplaats listings via its public search API

export interface Item {
  id: string;            // stable hash: channel + url (or title when url is unstable)
  channel: Channel;
  lane?: string;         // matched topic lane: "qa" | "ai"
  tier?: string;         // scoring band once matched: "core" | "adjacent"
  score?: number;        // tier weight after adjustments; drives ranking
  title: string;
  url: string;
  source: string;        // human-readable origin: feed name, subreddit, repo owner…
  summary?: string;      // short snippet, already stripped of markup
  // No author field. Nothing rendered it, and it meant committing the usernames of
  // ~110 third parties per run into a publishable repo for no benefit.
  publishedAt?: string;  // ISO when the origin reports one
  collectedAt: string;   // ISO — set by the collector, drives the freshness gate
  stars?: number;        // github only
  points?: number;       // reddit/v2ex score, when the channel reports one
  isNew?: boolean;       // unseen in seen-history at render time
  // Newspaper items only. Set on "news" and "marktplaats" items, never on radar
  // items — its presence is what keeps them out of the QA/AI lane scoring.
  section?: string;      // newspaper section or Marktplaats search id
  priceEur?: number;     // marktplaats
  bid?: boolean;         // marktplaats: "bieden vanaf" rather than a fixed price
  place?: string;        // marktplaats: seller's city, as shown on the listing
  image?: string;        // marktplaats: thumbnail URL
}

// What one channel reported in a single collector run. Persisted alongside the
// items so the dashboard and the digest can be honest about coverage: a channel
// that failed is different from a channel that ran and found nothing.
export interface ChannelReport {
  channel: Channel;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;        // one-line reason when ok=false
  skipped?: string;      // set when deliberately not attempted (precondition unmet)
}

// The collector's output, one file per side: data/reach-cloud.json (Actions) and
// data/reach-mac.json (the Mac). The render merges them — see loadReach.
export interface ReachPayload {
  version: 1;
  collectedAt: string;         // ISO — the freshness gate reads this
  // Deliberately no hostname. This payload is committed and the repo may be
  // published; the collecting machine's name would go with it, and with a single
  // collector it identified nothing useful anyway.
  agentReachVersion?: string;
  channels: ChannelReport[];
  items: Item[];
}

// A weighted band of keyword groups. A group matches when ALL its terms appear;
// a tier matches when ANY of its groups match. Highest matched weight wins and
// becomes the item's score. Same semantics as job-radar's keywordTiers.
export interface KeywordTier {
  tier: string;        // "core" | "adjacent"
  weight: number;
  groups: string[][];  // e.g. [["qa","lead"], ["test","strategy"]]
}

// One topic lane. Lanes are scored independently so a quiet week in one doesn't
// let the other flood the digest — see pickPerLane in filter.ts.
export interface Lane {
  id: string;              // "qa" | "ai"
  label: string;           // shown on the badge
  color: string;           // hex, used by both digest and dashboard
  keywordTiers: KeywordTier[];
  excludeKeywords: string[];
  exaQueries: string[];    // semantic queries for the exa channel
  githubQueries?: string[];// `gh search repos` queries
  subreddits?: string[];   // reddit channel, when it's reachable
  twitterQueries?: string[];
  // Accounts to restrict the twitter channel to. Empty means open search, which
  // is why the channel is disabled by default — see `collector.enabled`.
  twitterHandles?: string[];
  feeds?: { name: string; url: string }[];
  maxPerDigest: number;    // hard cap on rows this lane contributes to the email
}

// ── Newspaper ─────────────────────────────────────────────────────────────────
// Unlike lanes, sections are not scored: they carry the editors' own headlines,
// newest first, and the only filtering is age and "already sent".
export interface NewsSection {
  id: string;
  label: string;
  color: string;
  feeds: { name: string; url: string }[];
}

// One Marktplaats browse. `paths` match the listing's subcategory slug — the part
// of its URL after /v/<category>/ — which is the only reliable way to tell a bike
// from a bike part inside "Fietsen en Brommers".
export interface MarktplaatsSearch {
  id: string;
  label: string;
  color: string;
  categoryIds: number[];     // Marktplaats l1 category ids
  minEur?: number;
  maxEur: number;
  onlyPaths?: string[];      // keep a listing only if its slug starts with one of these
  skipPaths?: string[];      // drop a listing if its slug contains any of these
}
