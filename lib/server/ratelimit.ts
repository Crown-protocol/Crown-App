import type { NextRequest } from "next/server";

// In-memory token bucket per (client IP, bucket name). Right-sized for the
// single-process deployment this app targets — with several instances move
// the counters into the DB or a shared cache, the call sites won't change.

interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();
const MAX_ENTRIES = 10_000; // hard cap so a spray of IPs can't balloon memory

// How many proxies WE run in front of the app (a platform LB, an nginx, …). Each appends one hop to
// the right end of x-forwarded-for, so the (TRUSTED_PROXY_HOPS+1)-th entry FROM THE RIGHT is the real
// client — everything to its left is attacker-supplied text. Default 0: no self-run proxy, so XFF is
// not trusted at all and we lean on req.ip (set by the hosting platform's own proxy, unspoofable).
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? "0") || 0);

function clientIp(req: NextRequest): string {
  // req.ip is filled in by the platform's edge/proxy from the real connection — a client can't set it,
  // so it's the trustworthy source when present (Vercel, most managed hosts).
  if (req.ip) return req.ip;

  // Self-hosted fallback. x-forwarded-for AND x-real-ip are both client-writable headers: trusting
  // either as-written lets anyone send a random value per request and get a brand-new rate-limit
  // bucket every time, defeating the limiter entirely. We only trust them when we actually run a
  // proxy in front (TRUSTED_PROXY_HOPS > 0) that we know rewrites them from the real connection.
  if (TRUSTED_PROXY_HOPS > 0) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      // With N proxies of our own, each appends one hop to the right; the innermost we run is the
      // rightmost entry, so the real client is (N-1) entries left of the end. Everything further left
      // is attacker-supplied text we ignore. (One proxy → the last entry.)
      const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
      const ip = hops[hops.length - TRUSTED_PROXY_HOPS];
      if (ip) return ip;
    }
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }

  // No trustworthy client identity (no platform req.ip, and we run no proxy we trust to set the
  // headers). Do NOT read the spoofable headers here — collapsing everyone into ONE shared bucket is
  // the safe failure mode: a spoofer can no longer mint unlimited buckets, and the shared "unknown"
  // key throttles the aggregate. Configure TRUSTED_PROXY_HOPS to restore per-client limiting.
  return "unknown";
}

/**
 * true → allowed. `ratePerMin` refills continuously up to `burst`.
 * Mutating routes get tight budgets; reads get loose ones.
 */
export function allow(req: NextRequest, name: string, ratePerMin: number, burst = ratePerMin): boolean {
  if (buckets.size > MAX_ENTRIES) buckets.clear();
  const key = `${name}:${clientIp(req)}`;
  const nowMs = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, last: nowMs };
  b.tokens = Math.min(burst, b.tokens + ((nowMs - b.last) / 60_000) * ratePerMin);
  b.last = nowMs;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
