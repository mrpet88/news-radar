#!/usr/bin/env node
// agent-reach collector — runs on the Mac only.
//
// Every channel here needs something a CI runner does not have: mcporter's local
// config (exa), a gh token, a live Chrome session with the OpenCLI extension
// (reddit), or exported cookies (twitter). That is why collection is local-only
// and Actions merely renders what this script pushed.
//
// Plain ESM on purpose: launchd runs it directly. It imports the compiled config
// from dist/ so there is exactly one source of truth for what gets tracked.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "reach-raw.json");

let lanes, collector;
try {
  ({ lanes, collector } = await import(path.join(ROOT, "dist", "config.js")));
} catch {
  console.error("dist/config.js missing — run `npm run build` first.");
  process.exit(1);
}
const { getText, stripHtml } = await import(path.join(ROOT, "dist", "util", "http.js"));
const { hashId, canonicalUrl } = await import(path.join(ROOT, "dist", "util", "id.js"));

const NOW = new Date().toISOString();
// REACH_CHANNELS=exa,github restricts the run — handy when testing one channel.
const ONLY = (process.env.REACH_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wanted = (c) => ONLY.length === 0 || ONLY.includes(c);

// A summary is only worth carrying if it says more than the title already does.
// Hacker News, for one, sets every description to the word "Comments".
function usefulSummary(summary, title) {
  const s = (summary ?? "").trim();
  if (s.length < 30) return undefined;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(s) === norm(title ?? "")) return undefined;
  return s;
}

const mkItem = (o) => ({
  id: hashId([o.channel, canonicalUrl(o.url) || o.title]),
  collectedAt: NOW,
  ...o,
  summary: usefulSummary(o.summary, o.title),
});

// execFile already kills on timeout; we surface a short reason rather than a stack.
async function sh(cmd, args, timeoutMs) {
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    killSignal: "SIGKILL",
  });
  return stdout;
}

const oneLine = (e) => {
  const m = (e?.message ?? String(e)).split("\n")[0].slice(0, 200);
  return e?.killed || /ETIMEDOUT/.test(m) ? `timed out after the channel budget (${m})` : m;
};

// ── exa: semantic web search via mcporter ──────────────────────────────────────
// Output is JSON wrapping a text blob of "Title:/URL:/Published:/Author:/Highlights:"
// records. Splitting on the Title: line is more robust than trusting a separator.
function parseExaText(text) {
  const out = [];
  const blocks = text.split(/\n(?=Title:\s)/g);
  for (const b of blocks) {
    const title = /^Title:\s*(.+)$/m.exec(b)?.[1]?.trim();
    const url = /^URL:\s*(\S+)$/m.exec(b)?.[1]?.trim();
    if (!title || !url) continue;
    const pub = /^Published:\s*(.+)$/m.exec(b)?.[1]?.trim();
    const author = /^Author:\s*(.+)$/m.exec(b)?.[1]?.trim();
    const hl = b.split(/^Highlights:\s*$/m)[1] ?? "";
    out.push({
      title,
      url,
      publishedAt: pub && pub !== "N/A" ? pub : undefined,
      author: author && author !== "N/A" ? author : undefined,
      summary: stripHtml(hl).replace(/\.\.\./g, " ").slice(0, 400),
    });
  }
  return out;
}

async function collectExa(lane) {
  const items = [];
  for (const q of lane.exaQueries) {
    const raw = await sh("mcporter", [
      "call", "exa.web_search_exa",
      `query=${q}`,
      `numResults=${collector.exaResultsPerQuery}`,
      "--output", "json",
      "--timeout", String(collector.timeoutMs.exa),
    ], collector.timeoutMs.exa + 10_000);

    const text = (JSON.parse(raw).content ?? [])
      .filter((c) => c.type === "text").map((c) => c.text).join("\n");

    for (const r of parseExaText(text)) {
      items.push(mkItem({ channel: "exa", source: new URL(r.url).hostname.replace(/^www\./, ""), ...r }));
    }
  }
  return items;
}

// ── github: gh search repos ───────────────────────────────────────────────────
async function collectGithub(lane) {
  const items = [];
  for (const q of lane.githubQueries ?? []) {
    const raw = await sh("gh", [
      "search", "repos", q,
      "--sort", "updated",
      "--stars", `>=${collector.githubMinStars}`,
      "--limit", String(collector.githubResultsPerQuery),
      "--json", "fullName,description,url,stargazersCount,updatedAt",
    ], collector.timeoutMs.github);

    for (const r of JSON.parse(raw)) {
      if (!r.url || !r.fullName) continue;
      items.push(mkItem({
        channel: "github",
        title: `${r.fullName} — ${r.description ?? "no description"}`.slice(0, 200),
        url: r.url,
        source: r.fullName.split("/")[0],
        summary: r.description ?? undefined,
        stars: r.stargazersCount,
        publishedAt: r.updatedAt,
      }));
    }
  }
  return items;
}

// ── reddit: opencli, needs the Chrome extension actually connected ────────────
async function collectReddit(lane) {
  const items = [];
  for (const sub of lane.subreddits ?? []) {
    // --window background matters for the unattended run: without it OpenCLI can
    // pull a Chrome window to the front at 06:45.
    const raw = await sh("opencli", [
      "reddit", "subreddit", sub,
      "--sort", "new",
      "--limit", String(collector.redditPostsPerSub),
      "--window", "background",
      "-f", "json",
    ], collector.timeoutMs.reddit);
    let posts;
    try { posts = JSON.parse(raw); } catch { continue; }
    for (const p of Array.isArray(posts) ? posts : posts.posts ?? []) {
      const url = p.url ?? p.permalink;
      if (!url || !p.title) continue;
      items.push(mkItem({
        channel: "reddit",
        title: p.title,
        url: url.startsWith("http") ? url : `https://reddit.com${url}`,
        source: `r/${sub}`,
        summary: stripHtml(p.selftext ?? p.body ?? "").slice(0, 400) || undefined,
        author: p.author,
        points: p.score ?? p.ups,
        publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : undefined,
      }));
    }
  }
  return items;
}

// ── twitter: twitter-cli, needs TWITTER_AUTH_TOKEN + TWITTER_CT0 ──────────────
async function collectTwitter(lane) {
  if (!process.env.TWITTER_AUTH_TOKEN || !process.env.TWITTER_CT0) {
    const e = new Error("no TWITTER_AUTH_TOKEN / TWITTER_CT0 in env");
    e.precondition = true;
    throw e;
  }
  const items = [];
  for (const q of lane.twitterQueries ?? []) {
    const raw = await sh("twitter", [
      "search", q,
      "-t", "latest",
      "--exclude", "retweets",
      "--min-likes", String(collector.twitterMinLikes),
      "-n", String(collector.twitterPerQuery),
      "--json",
    ], collector.timeoutMs.twitter);
    let tweets;
    try { tweets = JSON.parse(raw); } catch { continue; }
    for (const t of Array.isArray(tweets) ? tweets : tweets.tweets ?? []) {
      if (!t.id && !t.url) continue;
      const url = t.url ?? `https://x.com/${t.username ?? "i"}/status/${t.id}`;
      items.push(mkItem({
        channel: "twitter",
        title: stripHtml(t.text ?? "").slice(0, 200),
        url,
        source: t.username ? `@${t.username}` : "x.com",
        summary: stripHtml(t.text ?? "").slice(0, 400),
        author: t.username,
        points: t.likes ?? t.favorite_count,
        publishedAt: t.created_at ? new Date(t.created_at).toISOString() : undefined,
      }));
    }
  }
  return items;
}

// ── rss: direct fetch, no browser needed ──────────────────────────────────────
// Minimal RSS/Atom extraction. Feeds here are well-formed publisher feeds, so a
// tag-scoped regex pass is enough and keeps the zero-dependency rule intact.
function parseFeed(xml, feedName, limit) {
  const entries = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map((m) => m[0]).slice(0, limit);
  const pick = (block, tag) => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
    return m ? stripHtml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : undefined;
  };
  const out = [];
  for (const b of entries) {
    const title = pick(b, "title");
    // RSS puts the link in the element body; Atom puts it in an href attribute.
    const link = pick(b, "link") ||
      /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b)?.[1];
    if (!title || !link) continue;
    out.push({
      title,
      url: link.trim(),
      source: feedName,
      summary: (pick(b, "description") ?? pick(b, "summary") ?? pick(b, "content"))?.slice(0, 400),
      author: pick(b, "dc:creator") ?? pick(b, "name"),
      publishedAt: pick(b, "pubDate") ?? pick(b, "published") ?? pick(b, "updated"),
    });
  }
  return out;
}

async function collectRss(lane) {
  const items = [];
  const failed = [];
  for (const feed of lane.feeds ?? []) {
    try {
      const xml = await getText(feed.url, { timeoutMs: collector.timeoutMs.rss });
      for (const r of parseFeed(xml, feed.name, collector.feedItemsPerFeed)) {
        const publishedAt = r.publishedAt && !Number.isNaN(Date.parse(r.publishedAt))
          ? new Date(r.publishedAt).toISOString() : undefined;
        items.push(mkItem({ channel: "rss", ...r, publishedAt }));
      }
    } catch (e) {
      // One dead feed must not take the whole channel down with it.
      failed.push(`${feed.name}: ${oneLine(e)}`);
    }
  }
  if (failed.length) console.warn(`  [rss] ${failed.length} feed(s) failed → ${failed.join(" | ")}`);
  return items;
}

// ── driver ────────────────────────────────────────────────────────────────────
const CHANNELS = [
  ["exa", collectExa],
  ["github", collectGithub],
  ["rss", collectRss],
  ["reddit", collectReddit],
  ["twitter", collectTwitter],
];

async function main() {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const items = [];
  const reports = [];

  for (const [channel, fn] of CHANNELS) {
    if (!wanted(channel)) {
      reports.push({ channel, ok: false, count: 0, ms: 0, skipped: "not in REACH_CHANNELS" });
      continue;
    }
    const t0 = Date.now();
    let got = [];
    let error;
    let precondition;
    for (const lane of lanes) {
      try {
        const laneItems = await fn(lane);
        got.push(...laneItems.map((i) => ({ ...i, laneHint: lane.id })));
      } catch (e) {
        // Record the first failure but keep trying the other lane: a query that
        // trips one channel should not silently drop the other lane's coverage.
        error ??= oneLine(e);
        precondition ||= Boolean(e?.precondition);
      }
    }
    const ms = Date.now() - t0;
    const ok = got.length > 0 || !error;
    reports.push({
      channel, ok, count: got.length, ms,
      ...(error && !ok ? (precondition ? { skipped: error } : { error }) : {}),
    });
    items.push(...got);
    const status = ok ? `${got.length} items` : precondition ? `skipped — ${error}` : `FAILED — ${error}`;
    console.log(`  [${channel}] ${status} (${(ms / 1000).toFixed(1)}s)`);
  }

  let agentReachVersion;
  try { agentReachVersion = (await sh("agent-reach", ["--version"], 10_000)).trim(); } catch { /* optional */ }

  const okCount = reports.filter((r) => r.ok).length;
  const skipCount = reports.filter((r) => r.skipped).length;
  const failCount = reports.filter((r) => !r.ok && !r.skipped).length;
  console.log(`\n── reach-collect ──`);
  console.log(`channels:     ${okCount} ok · ${skipCount} skipped · ${failCount} failed`);
  console.log(`items:        ${items.length}`);

  // A run where every channel came back empty produced nothing agent-reach-backed.
  // Leave the previous file untouched so its collectedAt keeps aging: overwriting
  // it here would refresh the freshness stamp with no content behind it, and the
  // digest gate would then green-light an email built from nothing.
  if (items.length === 0) {
    console.error("no items collected from any channel — leaving previous reach-raw.json untouched");
    process.exit(2);
  }

  const payload = {
    version: 1,
    collectedAt: NOW,
    host: os.hostname(),
    agentReachVersion,
    channels: reports,
    items,
  };
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`→ ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
