// Game sessions — the layer that lets one streamer run several instances of the same mini-game
// at once (two auctions in parallel, a fresh roulette round while yesterday's is settling, …).
// Data + store, no React, localStorage like the rest of the mock backend.
//
// The trick: every per-game store already keys its localStorage by an opaque string ("handle").
// A session simply owns a SCOPE — the string the stores are keyed by. The first session ever
// adopts the legacy scope (the bare handle), so data from before sessions existed stays visible;
// every later session gets a namespaced scope and starts EMPTY (see the fresh markers below).
//
// A session's live/finished state is COMPUTED from the game's own state, not stored — so it can
// never drift: an auction that reached its verdict IS a finished session, no syncing required.

import type { GameId } from "./games";
import { markFresh } from "./freshScope";
import { readAuctionMeta } from "./auction";
import { readRoundMeta } from "./roulette";
import { readStatus } from "./fundraiser";
import { sendOp, pullScope } from "./gameSync";

export interface GameSession {
  id: string;
  gameId: GameId;
  name: string; // the streamer's label — "Friday auction", defaults to "Auction #2"
  scope: string; // the storage key the game's stores are keyed by
  createdAt: number;
  endedAt?: number; // manual "End session" — terminal game states finish a session on their own
}

export type SessionState = "live" | "finished";

const KEY = "cheer-game-sessions";
const CURRENT_KEY = "cheer-current-session";

// ---- the registry ----

function key(handle: string, gameId: GameId) {
  return `${KEY}:${handle}:${gameId}`;
}

export function readSessions(handle: string, gameId: GameId): GameSession[] {
  try {
    const raw = localStorage.getItem(key(handle, gameId));
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) return list;
  } catch {}
  return [];
}

function writeSessions(handle: string, gameId: GameId, list: GameSession[]) {
  try {
    localStorage.setItem(key(handle, gameId), JSON.stringify(list));
  } catch {}
  // Share the registry so a viewer's browser can resolve ?s=<id> to the right scope — see
  // sessionsScope/pullSessions.
  //
  // MERGE, never replace. This list comes from localStorage, and Log out wipes that store: a
  // cabinet that hadn't pulled the registry back yet would send a list of one and delete every
  // other session from the server — for the streamer and every viewer at once. Merging by id keeps
  // whatever the server already knows and still records this session's own changes.
  sendOp(sessionsScope(handle, gameId), "cheer-game-sessions", { type: "mergeById", list });
}

// The registry's gamestate scope. The localStorage key is `cheer-game-sessions:<handle>:<gameId>`
// and the sync layer stores every key as `<k>:<scope>` — so scope is exactly "<handle>:<gameId>".
function sessionsScope(handle: string, gameId: GameId): string {
  return `${handle}:${gameId}`;
}

// Pull the shared registry into this browser before resolving a public link — a viewer opening
// ?s=<id> has never seen the streamer's sessions, and without this the id resolves to nothing.
export async function pullSessions(handle: string, gameId: GameId): Promise<void> {
  await pullScope(sessionsScope(handle, gameId));
}

const GAME_NOUN: Record<GameId, string> = { task: "Tasks", roulette: "Round", fundraiser: "Fundraiser", auction: "Auction" };

// Create a session. The first one ever adopts the legacy scope (bare handle) so pre-session data
// and the demo seeds keep showing; every later one is namespaced and starts empty.
export function createSession(handle: string, gameId: GameId, name?: string): GameSession {
  const list = readSessions(handle, gameId);
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const legacyTaken = list.some((s) => s.scope === handle);
  const scope = legacyTaken ? `${handle}::${id}` : handle;
  const session: GameSession = {
    id,
    gameId,
    name: name?.trim() || `${GAME_NOUN[gameId]} #${list.length + 1}`,
    scope,
    createdAt: Date.now(),
  };
  if (legacyTaken) {
    markFresh(scope);
    // The fresh marker is per-browser — publish the empty starting state too, so a VIEWER's
    // browser (which has no marker) also sees a session that starts empty, not the demo seeds.
    if (gameId === "task") sendOp(scope, "cheer-tasks", { type: "replace", value: [] });
    if (gameId === "roulette") sendOp(scope, "cheer-roulette-round", { type: "replace", value: [] });
    if (gameId === "auction") sendOp(scope, "cheer-auction-lots", { type: "replace", value: [] });
    if (gameId === "fundraiser") sendOp(scope, "cheer-fundraiser-collected", { type: "replace", value: 0 });
  }
  writeSessions(handle, gameId, [session, ...list]);
  setCurrentSession(handle, gameId, id);
  return session;
}

// Manual end — for games with no natural finale (tasks) and for killing a stuck one.
// The game state itself is left untouched: a finished session is an archive, not a deletion.
export function endSession(handle: string, gameId: GameId, id: string): GameSession[] {
  const next = readSessions(handle, gameId).map((s) => (s.id === id ? { ...s, endedAt: Date.now() } : s));
  writeSessions(handle, gameId, next);
  return next;
}

// ---- computed state ----

// A session is finished when the streamer ended it, or the game under it reached a terminal
// state on its own — the "auction over → session off" rule, for free, with no sync to forget.
export function sessionState(s: GameSession): SessionState {
  if (s.endedAt) return "finished";
  switch (s.gameId) {
    case "auction": {
      const m = readAuctionMeta(s.scope);
      return m && (m.state === "settled" || m.state === "refunded" || m.state === "cancelled") ? "finished" : "live";
    }
    case "roulette": {
      // a spun wheel ends the session; "New round" inside the same session clears the winner
      // and brings it back live — the state is derived, so it just follows
      return readRoundMeta(s.scope)?.winner ? "finished" : "live";
    }
    case "fundraiser": {
      const st = readStatus(s.scope).state;
      return st === "delivered" || st === "refunded" ? "finished" : "live";
    }
    case "task":
      return "live"; // a task queue has no finale — ended by hand
  }
}

export function activeSessions(handle: string, gameId: GameId): GameSession[] {
  return readSessions(handle, gameId).filter((s) => sessionState(s) === "live");
}

// ---- the current selection (which session the cabinet tabs are looking at) ----

export function getCurrentSession(handle: string, gameId: GameId): GameSession | null {
  let id: string | null = null;
  try {
    id = localStorage.getItem(`${CURRENT_KEY}:${handle}:${gameId}`);
  } catch {}
  const list = readSessions(handle, gameId);
  const current = id ? list.find((s) => s.id === id) : undefined;
  // fall back to the first live session, then to nothing
  return current ?? activeSessions(handle, gameId)[0] ?? null;
}

export function setCurrentSession(handle: string, gameId: GameId, id: string) {
  try {
    localStorage.setItem(`${CURRENT_KEY}:${handle}:${gameId}`, id);
  } catch {}
}

// ---- resolution for the public pages ----

// Which session should a viewer see? ?s=<id> wins; otherwise the only live one; otherwise the
// caller gets the list and shows a picker (several live) or a "nothing running" note (none).
// A streamer who never touched sessions gets a legacy passthrough on the bare handle, so every
// pre-session page keeps working exactly as before.
export function resolvePublicSession(
  handle: string,
  gameId: GameId,
  sParam: string | null
): { scope: string | null; sessionId: string | null; choices: GameSession[] } {
  const all = readSessions(handle, gameId);
  if (all.length === 0) return { scope: handle, sessionId: null, choices: [] };
  const live = activeSessions(handle, gameId);
  if (sParam) {
    const hit = all.find((s) => s.id === sParam);
    if (hit) return { scope: hit.scope, sessionId: hit.id, choices: live };
  }
  if (live.length === 1) return { scope: live[0].scope, sessionId: live[0].id, choices: live };
  return { scope: null, sessionId: null, choices: live };
}

// The scope surfaces like HomeLive/ViewerLive/overlays should read from: the first live session,
// or the legacy bare handle when sessions were never used (keeps every old surface working).
export function firstActiveScope(handle: string, gameId: GameId): string {
  const sessions = readSessions(handle, gameId);
  if (sessions.length === 0) return handle;
  return activeSessions(handle, gameId)[0]?.scope ?? handle;
}

// The first live session itself (for surfaces that want to SHOW its name, e.g. Home's "Live now").
// null when sessions were never used (the legacy bare-handle path has no session to name).
export function firstActiveSession(handle: string, gameId: GameId): GameSession | null {
  if (readSessions(handle, gameId).length === 0) return null;
  return activeSessions(handle, gameId)[0] ?? null;
}
