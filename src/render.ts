import type { Item, Lane, ReachPayload } from "./types.js";
import { delivery } from "./config.js";

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const ago = (hours: number) =>
  hours < 1 ? `${Math.round(hours * 60)} min ago`
    : hours < 24 ? `${Math.round(hours)}h ago`
      : `${Math.round(hours / 24)}d ago`;

export function renderHtml(
  items: Item[], lanes: Lane[], reach: ReachPayload | null, reachAgeHours: number | null,
): string {
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: delivery.timezone,
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const newCount = items.filter((i) => i.isNew).length;
  const stale = reachAgeHours === null || reachAgeHours > delivery.maxReachAgeHours;

  const laneChips = lanes.map((l) => {
    const n = items.filter((i) => i.lane === l.id).length;
    return `<button class="chip" data-filter="lane" data-value="${esc(l.id)}" style="--c:${esc(l.color)}">${esc(l.label)} <span>${n}</span></button>`;
  }).join("");

  const channels = [...new Set(items.map((i) => i.channel))].sort();
  const chanChips = channels.map((c) => {
    const n = items.filter((i) => i.channel === c).length;
    return `<button class="chip alt" data-filter="channel" data-value="${esc(c)}">${esc(c)} <span>${n}</span></button>`;
  }).join("");

  const channelBar = reach
    ? reach.channels.map((c) => {
      const cls = c.skipped ? "skip" : c.ok ? "ok" : "bad";
      const detail = c.skipped ?? c.error ?? `${c.count} items · ${(c.ms / 1000).toFixed(1)}s`;
      return `<li class="${cls}"><b>${esc(c.channel)}</b> <span>${esc(detail)}</span></li>`;
    }).join("")
    : `<li class="bad"><b>no collection</b> <span>run scripts/reach-collect.mjs</span></li>`;

  const cards = items.map((i) => {
    const lane = lanes.find((l) => l.id === i.lane);
    const meta = [
      esc(i.source),
      i.channel === "github" && i.stars !== undefined ? `★ ${i.stars}` : "",
      i.points !== undefined ? `${i.points} pts` : "",
      i.publishedAt ? esc(new Date(i.publishedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })) : "",
    ].filter(Boolean).join(" · ");
    return `
    <article class="card${i.isNew ? " new" : ""}" data-lane="${esc(i.lane ?? "")}" data-channel="${esc(i.channel)}" data-new="${i.isNew ? 1 : 0}">
      <div class="top">
        <span class="lane" style="--c:${esc(lane?.color ?? "#6b7280")}">${esc(lane?.label ?? "")}</span>
        <a class="title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
        ${i.isNew ? '<span class="badge">NEW</span>' : ""}
      </div>
      <div class="meta">${meta} <span class="ch">${esc(i.channel)}</span></div>
      ${i.summary ? `<p class="sum">${esc(i.summary.slice(0, 300))}${i.summary.length > 300 ? "…" : ""}</p>` : ""}
    </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>News Radar</title>
<style>
  :root{--bg:#f6f7f9;--fg:#1a1d23;--mut:#6b7280;--card:#fff;--line:#e3e6ea;--acc:#2563eb}
  @media (prefers-color-scheme:dark){
    :root{--bg:#0f1115;--fg:#e6e8ec;--mut:#9aa1ab;--card:#171a20;--line:#272b33;--acc:#6ea8fe}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:400 15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:24px 16px 64px}
  h1{margin:0;font-size:22px;letter-spacing:-.01em}
  .sub{margin-top:4px;color:var(--mut);font-size:13px}
  .banner{margin-top:12px;padding:9px 12px;border-radius:8px;font-size:13px;
    background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
  .banner.fresh{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
  @media (prefers-color-scheme:dark){
    .banner{background:#2a1a0d;border-color:#7c3a10;color:#fdba74}
    .banner.fresh{background:#0d1f14;border-color:#166534;color:#86efac}
  }
  .health{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
  .health li{font-size:12px;padding:3px 9px;border-radius:99px;border:1px solid var(--line);background:var(--card)}
  .health li b{font-weight:600}
  .health li span{color:var(--mut)}
  .health li.ok b{color:#16a34a}.health li.bad b{color:#dc2626}.health li.skip b{color:var(--mut)}
  .filters{margin:18px 0 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .chip{cursor:pointer;font:inherit;font-size:13px;padding:5px 11px;border-radius:99px;
    border:1px solid var(--line);background:var(--card);color:var(--fg)}
  .chip span{color:var(--mut);font-size:12px}
  .chip[aria-pressed="true"]{border-color:var(--c,var(--acc));box-shadow:inset 0 0 0 1px var(--c,var(--acc))}
  .chip.alt{font-size:12px;opacity:.85}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-top:10px}
  .card.new{border-left:3px solid var(--acc)}
  .card[hidden]{display:none}
  .top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .lane{font-size:11px;font-weight:700;letter-spacing:.04em;color:#fff;background:var(--c);
    padding:1px 7px;border-radius:10px;white-space:nowrap}
  .title{font-weight:600;color:var(--fg);text-decoration:none;flex:1;min-width:200px}
  .title:hover{color:var(--acc)}
  .badge{font-size:10px;font-weight:700;color:var(--acc)}
  .meta{margin-top:4px;font-size:12.5px;color:var(--mut)}
  .ch{border:1px solid var(--line);border-radius:4px;padding:0 5px;margin-left:4px;font-size:11px}
  .sum{margin:7px 0 0;font-size:13.5px;color:var(--mut)}
  .empty{margin-top:24px;color:var(--mut);font-size:14px}
</style></head><body><div class="wrap">
  <h1>News Radar</h1>
  <div class="sub">${items.length} tracked · ${newCount} new · generated ${esc(generated)}</div>
  <div class="banner${stale ? "" : " fresh"}">
    ${reach && reachAgeHours !== null
      // Deliberately no hostname: this page can be published to GitHub Pages, and
      // the collecting machine's name has no business on a public URL. The email
      // still names it — that copy only ever goes to the one recipient.
      ? `agent-reach collected ${esc(ago(reachAgeHours))}${stale ? ` — older than the ${delivery.maxReachAgeHours}h email gate, so no digest goes out until it refreshes` : ""}`
      : "no agent-reach collection yet — run <code>node scripts/reach-collect.mjs</code>"}
  </div>
  <ul class="health">${channelBar}</ul>
  <div class="filters">
    <button class="chip" data-filter="new" data-value="1">New only</button>
    ${laneChips}${chanChips}
  </div>
  <div id="list">${cards || '<p class="empty">Nothing matched the current lanes. Widen <code>src/config.ts</code> or check the channel health above.</p>'}</div>
</div>
<script>
  // Filters are additive within a group, AND across groups.
  const active = { lane: new Set(), channel: new Set(), new: new Set() };
  document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.filter, v = b.dataset.value, s = active[g];
    s.has(v) ? s.delete(v) : s.add(v);
    b.setAttribute("aria-pressed", s.has(v));
    apply();
  }));
  function apply() {
    document.querySelectorAll(".card").forEach((c) => {
      const okLane = !active.lane.size || active.lane.has(c.dataset.lane);
      const okCh = !active.channel.size || active.channel.has(c.dataset.channel);
      const okNew = !active.new.size || c.dataset.new === "1";
      c.hidden = !(okLane && okCh && okNew);
    });
  }
</script></body></html>`;
}
