import fs from "node:fs/promises";
import path from "node:path";
import type { Item, ReachPayload, ChannelReport, Channel } from "./types.js";
import { collector } from "./config.js";

export const DATA_DIR = path.resolve("data");
// One writer each: Actions collects the network-only channels, the Mac the ones
// that need its Chrome session. Sharing one file is what made pushes conflict.
export const REACH_CLOUD = path.join(DATA_DIR, "reach-cloud.json");
export const REACH_MAC = path.join(DATA_DIR, "reach-mac.json");
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

const ageOf = (p: ReachPayload): number => (Date.now() - Date.parse(p.collectedAt)) / 3_600_000;

/**
 * Both collections merged into the one payload the render works from.
 *
 * The Mac's half is optional by design: while it is younger than
 * collector.macMaxAgeHours its items and channel reports are merged in; past that
 * its channels are reported as skipped (so the dashboard says why reddit is
 * missing) and the email goes out on the cloud half alone. collectedAt is the
 * newest included half, so the freshness gate only closes when *both* have stopped.
 */
export async function loadReach(): Promise<ReachPayload | null> {
  const cloud = await readJson<ReachPayload | null>(REACH_CLOUD, null);
  const mac = await readJson<ReachPayload | null>(REACH_MAC, null);

  const macChannels = collector.enabled.filter((c) => !collector.cloudChannels.includes(c)) as Channel[];
  const macFresh = mac !== null && ageOf(mac) < collector.macMaxAgeHours;
  // Filtered to the Mac's own channels, so a payload written before a channel moved
  // to the cloud cannot report (or supply) it twice.
  const macOwn = <T extends { channel: string }>(xs: T[]) => xs.filter((x) => macChannels.includes(x.channel as Channel));
  const macReports: ChannelReport[] = macFresh
    ? macOwn(mac.channels)
    : macChannels.map((channel) => ({
        channel, ok: false, count: 0, ms: 0,
        skipped: mac
          ? `Mac collection is ${Math.round(ageOf(mac))}h old — left out (Mac asleep or Chrome closed)`
          : "no Mac collection yet",
      }));

  const parts = [cloud, macFresh ? mac : null].filter((p): p is ReachPayload => p !== null);
  if (parts.length === 0) return null;
  const newest = parts.reduce((a, b) => (Date.parse(a.collectedAt) >= Date.parse(b.collectedAt) ? a : b));
  return {
    version: 1,
    collectedAt: newest.collectedAt,
    agentReachVersion: mac?.agentReachVersion ?? cloud?.agentReachVersion,
    channels: [...(cloud?.channels ?? []), ...macReports],
    items: [...(cloud?.items ?? []), ...(macFresh ? macOwn(mac.items) : [])],
  };
}

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
