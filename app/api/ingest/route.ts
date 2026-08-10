import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { ingestSignature } from "@/lib/server/submitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ask the platform to buy one fold of a Solana signature into the book:
//   { signature, escrow? }
//
// Only game money passes: an escrow's birth (`create_escrow`) and the
// settlement a verdict produced (`claim`, which pays through the splitter). A
// plain donation is refused on purpose — the donor folds their own, from their
// own budget (`00 §9`), and the platform paying for it would make reputation
// something we buy for people rather than something they earn.
//
// The caller's `escrow` is a hint that makes one case automatic: a settlement
// the index answers `UnknownBirth` needs that escrow's birth folded first, and
// with the address we can do it without a human. It is never trusted for
// anything else — what we will pay for is read from the transaction itself.
//
// Idempotent: an already-folded signature comes back `Duplicate`, free.
export async function POST(req: NextRequest) {
  // Well below the submitter's own per-minute ceiling: this bucket stops one
  // caller from spending the whole allowance, the submitter's stops all of them
  // together from reaching the relay's per-key budget.
  if (!allow(req, "ingest", 10, 6)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { signature?: string; escrow?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const signature = (body.signature ?? "").trim();
  if (!signature || signature.length > 120) {
    return NextResponse.json({ error: "signature required" }, { status: 400 });
  }
  const escrow = (body.escrow ?? "").trim() || undefined;

  const out = await ingestSignature(signature, escrow);
  // `pending` and `needs_birth` are working states, not failures: the caller
  // polls, and nothing about them says the money is at risk. Everything else is
  // terminal in one direction or the other.
  const http = out.status === "unconfigured" ? 503 : out.status === "refused" ? 400 : 200;
  return NextResponse.json({ status: out.status, detail: out.detail, attempts: out.attempts }, { status: http });
}
