import fs from "node:fs/promises";
import path from "node:path";
import type { Item } from "./types.js";
import { lanes, delivery } from "./config.js";
import { scoreItem, dedupe, withinAge, markNew, pickPerLane } from "./filter.js";
import { renderHtml } from "./render.js";
import { writeDigest } from "./digest.js";
import { buildPaper, isPaperItem, allPicked, pickedCount } from "./paper.js";
import { applyTranslations } from "./translate.js";
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
  // Newspaper items (news, marktplaats) never go through lane scoring: a BBC story
  // about AI is world news, not an AI-lane pick.
  const all = reach?.items ?? [];
  const raw = all.filter((i) => !isPaperItem(i as Item));
  const scored = raw
    .map((it) => scoreItem(it as Item, lanes))
    .filter((it): it is Item => it !== null);

  const fresh = withinAge(scored, delivery.maxItemAgeDays);
  const unique = dedupe(fresh);

  const seen = await loadSeen();
  const seenIds = new Set(seen.map((e) => e.id));
  const paper = buildPaper(all.filter((i) => isPaperItem(i as Item)) as Item[], seenIds);
  const marked = markNew(unique, seenIds)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) ||
      Date.parse(b.publishedAt ?? b.collectedAt) - Date.parse(a.publishedAt ?? a.collectedAt));

  // Translate only when an email can go out: credit is finite, and a gated run's
  // picks would be translated for nobody.
  const gateOpen = ageH !== null && (ageH <= delivery.maxReachAgeHours || forced);
  const translation = await applyTranslations(paper, gateOpen);

  // The dashboard always updates, even when the email is gated — it costs nothing
  // and is where the staleness is visible for free.
  await saveItems(marked);
  await fs.writeFile(DASHBOARD, renderHtml(marked, lanes, reach, ageH, paper, translation));

  const newItems = marked.filter((i) => i.isNew);
  const picked = pickPerLane(newItems.length ? newItems : forced ? marked : [], lanes, delivery.maxRows);

  const state = await loadState();
  const decision = await writeDigest(DIGEST, picked, lanes, reach, ageH, state, dashboardUrl(), forced, paper);

  // Only a real digest advances seen-history. If the gate blocked the email, these
  // items must stay "new" so they are still mailable once collection refreshes —
  // marking them seen here would silently swallow them forever.
  const now = new Date().toISOString();
  if (decision.kind === "digest") {
    // Everything that reached the dashboard counts as surfaced, not just the slice
    // that fit in the email. Recording only `picked` left the remainder permanently
    // new: re-offered as digest candidates every day, and badged NEW forever.
    //
    // The newspaper is the opposite: only what was actually mailed counts as sent.
    // Its dashboard lists run longer than the email, and an unsent listing or
    // headline should stay eligible for tomorrow.
    await saveSeen(seen, [...marked, ...allPicked(paper)]);
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
  console.log(`reach payload:    ${reach ? `${all.length} items (${raw.length} radar), ${ageH === null ? "?" : ageH.toFixed(1)}h old` : "MISSING"}`);
  console.log(`matched lanes:    ${scored.length}  (${lanes.map((l) => `${l.label} ${laneCount(l.id)}`).join(" · ")})`);
  console.log(`after age+dedupe: ${marked.length}`);
  console.log(`NEW this run:     ${newItems.length}`);
  console.log(`newspaper:        ${pickedCount(paper.news)} headlines (${paper.news.map((x) => `${x.label} ${x.picked.length}`).join(" · ")})`);
  console.log(`translate:        ${translation.state} — ${translation.detail}`);
  console.log(`marktplaats:      ${pickedCount(paper.market)} listings (${paper.market.map((x) => `${x.label} ${x.picked.length}`).join(" · ")})`);
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
