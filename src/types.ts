// One normalized shape every agent-reach channel maps into.
export type Channel =
  | "exa"        // semantic web search (mcporter → exa MCP)
  | "github"     // gh search repos
  | "reddit"     // opencli reddit  (needs live Chrome + OpenCLI extension)
  | "twitter"    // twitter-cli     (needs TWITTER_AUTH_TOKEN + TWITTER_CT0)
  | "rss"        // direct feed fetch
  | "v2ex";      // public API

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
  author?: string;
  publishedAt?: string;  // ISO when the origin reports one
  collectedAt: string;   // ISO — set by the collector, drives the freshness gate
  stars?: number;        // github only
  points?: number;       // reddit/v2ex score, when the channel reports one
  isNew?: boolean;       // unseen in seen-history at render time
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

// The collector's output file: data/reach-raw.json
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
