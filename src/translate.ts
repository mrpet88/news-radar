import fs from "node:fs/promises";
import path from "node:path";
import type { Item } from "./types.js";
import { newspaper, translate as cfg } from "./config.js";
import { DATA_DIR } from "./store.js";
import type { Paper } from "./paper.js";

// Dutch headlines → English, via DeepL. Best-effort like every other stage: any
// failure leaves the Dutch title in place and is reported, never thrown.
//
// Credit is finite (a one-time 1M characters), so two rules keep usage minimal:
// only headlines picked for the email are sent, and every translation is cached
// by item id so nothing is ever translated twice.

const FILE = path.join(DATA_DIR, "translations.json");

interface Entry { en: string; at: string }
type Cache = Record<string, Entry>;

export interface TranslateStatus {
  state: "ok" | "off" | "quota" | "error";
  detail: string;
}

const dutch = new Set(
  newspaper.sections.flatMap((s) => s.feeds).filter((f) => f.lang === "nl").map((f) => f.name),
);
const isDutch = (i: Item) => i.channel === "news" && dutch.has(i.source);

async function loadCache(): Promise<Cache> {
  try { return JSON.parse(await fs.readFile(FILE, "utf8")) as Cache; } catch { return {}; }
}

async function saveCache(cache: Cache): Promise<void> {
  const cutoff = Date.now() - cfg.cacheDays * 86_400_000;
  const kept = Object.fromEntries(Object.entries(cache).filter(([, e]) => Date.parse(e.at) >= cutoff));
  await fs.writeFile(FILE, JSON.stringify(kept, null, 2));
}

class DeepLError extends Error {
  constructor(readonly status: number, msg: string) { super(msg); }
}

// ":fx" marks a Free-API key (api-free.deepl.com). The Developer plan's key type
// is not documented either way, so a 403 from one host is retried on the other.
async function deepl<T>(key: string, route: string, body?: unknown): Promise<T> {
  const hosts = key.endsWith(":fx")
    ? ["https://api-free.deepl.com", "https://api.deepl.com"]
    : ["https://api.deepl.com", "https://api-free.deepl.com"];
  let last: DeepLError | undefined;
  for (const host of hosts) {
    const res = await fetch(`${host}${route}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `DeepL-Auth-Key ${key}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return (await res.json()) as T;
    last = new DeepLError(res.status, `DeepL HTTP ${res.status}`);
    if (res.status !== 403) break;   // only a wrong-host key is worth a second try
  }
  throw last!;
}

/**
 * Sets titleEn on the paper's Dutch headlines. Cached translations are applied
 * everywhere (email and dashboard) for free; new ones are requested only for
 * headlines picked for the email, and only when `mayCall` — i.e. an email can
 * actually go out, so credit is never spent on a digest the gate would block.
 */
export async function applyTranslations(paper: Paper, mayCall: boolean): Promise<TranslateStatus> {
  const cache = await loadCache();
  const shown = paper.news.flatMap((s) => s.shown).filter(isDutch);
  for (const i of shown) if (cache[i.id]) i.titleEn = cache[i.id].en;

  const key = process.env.DEEPL_API_KEY?.trim();
  if (!key) return { state: "off", detail: "no DEEPL_API_KEY — Dutch titles stay Dutch" };

  const todo = paper.news.flatMap((s) => s.picked).filter((i) => isDutch(i) && !i.titleEn);
  if (todo.length === 0 || !mayCall) {
    return { state: "ok", detail: todo.length ? "skipped — no email this run" : "all cached" };
  }

  let added = 0;
  try {
    const now = new Date().toISOString();
    for (let n = 0; n < todo.length; n += 50) {           // DeepL: max 50 texts per request
      const batch = todo.slice(n, n + 50);
      const res = await deepl<{ translations: { text: string }[] }>(key, "/v2/translate", {
        text: batch.map((i) => i.title),
        source_lang: "NL",
        target_lang: cfg.target,
      });
      batch.forEach((i, k) => {
        const en = res.translations[k]?.text?.trim();
        if (en) { i.titleEn = en; cache[i.id] = { en, at: now }; added++; }
      });
    }
    await saveCache(cache);

    let usage = "";
    try {
      const u = await deepl<{ character_count: number; character_limit: number }>(key, "/v2/usage");
      usage = ` · credit ${u.character_count.toLocaleString("en-GB")} / ${u.character_limit.toLocaleString("en-GB")} used`;
    } catch { /* usage is informational only */ }
    return { state: "ok", detail: `${todo.length} translated${usage}` };
  } catch (e) {
    // Keep whatever did get translated before the failure.
    if (added) await saveCache(cache);
    const status = e instanceof DeepLError ? e.status : 0;
    // 456 is DeepL's "quota exceeded": the one-time credit is spent.
    if (status === 456) return { state: "quota", detail: "DeepL credit used up — Dutch titles stay Dutch" };
    if (status === 403) return { state: "error", detail: "DeepL rejected the key (403) — check the DEEPL_API_KEY secret" };
    return { state: "error", detail: `DeepL failed: ${(e as Error).message}` };
  }
}
