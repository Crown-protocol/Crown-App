import { NextRequest } from "next/server";
import { getProfile, listDonations } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live donations for an OBS overlay, over Server-Sent Events.
//
// The overlays used to listen on a BroadcastChannel, which only carries messages between tabs of
// ONE browser profile. OBS's Browser Source is a separate browser, so a real donation never
// reached the stream — the widgets were silent for viewers no matter what. This is the transport
// that actually crosses that boundary: the server watches the indexer's rows and pushes each new
// one to every connected overlay.
//
// SSE rather than a websocket: one-way is all an overlay needs, it survives proxies, and the
// browser reconnects on its own after a drop — which matters when the source is left running for
// a whole stream and the server restarts under it.

const POLL_MS = 2000;
// A donation older than this at connect time is history, not news: reconnecting mid-stream must not
// replay the last hour of alerts across the screen.
const MAX_AGE_MS = 60_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const handle = (searchParams.get("handle") ?? "").replace(/^@/, "").trim();
  if (!handle) return new Response("handle required", { status: 400 });

  const profile = await getProfile(handle);
  // No page, or a page with no payout address: nothing to watch. Close politely rather than
  // holding an idle connection open for the length of a stream.
  if (!profile?.address) return new Response("no such page", { status: 404 });
  const streamer = profile.address;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Rows already seen, so a poll only ever emits what's new. Keyed per event, not per
      // transaction — one transaction can pay several recipients (see the donations schema).
      const seen = new Set<string>();
      const key = (d: { signature: string; evIndex: number }) => `${d.signature}:${d.evIndex}`;
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client vanished between the check and the write
        }
      };

      // Everything already in the book is history: record it as seen without emitting, so the
      // overlay starts quiet instead of firing an alert per past donation.
      try {
        const past = await listDonations({ streamer, limit: 60 });
        const now = Date.now();
        for (const d of past) {
          seen.add(key(d));
          // …except anything that landed seconds ago: that's a donation the streamer is still
          // waiting to see, and dropping it would lose the alert on a reconnect.
          const at = d.blockTime ? d.blockTime * 1000 : 0;
          if (at && now - at < MAX_AGE_MS) {
            seen.delete(key(d));
          }
        }
      } catch {
        // The book is unreadable right now — treat everything as new on the first poll rather
        // than failing the connection.
      }

      send("ready", { handle, at: Date.now() });

      const tick = async () => {
        if (closed) return;
        try {
          const rows = await listDonations({ streamer, limit: 20 });
          // Oldest first, so a burst arrives in the order it happened.
          for (const d of rows.slice().reverse()) {
            const k = key(d);
            if (seen.has(k)) continue;
            seen.add(k);
            send("donation", {
              signature: d.signature,
              from: d.donorName || "Anonymous",
              // The book stores USDC minor units; overlays speak dollars.
              amount: d.gross / 1_000_000,
              message: d.message ?? undefined,
              ts: d.blockTime ? d.blockTime * 1000 : Date.now(),
            });
          }
          // The set would otherwise grow for the length of the stream. The feed is capped at 20 per
          // poll, so anything far behind can never come back and is safe to forget.
          if (seen.size > 500) {
            const keep = new Set(rows.map(key));
            for (const k of seen) if (!keep.has(k)) seen.delete(k);
          }
        } catch {
          // A hiccup in the DB must not kill the stream: skip this tick, try the next.
        }
        // A comment line doubles as a keep-alive so proxies don't time the connection out.
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            closed = true;
          }
        }
      };

      timer = setInterval(() => void tick(), POLL_MS);

      // The browser going away is the normal end of an overlay's life; stop polling for it.
      req.signal.addEventListener("abort", () => {
        closed = true;
        if (timer) clearInterval(timer);
        timer = null;
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer by default, which would hold every alert until the buffer fills.
      "x-accel-buffering": "no",
    },
  });
}
