import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { materializeCollection } from "@/lib/server/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The first contribution opens the collection: fold its birth, refresh the
// game's root, then spend the recipient's stored `create` against the real
// birth proof.
//
// Everything in the body is cross-checked by the canister against the escrow
// address it derives from these very fields — a wrong `gross` or `nonce` derives
// an address with no birth, which is `BadBirthProof`, not a way in. The one
// thing worth guarding here is cost: this triggers paid calls, so it is rate
// limited harder than a read.
export async function POST(req: NextRequest) {
  if (!allow(req, "collection-materialize", 8, 4)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }

  let body: {
    collectionHex?: string;
    escrow?: string;
    donor?: string;
    gross?: string;
    deadline?: string;
    nonce?: string;
    createSignature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const collectionHex = (body.collectionHex ?? "").trim().toLowerCase();
  const { escrow, donor, gross, deadline, nonce, createSignature } = body;
  if (!/^[0-9a-f]{64}$/.test(collectionHex) || !escrow || !donor || !gross || !deadline || !nonce || !createSignature) {
    return NextResponse.json({ error: "collectionHex, escrow, donor, gross, deadline, nonce and createSignature required" }, { status: 400 });
  }

  const out = await materializeCollection({
    collectionHex,
    escrow: escrow.trim(),
    donor: donor.trim(),
    gross: String(gross),
    deadline: String(deadline),
    nonce: String(nonce),
    createSignature: createSignature.trim(),
  });

  const http = out.ok ? 200 : out.tag === "Unconfigured" ? 503 : 409;
  return NextResponse.json({ ok: out.ok, tag: out.tag, detail: out.detail }, { status: http });
}
