import { db, now } from "./db";

// ──────────────────────────────────────────────────────────────────
// Shared game state — the server copy of the per-scope localStorage keys the
// mini-games run on, so what one viewer does shows up for everyone else.
//
// The client stays the same synchronous localStorage reader it always was; this
// module owns the CONFLICT rules. Writes arrive as small OPS, not blind blobs:
//   append  — add a list item if its id isn't there yet (viewer adds a task/lot)
//   suggest — roulette accumulator: bump a title's pool/backers, or add the title
//   add     — numeric accumulator (fundraiser collected)
//   mergeById — union a list by item id, caller's version winning (session registry)
//   replace — authoritative overwrite (metas, the streamer's own state changes)
// Concurrent viewers therefore can't stomp each other: appends and deltas
// commute; only the single-writer keys (streamer metas) use replace.
//
// `replace` is the sharp one: it believes the caller's whole list. Use it only where the caller
// provably holds the full state (a meta it just computed, a brand-new scope's empty seed). For
// anything a client rebuilds from localStorage — which Log out wipes — reach for mergeById.
// ──────────────────────────────────────────────────────────────────

// Only these key families sync — anything else in a POST is rejected.
export const SYNCED_KEYS = [
  "cheer-tasks",
  "cheer-roulette-round",
  "cheer-roulette-meta",
  "cheer-fundraiser-collected",
  "cheer-fundraiser-contributions",
  "cheer-fundraiser-status",
  // The session REGISTRY (scope = "<handle>:<gameId>", value = GameSession[]). Without it a
  // second+ session only exists in the streamer's browser: a viewer's ?s=<id> link can't name
  // a scope the viewer has never heard of, and falls back to the legacy bare-handle state.
  "cheer-game-sessions",
  // The rules a session was opened with (lib/data/gameConfig.ts), keyed by game inside one blob
  // per scope. Shared for the same reason the registry is: a viewer's browser has no copy of the
  // maker's profile, so without it the public page falls back to platform defaults and could
  // show a $5 minimum where this session set $50.
  "cheer-game-config",
] as const;

const MAX_LIST = 500; // abuse cap: a scope's list never grows past this
const MAX_VALUE_BYTES = 64 * 1024; // one key's JSON — far above any honest payload

export type GameOp =
  | { type: "append"; item: { id: string } & Record<string, unknown>; seed?: unknown[] }
  | { type: "suggest"; title: string; genre: string; dPool: number; dBackers: number }
  | { type: "entry"; id: string; entry: Record<string, unknown>; seed?: unknown[] }
  | { type: "add"; delta: number }
  // Just `{ id }` — the merge only ever reads the id, and demanding an index signature here would
  // reject every caller that passes a plain interface (GameSession) rather than a literal.
  | { type: "mergeById"; list: { id: string }[] }
  | { type: "replace"; value: unknown };

// The libsql client has no row locks and route handlers interleave at every
// await — serialize read-modify-write per scope in-process (single-instance
// deploy; a multi-node future moves this into SQL).
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(scope) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(scope, next.catch(() => {}) as Promise<unknown>);
  return next;
}

async function readKey(scope: string, k: string): Promise<unknown | undefined> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT v FROM game_state WHERE scope = ? AND k = ?`, args: [scope, k] });
  if (!r.rows.length) return undefined;
  try {
    return JSON.parse(String(r.rows[0].v));
  } catch {
    return undefined;
  }
}

async function writeKey(scope: string, k: string, v: unknown): Promise<void> {
  const json = JSON.stringify(v);
  if (json.length > MAX_VALUE_BYTES) throw new Error("value too large");
  const c = await db();
  await c.execute({
    sql: `INSERT INTO game_state (scope, k, v, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(scope, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    args: [scope, k, json, now()],
  });
}

export async function listScopeState(scope: string): Promise<Record<string, unknown>> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT k, v FROM game_state WHERE scope = ?`, args: [scope] });
  const out: Record<string, unknown> = {};
  for (const row of r.rows) {
    try {
      out[String(row.k)] = JSON.parse(String(row.v));
    } catch {}
  }
  return out;
}

// Apply one op and return the key's full new value (the client adopts it verbatim).
export function applyGameOp(scope: string, k: string, op: GameOp): Promise<unknown> {
  return serialize(scope, async () => {
    const current = await readKey(scope, k);

    switch (op.type) {
      case "replace": {
        await writeKey(scope, k, op.value);
        return op.value;
      }
      case "mergeById": {
        // The session registry, and the reason it is NOT a `replace`. The cabinet writes the list it
        // holds in localStorage — and Log out wipes that store, so a browser that hadn't pulled the
        // registry back yet would hand the server a list missing every existing session. `replace`
        // took it at its word: the streamer's other games were deleted for everyone, on the server,
        // the moment they started one new game in a freshly signed-in cabinet. That is unrecoverable
        // and it is silent.
        //
        // Merging makes the write safe from any client, pulled or not: an entry the caller sends
        // wins for its own id (that is how "End session" records endedAt), and an entry only the
        // server knows about is kept. Sessions are therefore append-and-amend only — nothing here
        // can remove one, which is exactly right while the product has no "delete session".
        const incoming = Array.isArray(op.list) ? op.list : [];
        if (incoming.length > MAX_LIST) throw new Error("list full");
        const byId = new Map<string, Record<string, unknown>>();
        const take = (arr: unknown[]) => {
          for (const s of arr) {
            if (!s || typeof s !== "object") continue;
            const id = (s as { id?: unknown }).id;
            if (typeof id !== "string" || !id) continue;
            byId.set(id, s as Record<string, unknown>);
          }
        };
        take(Array.isArray(current) ? current : []);
        take(incoming); // caller's version of a session it names wins
        const next = [...byId.values()].sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
        if (next.length > MAX_LIST) throw new Error("list full");
        await writeKey(scope, k, next);
        return next;
      }
      case "add": {
        const base = typeof current === "number" ? current : 0;
        const delta = Number(op.delta);
        if (!Number.isFinite(delta) || delta < 0 || delta > 1_000_000) throw new Error("bad delta");
        const next = base + delta;
        await writeKey(scope, k, next);
        return next;
      }
      case "append": {
        // First write seeds the server copy with the client's full list (the demo
        // seed rows ride along), so adopting the server value never eats them.
        const list: { id?: unknown }[] = Array.isArray(current) ? current : Array.isArray(op.seed) ? (op.seed as { id?: unknown }[]) : [];
        if (!op.item || typeof op.item.id !== "string") throw new Error("append needs item.id");
        const next = list.some((x) => x && x.id === op.item.id) ? list : [op.item, ...list];
        if (next.length > MAX_LIST) throw new Error("list full");
        await writeKey(scope, k, next);
        return next;
      }
      case "suggest": {
        // Roulette's local list is keyed by title; two viewers backing the same
        // game must SUM, not overwrite — hence a delta op instead of a list write.
        const list: { title?: unknown; genre?: unknown; pool?: unknown; backers?: unknown }[] = Array.isArray(current) ? current : [];
        const title = String(op.title ?? "").slice(0, 120);
        const dPool = Number(op.dPool);
        const dBackers = Number(op.dBackers);
        if (!title || !Number.isFinite(dPool) || dPool < 0 || dPool > 1_000_000) throw new Error("bad suggest");
        const hit = list.find((s) => typeof s?.title === "string" && s.title.toLowerCase() === title.toLowerCase());
        let next;
        if (hit) {
          next = list.map((s) =>
            s === hit ? { ...s, pool: Number(s.pool ?? 0) + dPool, backers: Number(s.backers ?? 0) + (Number.isFinite(dBackers) ? dBackers : 1) } : s
          );
        } else {
          if (list.length >= MAX_LIST) throw new Error("list full");
          next = [...list, { title, genre: String(op.genre ?? "Other").slice(0, 40), pool: dPool, backers: Number.isFinite(dBackers) ? dBackers : 1 }];
        }
        await writeKey(scope, k, next);
        return next;
      }
      case "entry": {
        // Auction top-up: append one LotEntry to one lot. Commutes with other
        // viewers' top-ups on the same lot — nobody's escrow gets lost.
        // Same seeding rule as `append`: on the first write the server copy may be empty (or absent)
        // while the viewer's board is the in-memory demo seed. Adopting an empty list here would drop
        // the entry on the floor — the lot it belongs to wouldn't exist server-side.
        const list: { id?: unknown; entries?: unknown[] }[] = Array.isArray(current) && current.length
          ? current
          : Array.isArray(op.seed)
            ? (op.seed as { id?: unknown; entries?: unknown[] }[])
            : Array.isArray(current)
              ? current
              : [];
        if (typeof op.id !== "string" || !op.entry) throw new Error("bad entry");
        const next = list.map((l) =>
          l && l.id === op.id ? { ...l, entries: [...(Array.isArray(l.entries) ? l.entries : []), op.entry] } : l
        );
        await writeKey(scope, k, next);
        return next;
      }
      default:
        throw new Error("unknown op");
    }
  });
}
