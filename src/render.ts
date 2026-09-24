import type { Item, Lane, ReachPayload } from "./types.js";
import { type Paper, type PaperSection, priceLabel } from "./paper.js";
import { delivery } from "./config.js";

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const ago = (hours: number) =>
  hours < 1 ? `${Math.round(hours * 60)} min ago`
    : hours < 24 ? `${Math.round(hours)}h ago`
      : `${Math.round(hours / 24)}d ago`;

const hhmm = (iso?: string) => iso
  ? new Date(iso).toLocaleString("en-GB", { timeZone: delivery.timezone, weekday: "short", hour: "2-digit", minute: "2-digit" })
  : "";

function newsPanel(sections: PaperSection[]): string {
  const body = sections.map((s) => `
    <h2 class="sec" style="--c:${esc(s.color)}">${esc(s.label)}</h2>
    ${s.shown.length ? s.shown.map((i) => `
    <article class="card row${i.isNew ? " new" : ""}">
      <a class="title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
      <div class="meta">${esc(i.source)}${i.publishedAt ? ` · ${esc(hhmm(i.publishedAt))}` : ""}${i.isNew ? ' <span class="badge">NEW</span>' : ""}</div>
    </article>`).join("") : '<p class="empty">No headlines from this section\'s feeds in the last day.</p>'}`).join("");
  return body || '<p class="empty">No newspaper sections configured.</p>';
}

function marketPanel(sections: PaperSection[]): string {
  return sections.map((s) => `
    <h2 class="sec" style="--c:${esc(s.color)}">${esc(s.label)}</h2>
    ${s.shown.length ? `<div class="grid">${s.shown.map((i) => `
      <a class="listing${i.isNew ? " new" : ""}" href="${esc(i.url)}" target="_blank" rel="noopener">
        ${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
        <div class="lt">${esc(i.title)}</div>
        <div class="lp"><b>${esc(priceLabel(i))}</b>${i.place ? ` · ${esc(i.place)}` : ""}${i.isNew ? ' <span class="badge">NEW</span>' : ""}</div>
      </a>`).join("")}</div>` : '<p class="empty">No listings matched this search today.</p>'}`).join("");
}

export function renderHtml(
  items: Item[], lanes: Lane[], reach: ReachPayload | null, reachAgeHours: number | null,
  paper: Paper = { news: [], market: [] },
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
  .tabs{margin:20px 0 0;display:flex;gap:4px;border-bottom:1px solid var(--line);overflow-x:auto}
  .tab{cursor:pointer;font:inherit;font-size:14px;font-weight:600;padding:9px 14px;border:0;
    border-bottom:2px solid transparent;background:none;color:var(--mut);white-space:nowrap}
  .tab span{font-weight:400;font-size:12px}
  .tab[aria-selected="true"]{color:var(--fg);border-bottom-color:var(--acc)}
  .panel[hidden]{display:none}
  .sec{margin:26px 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--c);
    border-bottom:2px solid var(--c);padding-bottom:5px}
  .card.row{padding:10px 14px;margin-top:6px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px;margin-top:10px}
  .listing{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;
    overflow:hidden;color:var(--fg);text-decoration:none}
  .listing.new{border-color:var(--acc)}
  .listing img,.listing .noimg{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--line)}
  .listing .lt{padding:8px 10px 0;font-size:13.5px;font-weight:600;line-height:1.35;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .listing .lp{padding:4px 10px 10px;font-size:12.5px;color:var(--mut)}
  .listing .lp b{color:var(--fg)}
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
  <nav class="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="radar">Radar <span>${newCount} new</span></button>
    <button class="tab" role="tab" data-tab="paper">Newspaper <span>${paper.news.reduce((n, x) => n + x.shown.length, 0)}</span></button>
    <button class="tab" role="tab" data-tab="market">Marktplaats <span>${paper.market.reduce((n, x) => n + x.shown.length, 0)}</span></button>
  </nav>
  <section class="panel" id="radar">
  <div class="filters">
    <button class="chip" data-filter="new" data-value="1">New only</button>
    ${laneChips}${chanChips}
  </div>
  <div id="list">${cards || '<p class="empty">Nothing matched the current lanes. Widen <code>src/config.ts</code> or check the channel health above.</p>'}</div>
  </section>
  <section class="panel" id="paper" hidden>${newsPanel(paper.news)}</section>
  <section class="panel" id="market" hidden>${marketPanel(paper.market)}</section>
</div>
<script>
  // Tabs follow the URL hash, so a tab can be bookmarked or linked from the email.
  function showTab(id) {
    if (!document.getElementById(id)) id = "radar";
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== id; });
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === id));
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    history.replaceState(null, "", "#" + t.dataset.tab);
    showTab(t.dataset.tab);
  }));
  showTab(location.hash.slice(1));
  // Filters are additive within a group, AND across groups.
  const active = { lane: new Set(), channel: new Set(), new: new Set() };
  document.querySelectorAll("#radar .chip").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.filter, v = b.dataset.value, s = active[g];
    s.has(v) ? s.delete(v) : s.add(v);
    b.setAttribute("aria-pressed", s.has(v));
    apply();
  }));
  function apply() {
    document.querySelectorAll("#radar .card").forEach((c) => {
      const okLane = !active.lane.size || active.lane.has(c.dataset.lane);
      const okCh = !active.channel.size || active.channel.has(c.dataset.channel);
      const okNew = !active.new.size || c.dataset.new === "1";
      c.hidden = !(okLane && okCh && okNew);
    });
  }
</script></body></html>`;
}
