import crypto from "node:crypto";

// Stable short id from normalized parts. Every channel uses the same scheme so
// the same story arriving via two channels collapses to one row.
export function hashId(parts: string[]): string {
  return crypto.createHash("sha1").update(parts.join("|").toLowerCase()).digest("hex").slice(0, 16);
}

// Canonical form of a URL for dedupe: drop tracking params, trailing slash, hash.
// Two links to the same article should produce one id even when one carries utm_*.
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$|fbclid|gclid|mc_cid|mc_eid)/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}
