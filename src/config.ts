import type { Lane } from "./types.js";

// ── EDIT THIS to change what the radar tracks. No code changes needed. ──
//
// Two lanes, kept deliberately narrow. Volume is the thing that kills a daily
// digest: five items you actually read beats forty you archive. Widen only after
// a week of runs shows a lane is genuinely too quiet.

export const lanes: Lane[] = [
  {
    id: "qa",
    label: "QA / Testing",
    color: "#16a34a",
    maxPerDigest: 6,
    keywordTiers: [
      {
        // Leadership and practice — the level you actually work at.
        tier: "core", weight: 10, groups: [
          ["test", "strategy"], ["testing", "strategy"],
          ["quality", "engineering"], ["quality", "culture"],
          ["qa", "lead"], ["qa", "manager"], ["test", "manager"],
          ["head", "of", "quality"], ["quality", "coach"],
          ["shift", "left"], ["shift-left"],
          ["test", "architecture"], ["testability"],
          ["flaky", "test"], ["flaky", "tests"],
          ["test", "automation", "strategy"],
          ["exploratory", "testing"], ["risk", "based", "testing"],
          ["contract", "testing"], ["mutation", "testing"],
          ["quality", "metrics"], ["defect", "escape"],
          ["testing", "in", "production"],
        ],
      },
      {
        // Tooling and adjacent practice — useful, ranked below the leadership set.
        tier: "adjacent", weight: 4, groups: [
          ["playwright"], ["cypress"], ["selenium"],
          ["test", "coverage"], ["end", "to", "end", "testing"],
          ["ci", "pipeline"], ["continuous", "delivery"],
          ["observability", "testing"], ["chaos", "engineering"],
          ["performance", "testing"], ["load", "testing"],
          ["accessibility", "testing"],
        ],
      },
    ],
    // Word-boundary matched. Tuned against the usual "quality" false positives:
    // pharma/food/manufacturing QA has nothing to do with software testing.
    excludeKeywords: [
      "pharmaceutical", "gmp", "iso 9001", "food safety", "haccp",
      "clinical", "medical device", "manufacturing quality", "welding",
      "air quality", "water quality", "sleep quality", "audio quality",
      // Physical-world "testing" that shares the vocabulary and nothing else — a
      // tweet about an autonomous-vehicle test track scored as QA leadership.
      "test track", "crash test", "drug test", "blood test", "covid test",
      "soil test", "emissions test", "highway", "raceway",
    ],
    // Exa rewards a description of the ideal *page*, not keywords — and it has no
    // date filter, so "recently published blog post" is the only recency lever we
    // get at query time. Recency is enforced properly downstream in scoreItem.
    exaQueries: [
      "recently published blog post about software test strategy or quality engineering leadership",
      "recent engineering blog post about shift-left testing practices in a real team",
      "recent blog post about flaky tests and test suite reliability at scale",
    ],
    githubQueries: ["test automation framework", "contract testing"],
    subreddits: ["QualityAssurance", "softwaretesting"],
    twitterQueries: ["quality engineering", "test strategy"],
    // martinfowler.com/feed.atom refuses connections from here (curl gets 000), so
    // it is deliberately absent rather than silently failing every run.
    feeds: [
      { name: "Google Testing Blog", url: "https://testing.googleblog.com/feeds/posts/default" },
      { name: "Alan Page", url: "https://angryweasel.com/blog/feed/" },
      { name: "Dan Ashby", url: "https://danashby.co.uk/feed/" },
      { name: "James Bach", url: "https://www.satisfice.com/feed" },
    ],
  },
  {
    id: "ai",
    label: "AI / Agents",
    color: "#7c3aed",
    maxPerDigest: 8,
    keywordTiers: [
      {
        tier: "core", weight: 10, groups: [
          ["ai", "agent"], ["agentic"], ["agent", "framework"],
          ["mcp"], ["model", "context", "protocol"],
          ["claude"], ["anthropic"],
          ["tool", "use"], ["function", "calling"],
          ["llm", "eval"], ["agent", "eval"], ["evals"],
          ["prompt", "caching"], ["context", "window"],
          ["coding", "agent"], ["autonomous", "agent"],
          ["rag"], ["retrieval", "augmented"],
          ["fine", "tuning"], ["inference", "cost"],
        ],
      },
      {
        tier: "adjacent", weight: 4, groups: [
          ["openai"], ["gemini"], ["llama"], ["mistral"],
          ["vector", "database"], ["embedding"],
          ["open", "source", "model"], ["local", "llm"],
          ["ai", "governance"], ["ai", "safety"],
          ["developer", "tools", "ai"], ["copilot"],
        ],
      },
    ],
    excludeKeywords: [
      "crypto", "token price", "airdrop", "nft",
      "stock tips", "buy now", "discount code", "coupon",
      "girlfriend", "waifu", "onlyfans",
    ],
    exaQueries: [
      "news article announcing a new AI agent framework or agent tooling release",
      "recent blog post about building with the Model Context Protocol in production",
      "recent engineering blog post about evaluating LLM agent reliability",
    ],
    githubQueries: ["ai agent framework", "mcp server", "llm evaluation"],
    subreddits: ["LocalLLaMA", "MachineLearning"],
    twitterQueries: ["ai agents", "mcp protocol"],
    feeds: [
      { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
      { name: "Hacker News", url: "https://news.ycombinator.com/rss" },
      { name: "GitHub Blog", url: "https://github.blog/feed/" },
    ],
  },
];

// ── Noise filter ────────────────────────────────────────────────────────────
// Exa is a semantic search engine, not a news wire: ask it about MCP and it will
// happily return the SDK reference, which is an excellent page and not news. The
// first run was 4/6 documentation, so reference material is filtered structurally
// rather than by hoping the query wording keeps it out.
export const noise = {
  // Applied to EVERY lane. Exclusions used to be per-lane only, which let crypto
  // spam through the QA lane because only the AI lane listed it — a tweet about
  // "REAL NUMBERS" and XRP matched a QA keyword and sailed straight into the digest.
  globalExclude: [
    "crypto", "bitcoin", "ethereum", "xrp", "solana", "altcoin", "airdrop", "nft",
    "token price", "presale", "pump", "moon", "hodl",
    // "coin" as a bare word catches the long tail of made-up tokens that dress
    // themselves as AI infrastructure — "Lobster Coin: AI-agent infrastructure…".
    "coin", "memecoin", "tokenomics",
    "giveaway", "retweet to win", "dm me", "link in bio", "discount code", "coupon",
    "onlyfans", "casino", "betting", "forex",
  ],
  // Promotional and engagement-bait shapes, matched against the title. X's
  // engagement ranking actively rewards these, so the twitter channel needs a
  // filter that likes and retweets cannot provide.
  hypePatterns: [
    /🚨|🔥{2,}|🚀{2,}|💰|📉|📈/u,
    /\bBREAKING\b/,
    // Opening on an emoji is the marketing/thread house style. High precision:
    // a legitimate post almost never leads with one, a promo post usually does.
    /^\s*[\p{Extended_Pictographic}]/u,
    /\b(thread|mega[- ]?thread)\s*[:🧵]/i,
    /\bhere('| i)s (how|why|what)\b.{0,40}\b(nobody|no one|everyone)\b/i,
    /\b(steal|stole) (my|this)\b/i,
    /\bif i were (starting|preparing)\b/i,
    /\b\d+\s+(tips|tricks|hacks|secrets|lessons)\b/i,
  ],
  // Matched against the URL (case-insensitive substring).
  docUrlPatterns: [
    "/docs/", "/doc/", "/reference/", "/api-reference", "/getting-started",
    "/introduction", "/quickstart", "/tutorial", "/guide/", "/manual/",
    "/sdk/", "/cli/", "/changelog", "/javadoc", "/apidocs",
    "learn.microsoft.com", "developer.mozilla.org", "docs.python.org",
    "readthedocs.io", "npmjs.com/package", "pypi.org/project",
    "stackoverflow.com", "wikipedia.org",
  ],
  // Matched against the title. Reference pages are relentlessly consistent about
  // announcing themselves in the title suffix.
  docTitlePatterns: [
    " sdk", "api reference", "documentation", "| docs", "- docs",
    "getting started", "quickstart", "cheat sheet",
  ],
  // Recency shaping. Exa reports "Published: N/A" for most reference pages, so an
  // absent date is itself a weak signal that the page is evergreen rather than new.
  recency: {
    freshDays: 3, freshBonus: 5,
    recentDays: 10, recentBonus: 2,
    staleDays: 45, stalePenalty: -4,
    undatedPenalty: -3,
  },
};

// ── Delivery rules ──
export const delivery = {
  // The email is written only when the reach payload is younger than this. Older
  // than that means the Mac has not collected recently, so there is nothing
  // agent-reach-backed to send — the dashboard still updates and shows the age.
  maxReachAgeHours: Number(process.env.NEWS_RADAR_MAX_AGE_HOURS ?? 24),
  // If no digest has gone out for this many days, send a one-line heartbeat so a
  // broken pipeline is distinguishable from a genuinely quiet stretch.
  heartbeatAfterDays: 3,
  // Hard ceiling on email rows across all lanes, after per-lane caps apply.
  maxRows: 12,
  // Items older than this never enter the digest, even if newly seen.
  maxItemAgeDays: 7,
  timezone: "Europe/Amsterdam",
};

// ── Channel weighting ───────────────────────────────────────────────────────
// Not every channel is equally newsworthy. A blog post published today is a story;
// a repo pushed today is usually just someone committing. Without this, `gh search
// --sort updated` floods the digest with brand-new personal projects, because every
// one of them looks maximally fresh.
export const channelWeight: Record<string, number> = {
  rss: 1.15,      // editorial, dated, deliberately published
  exa: 1.0,
  reddit: 0.9,
  // Lowest of the read channels. Even after the spam filters, X's median result is
  // commentary rather than news, so a tweet has to match unusually well to lead.
  twitter: 0.6,
  github: 0.6,    // interesting, but a push is not an announcement
  v2ex: 0.8,
};

// ── Collector limits (per run, per lane) ──
export const collector = {
  // Channels the scheduled run collects.
  //
  // twitter is OFF deliberately, not because it is broken — it works fine via
  // OpenCLI. Open search on X simply does not carry this kind of news: across
  // repeated runs it yielded ~1 usable item per 24 collected, and three rounds of
  // filtering each caught that round's junk while the next brought different junk
  // (crypto, then contests, then listicles). It costs ~60s a run for that.
  //
  // To turn it on usefully, put handles in a lane's `twitterHandles` and add
  // "twitter" here — searching named accounts is a different proposition from
  // searching the firehose.
  enabled: ["exa", "github", "rss", "reddit"] as string[],

  exaResultsPerQuery: 6,
  githubResultsPerQuery: 5,
  // Quality floor for repo search. Without it, `--sort updated` returns whatever
  // was pushed in the last minute — overwhelmingly student exercises and portfolio
  // repos. A star floor is the cheapest available proxy for "anyone else cares".
  githubMinStars: 120,
  redditPostsPerSub: 8,
  // Read this many from the Latest tab, then keep the best few by engagement.
  twitterPerQuery: 25,
  twitterTopByEngagement: 6,
  feedItemsPerFeed: 12,
  // Each channel gets its own wall-clock budget. Reddit/Twitter routinely hang
  // when their backend is not connected, and a hung channel must not stall the run.
  timeoutMs: { exa: 60_000, github: 30_000, reddit: 25_000, twitter: 25_000, rss: 20_000, v2ex: 15_000 },
};
