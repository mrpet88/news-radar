import fs from "node:fs/promises";
import path from "node:path";
import type { Item, ReachPayload } from "./types.js";

export const DATA_DIR = path.resolve("data");
export const REACH_FILE = path.join(DATA_DIR, "reach-raw.json");
export const SEEN_FILE = path.join(DATA_DIR, "seen-history.json");
export const STATE_FILE = path.join(DATA_DIR, "digest-state.json");
export const ITEMS_FILE = path.join(DATA_DIR, "items.json");
export const DASHBOARD = path.join(DATA_DIR, "index.html");
// Email body for one run. Written outside data/ so it is neither committed nor published.
export const DIGEST = path.resolve("digest.html");

// Ids stay in seen-history for this long. Long enough that a story reappearing in
// a feed doesn't re-alert, short enough that the file can't grow without bound.
const SEEN_TTL_DAYS = 60;

export interface SeenEntry { id: string; firstSeen: string }
export interface DigestState { lastDigestAt?: string; lastHeartbeatAt?: string }

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; }
  catch { return fallback; }
}

export const loadReach = (): Promise<ReachPayload | null> =>
  readJson<ReachPayload | null>(REACH_FILE, null);

export async function loadSeen(): Promise<SeenEntry[]> {
  const cutoff = Date.now() - SEEN_TTL_DAYS * 86_400_000;
  const all = await readJson<SeenEntry[]>(SEEN_FILE, []);
  return all.filter((e) => {
    const t = Date.parse(e.firstSeen);
    return Number.isNaN(t) || t >= cutoff;
  });
}

export async function saveSeen(prev: SeenEntry[], items: Item[]): Promise<void> {
  const known = new Set(prev.map((e) => e.id));
  const now = new Date().toISOString();
  const merged = [...prev];
  for (const it of items) if (!known.has(it.id)) merged.push({ id: it.id, firstSeen: now });
  await fs.writeFile(SEEN_FILE, JSON.stringify(merged, null, 2));
}

export const loadState = (): Promise<DigestState> => readJson<DigestState>(STATE_FILE, {});
export const saveState = (s: DigestState): Promise<void> =>
  fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));

export const saveItems = (items: Item[]): Promise<void> =>
  fs.writeFile(ITEMS_FILE, JSON.stringify(items, null, 2));

export const ensureDataDir = (): Promise<string | undefined> =>
  fs.mkdir(DATA_DIR, { recursive: true });

// Hours since the collector last ran, or null when it has never run.
export function reachAgeHours(payload: ReachPayload | null): number | null {
  if (!payload?.collectedAt) return null;
  const t = Date.parse(payload.collectedAt);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}
