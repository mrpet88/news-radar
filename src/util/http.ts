// Minimal HTTP helpers — native fetch only, no deps (mirrors job-radar).

const UA = "news-radar/1.0 (personal news digest)";

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Feeds are hand-sized, but an unbounded read is still a memory hazard.
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export async function getText(
  url: string, { timeoutMs = 20000, retries = 1 }: { timeoutMs?: number; retries?: number } = {},
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status);
        if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new HttpError(res.status);
      return await readCapped(res, MAX_TEXT_BYTES);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr as Error;
}

// Count bytes off the decoded stream: content-length, when sent at all, describes
// the compressed payload and so cannot be trusted as the real size.
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`response too large: exceeded ${max} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

const decodeEntities = (s: string): string =>
  s.replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");   // last, so &amp;lt; does not decode into a tag

/**
 * Markup out, readable text in.
 *
 * Order is load-bearing. Feeds routinely deliver entity-encoded markup
 * (`&lt;p&gt;`), so decoding has to happen *before* tags are stripped — decoding
 * afterwards re-creates the tags as literal text, which is exactly how
 * "<blockquote cite=..." ended up rendered in the dashboard. The second strip
 * catches tags that only became visible once the entities were decoded.
 */
export const stripHtml = (s?: string): string => {
  if (!s) return "";
  const noScripts = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return decodeEntities(noScripts)
    .replace(/<[^>]+>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Run `fn` over `items` with at most `n` in flight. Preserves input order.
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
