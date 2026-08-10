"use client";

import { useEffect } from "react";
import { useParams, useSearchParams, notFound } from "next/navigation";
import { AlertsOverlay, RankOverlay, GoalOverlay, TopOverlay, RouletteOverlay, TaskOverlay, FundraiserOverlay } from "@/components/overlays/Overlays";
import { TickerOverlay, QrOverlay, SessionOverlay, RecordOverlay, TrainOverlay } from "@/components/overlays/Extras";
import { isOverlayKind } from "@/lib/data/overlays";
import { firstActiveScope, pullSessions } from "@/lib/data/gameSessions";
import { pullScope } from "@/lib/data/gameSync";
import type { GameId } from "@/lib/data/games";

// The game widgets read the game stores — OBS's Browser Source is its OWN browser with an
// empty localStorage, so without pulling the shared game state (/api/gamestate) they'd show the
// demo seeds instead of the real queue/round/book the viewers are filling.
const GAME_WIDGETS: Record<string, GameId> = { roulette: "roulette", task: "task", fundraiser: "fundraiser" };

// /overlay/<handle>/<widget> — a bare page for OBS Browser Source. Transparent background (see
// app/overlay/layout.tsx). ?demo=1 fabricates donations so it's lively without a real donor.
export default function OverlayPage() {
  const params = useParams<{ handle: string; widget: string }>();
  const search = useSearchParams();

  const handle = decodeURIComponent(params.handle || "").replace(/^@/, "");
  const widget = decodeURIComponent(params.widget || "");
  const demo = search.get("demo") === "1";

  // Keep this OBS context's localStorage in step with the server copy; the widgets' own 1.5s
  // localStorage polls pick the fresh data up. The session REGISTRY pulls first, so the scope is
  // re-derived each tick — a session-based stream reads its session, not the legacy bare handle.
  // Demo overlays fabricate their data — no pull.
  const gameId = GAME_WIDGETS[widget];
  useEffect(() => {
    if (!handle || !gameId || demo) return;
    let dead = false;
    const tick = async () => {
      if (dead) return;
      await pullSessions(handle, gameId);
      if (!dead) await pullScope(firstActiveScope(handle, gameId));
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [handle, gameId, demo]);

  // An unknown widget name is a genuine 404 (real status) — isOverlayKind is pure, so it resolves
  // during the server render and the response is a proper 404, not a 200 stand-in.
  if (!isOverlayKind(widget)) notFound();

  // Parse numeric params by presence + finiteness, not truthiness — so a legitimate 0 isn't dropped
  // to the demo default.
  const num = (key: string): number | undefined => {
    const raw = search.get(key);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  if (widget === "alerts") return <AlertsOverlay handle={handle} demo={demo} min={num("min")} />;
  if (widget === "rank") return <RankOverlay handle={handle} demo={demo} />;
  if (widget === "top") return <TopOverlay handle={handle} demo={demo} n={num("n")} />;
  if (widget === "roulette") return <RouletteOverlay handle={handle} demo={demo} />;
  if (widget === "task") return <TaskOverlay handle={handle} demo={demo} />;
  if (widget === "fundraiser") return <FundraiserOverlay handle={handle} demo={demo} goal={num("goal")} img={search.get("img") || undefined} />;
  if (widget === "ticker") return <TickerOverlay handle={handle} demo={demo} />;
  if (widget === "qr") return <QrOverlay handle={handle} demo={demo} />;
  if (widget === "session") return <SessionOverlay handle={handle} demo={demo} start={num("start")} />;
  if (widget === "record") return <RecordOverlay handle={handle} demo={demo} />;
  if (widget === "train") return <TrainOverlay handle={handle} demo={demo} />;

  const title = search.get("title") || undefined;
  return <GoalOverlay handle={handle} demo={demo} title={title} goal={num("goal")} raised={num("raised")} />;
}
