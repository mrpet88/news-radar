import fs from "node:fs/promises";
import path from "node:path";
import type { Item } from "./types.js";
import { lanes, delivery } from "./config.js";
import { scoreItem, dedupe, withinAge, markNew, pickPerLane } from "./filter.js";
import { renderHtml } from "./render.js";
import { writeDigest } from "./digest.js";
import {
  DASHBOARD, DIGEST, ensureDataDir, loadReach, loadSeen, saveSeen,
  loadState, saveState, saveItems, reachAgeHours,
} from "./store.js";

function dashboardUrl(): string | undefined {
  if (process.env.NEWS_RADAR_DASHBOARD_URL) return process.env.NEWS_RADAR_DASHBOARD_URL;
  const repo = process.env.GITHUB_REPOSITORY;   // "owner/name" on Actions
  if (!repo) return undefined;
  const [owner, name] = repo.split("/");
  return `https://${owner}.github.io/${name}/`;
}

async function main() {
  await ensureDataDir();

  const reach = await loadReach();
  const ageH = reachAgeHours(reach);
  const forced = process.env.NEWS_RADAR_DIGEST_FORCE === "true";

  // Score every collected item against the lanes; anything that matches nothing
  // (or trips an exclusion) is dropped here and never reaches the dashboard.
  const raw = reach?.items ?? [];
  const scored = raw
    .map((it) => scoreItem(it as Item, lanes))
    .filter((it): it is Item => it !== null);

  const fresh = withinAge(scored, delivery.maxItemAgeDays);
  const unique = dedupe(fresh);

  const seen = await loadSeen();
  const seenIds = new Set(seen.map((e) => e.id));
  const marked = markNew(unique, seenIds)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) ||
      Date.parse(b.publishedAt ?? b.collectedAt) - Date.parse(a.publishedAt ?? a.collectedAt));

  // The dashboard always updates, even when the email is gated — it costs nothing
  // and is where the staleness is visible for free.
  await saveItems(marked);
  await fs.writeFile(DASHBOARD, renderHtml(marked, lanes, reach, ageH));

  const newItems = marked.filter((i) => i.isNew);
  const picked = pickPerLane(newItems.length ? newItems : forced ? marked : [], lanes, delivery.maxRows);

  const state = await loadState();
  const decision = await writeDigest(DIGEST, picked, lanes, reach, ageH, state, dashboardUrl(), forced);

  // Only a real digest advances seen-history. If the gate blocked the email, these
  // items must stay "new" so they are still mailable once collection refreshes —
  // marking them seen here would silently swallow them forever.
  const now = new Date().toISOString();
  if (decision.kind === "digest") {
    // Everything that reached the dashboard counts as surfaced, not just the slice
    // that fit in the email. Recording only `picked` left the remainder permanently
    // new: re-offered as digest candidates every day, and badged NEW forever.
    await saveSeen(seen, marked);
    await saveState({ ...state, lastDigestAt: now });
  } else if (decision.kind === "heartbeat") {
    await saveState({ ...state, lastHeartbeatAt: now });
  } else if (!state.lastDigestAt) {
    // Start the heartbeat clock at install time, so the first genuine silence is
    // measured from here rather than from the epoch.
    await saveState({ ...state, lastDigestAt: now });
  }

  const laneCount = (id: string) => marked.filter((i) => i.lane === id).length;
  console.log(`\n── News Radar ──`);
  console.log(`reach payload:    ${reach ? `${raw.length} items, ${ageH === null ? "?" : ageH.toFixed(1)}h old, host ${reach.host}` : "MISSING"}`);
  console.log(`matched lanes:    ${scored.length}  (${lanes.map((l) => `${l.label} ${laneCount(l.id)}`).join(" · ")})`);
  console.log(`after age+dedupe: ${marked.length}`);
  console.log(`NEW this run:     ${newItems.length}`);
  console.log(`digest:           ${decision.kind} — ${decision.reason}`);
  if (decision.send) console.log(`subject:          ${decision.subject}`);
  console.log(`→ ${path.relative(process.cwd(), DASHBOARD)}${decision.send ? ` + ${path.relative(process.cwd(), DIGEST)}` : ""}`);

  if (picked.length) {
    console.log(`\nTop picks:`);
    for (const i of picked) {
      console.log(`  • [${i.score}] (${i.lane}/${i.channel}) ${i.title.slice(0, 90)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
