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
  twitter: 0.85,
  github: 0.6,    // interesting, but a push is not an announcement
  v2ex: 0.8,
};

// ── Collector limits (per run, per lane) ──
export const collector = {
  exaResultsPerQuery: 6,
  githubResultsPerQuery: 5,
  // Quality floor for repo search. Without it, `--sort updated` returns whatever
  // was pushed in the last minute — overwhelmingly student exercises and portfolio
  // repos. A star floor is the cheapest available proxy for "anyone else cares".
  githubMinStars: 120,
  redditPostsPerSub: 8,
  twitterPerQuery: 8,
  // X has no quality floor of its own; likes are the only cheap proxy available.
  twitterMinLikes: 25,
  feedItemsPerFeed: 12,
  // Each channel gets its own wall-clock budget. Reddit/Twitter routinely hang
  // when their backend is not connected, and a hung channel must not stall the run.
  timeoutMs: { exa: 60_000, github: 30_000, reddit: 25_000, twitter: 25_000, rss: 20_000, v2ex: 15_000 },
};
