import fs from "node:fs/promises";
import type { Item, ReachPayload, Lane } from "./types.js";
import { delivery } from "./config.js";
import type { DigestState } from "./store.js";

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const laneColor = (lanes: Lane[], id?: string) => lanes.find((l) => l.id === id)?.color ?? "#6b7280";
const laneLabel = (lanes: Lane[], id?: string) => lanes.find((l) => l.id === id)?.label ?? id ?? "";

const fmtTime = (d: Date) => d.toLocaleString("en-GB", {
  timeZone: delivery.timezone,
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZoneName: "short",
});

const ago = (hours: number) =>
  hours < 1 ? `${Math.round(hours * 60)} min ago`
    : hours < 24 ? `${Math.round(hours)}h ago`
      : `${Math.round(hours / 24)}d ago`;

function row(it: Item, lanes: Lane[]): string {
  const bits = [
    esc(it.source),
    it.channel === "github" && it.stars !== undefined ? `★ ${it.stars}` : "",
    it.points !== undefined ? `${it.points} pts` : "",
    esc(it.channel),
  ].filter(Boolean).join(" · ");

  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #e3e6ea">
    <div style="font:600 15px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <span style="display:inline-block;margin-right:6px;padding:1px 7px;border-radius:10px;background:${laneColor(lanes, it.lane)};color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em">${esc(laneLabel(lanes, it.lane))}</span>
      <a href="${esc(it.url)}" style="color:#1a1d23;text-decoration:none">${esc(it.title)}</a>
    </div>
    <div style="margin-top:3px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">${bits}</div>
    ${it.summary ? `<div style="margin-top:5px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#4b5563">${esc(it.summary.slice(0, 220))}${it.summary.length > 220 ? "…" : ""}</div>` : ""}
  </td></tr>`;
}

const shell = (inner: string) => `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:22px 24px">
    <tr><td>${inner}</td></tr>
  </table>
</td></tr></table></body></html>`;

export function renderDigest(
  items: Item[], lanes: Lane[], reach: ReachPayload, reachAgeHours: number, dashboardUrl?: string,
): string {
  const perLane = lanes
    .map((l) => ({ l, n: items.filter((i) => i.lane === l.id).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.l.label}`).join(" · ");

  const channels = reach.channels
    .filter((c) => c.ok && c.count > 0)
    .map((c) => `${c.channel} ${c.count}`).join(" · ");
  const degraded = reach.channels.filter((c) => !c.ok && !c.skipped);

  return shell(`
    <div style="font:700 18px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d23">News Radar — ${items.length} new</div>
    <div style="margin-top:4px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">${esc(perLane)}${perLane ? " · " : ""}${esc(fmtTime(new Date()))}</div>
    <div style="margin-top:8px;padding:6px 10px;border-radius:6px;background:#f0fdf4;border:1px solid #bbf7d0;font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#166534">
      Collected via agent-reach ${esc(ago(reachAgeHours))} on ${esc(reach.host)} — ${esc(channels || "no channels reported items")}
    </div>
    ${degraded.length ? `<div style="margin-top:6px;padding:6px 10px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9a3412">Degraded: ${esc(degraded.map((c) => c.channel).join(", "))} did not return this run.</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">
      ${items.map((i) => row(i, lanes)).join("")}
    </table>
    ${dashboardUrl ? `<div style="margin-top:18px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><a href="${esc(dashboardUrl)}" style="color:#2563eb;text-decoration:none">Open the full dashboard →</a></div>` : ""}
  `);
}

// Sent when nothing has gone out for delivery.heartbeatAfterDays. Its whole job is
// to make "quiet" distinguishable from "broken" without adding inbox noise.
export function renderHeartbeat(reach: ReachPayload | null, reachAgeHours: number | null, quietDays: number): string {
  const last = reach && reachAgeHours !== null
    ? `agent-reach last collected ${ago(reachAgeHours)} on ${esc(reach.host)} (${reach.items.length} items).`
    : "agent-reach has not produced a collection yet.";
  const bad = reach?.channels.filter((c) => !c.ok && !c.skipped).map((c) => `${c.channel}: ${c.error ?? "failed"}`) ?? [];
  return shell(`
    <div style="font:700 16px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d23">News Radar — quiet for ${quietDays} days</div>
    <div style="margin-top:6px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#4b5563">
      No digest has gone out for ${quietDays} days. ${esc(last)}
    </div>
    ${bad.length ? `<div style="margin-top:8px;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9a3412">Failing channels — ${esc(bad.join(" | "))}</div>` : ""}
    <div style="margin-top:10px;font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">This is the 3-day heartbeat, not a digest. If the Mac has been asleep this is expected.</div>
  `);
}

export interface DigestDecision {
  send: boolean;
  subject: string;
  reason: string;
  kind: "digest" | "heartbeat" | "none";
}

/**
 * Decide whether an email may go out, and write digest.html when it may.
 *
 * The gate is deliberately strict about provenance: an email is only ever written
 * from a reach payload younger than delivery.maxReachAgeHours. Stale or missing
 * collection means no digest, because there is nothing agent-reach-backed to send.
 */
export async function writeDigest(
  file: string,
  picked: Item[],
  lanes: Lane[],
  reach: ReachPayload | null,
  reachAgeHours: number | null,
  state: DigestState,
  dashboardUrl?: string,
  forced = false,
): Promise<DigestDecision> {
  await fs.rm(file, { force: true });   // never leave a stale digest behind

  const decide = (): DigestDecision => {
    if (!reach || reachAgeHours === null)
      return { send: false, subject: "", reason: "no agent-reach collection on disk", kind: "none" };
    if (reachAgeHours > delivery.maxReachAgeHours && !forced)
      return {
        send: false, kind: "none",
        subject: "",
        reason: `agent-reach collection is ${ago(reachAgeHours)}, older than the ${delivery.maxReachAgeHours}h gate`,
      };
    if (picked.length === 0 && !forced)
      return { send: false, subject: "", reason: "nothing new since the last run", kind: "none" };

    const perLane = lanes
      .map((l) => ({ l, n: picked.filter((i) => i.lane === l.id).length }))
      .filter((x) => x.n > 0).map((x) => `${x.n} ${x.l.label}`).join(", ");
    return {
      send: true, kind: "digest",
      subject: `News Radar — ${picked.length} new${perLane ? ` (${perLane})` : ""}`,
      reason: "fresh agent-reach collection with new items",
    };
  };

  let decision = decide();

  if (decision.send && reach && reachAgeHours !== null) {
    await fs.writeFile(file, renderDigest(picked, lanes, reach, reachAgeHours, dashboardUrl));
  } else {
    // Nothing to send — consider the heartbeat instead.
    const lastAt = state.lastDigestAt ? Date.parse(state.lastDigestAt) : NaN;
    const lastBeat = state.lastHeartbeatAt ? Date.parse(state.lastHeartbeatAt) : NaN;
    const days = (t: number) => (Date.now() - t) / 86_400_000;
    // No recorded digest means this is a fresh install, not a three-day silence.
    // Treating it as infinitely quiet made day one open with "quiet for 3 days".
    const quietFor = Number.isNaN(lastAt) ? 0 : days(lastAt);
    const beatAgo = Number.isNaN(lastBeat) ? Infinity : days(lastBeat);

    if (quietFor >= delivery.heartbeatAfterDays && beatAgo >= delivery.heartbeatAfterDays) {
      const n = Number.isFinite(quietFor) ? Math.floor(quietFor) : delivery.heartbeatAfterDays;
      await fs.writeFile(file, renderHeartbeat(reach, reachAgeHours, n));
      decision = {
        send: true, kind: "heartbeat",
        subject: `News Radar — quiet for ${n} days`,
        reason: `${decision.reason}; heartbeat due`,
      };
    }
  }

  // GitHub Actions step outputs (no-op locally).
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    await fs.appendFile(out,
      `send=${decision.send}\n` +
      `kind=${decision.kind}\n` +
      `subject=${decision.subject.replace(/\r?\n/g, " ")}\n`);
  }
  return decision;
}
