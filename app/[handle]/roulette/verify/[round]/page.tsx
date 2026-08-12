"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { Logo } from "@/components/Logo";
import { usd } from "@/lib/money";
import { RPC_URL, USDC_DECIMALS } from "@/lib/chain/config";
import {
  decodeAnnouncement,
  deriveRoundId,
  rlFromHex,
  rlHex,
  shortKey,
  knockOut,
  spinWheel,
  tallyWheel,
  type RouletteVerdict,
} from "@/lib/chain/roulette";
import type { ChainRound, ChainWheelView } from "@/lib/data/useRouletteChain";
import type { Stage } from "@/lib/server/rouletteChain";
import { agoText, slotsText } from "@/lib/data/rouletteTime";

const dollars = (minor: bigint) => Number(minor) / 10 ** USDC_DECIMALS;

interface Evidence {
  signature: string;
  slot: number;
  key: string;
  moved: string;
  counted: boolean;
}

type Verdicts = "checking" | "ok" | "bad" | "n/a";

function Row({ state, children }: { state: Verdicts; children: React.ReactNode }) {
  const mark = state === "ok" ? "✓" : state === "bad" ? "✗" : state === "n/a" ? "·" : "…";
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span style={{ color: state === "bad" ? "var(--error)" : state === "ok" ? "var(--accent)" : "var(--text-3)", width: 14 }}>
        {mark}
      </span>
      <span style={{ color: state === "bad" ? "var(--error)" : undefined }}>{children}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Verify a round.
//
// This page is the difference between a game that is verifiable and a game that
// merely says so. It re-derives the round's id from its bytes, checks the
// recipient's signature over those bytes, fetches the beacon **from the RPC
// directly**, re-tallies the wheel from per-transaction evidence and recomputes
// the winner — all in the reader's browser, with `lib/chain/roulette.ts`, the
// same rule the crate pins byte-for-byte.
//
// It is also honest about its one soft spot, in the page itself rather than in a
// comment: the LIST of transactions comes from our server. Every row on it is a
// signature the reader can open in an explorer, and the address and window to
// walk are printed here — but if we omitted a row, this page alone would not
// know. Everything else it takes from the chain or computes itself.
// ──────────────────────────────────────────────────────────────────
export default function VerifyRoundPage({ params }: { params: { handle: string; round: string } }) {
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  const roundHex = params.round.toLowerCase();

  const [round, setRound] = useState<ChainRound | null>(null);
  const [wheel, setWheel] = useState<(ChainWheelView & { stakes?: Evidence[] }) | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  const [idOk, setIdOk] = useState<Verdicts>("checking");
  const [sigOk, setSigOk] = useState<Verdicts>("checking");
  const [beacon, setBeacon] = useState<{ slot: number; hash: string } | null>(null);
  const [beaconOk, setBeaconOk] = useState<Verdicts>("checking");
  const [mine, setMine] = useState<RouletteVerdict | null>(null);
  const [series, setSeries] = useState<Stage[]>([]);
  const [agree, setAgree] = useState<Verdicts>("checking");

  useEffect(() => {
    let dead = false;
    void (async () => {
      const r = await fetch(`/api/roulette/round?id=${roundHex}`).then((x) => x.json()).catch(() => null);
      if (dead) return;
      if (!r?.round) {
        setState("missing");
        return;
      }
      setRound(r.round);
      setState("ready");
      const w = await fetch(`/api/roulette/wheel?round=${roundHex}&detail=1`).then((x) => x.json()).catch(() => null);
      if (!dead && w?.wheel) setWheel(w.wheel);
    })();
    return () => {
      dead = true;
    };
  }, [roundHex]);

  // 1–2: the round is its own id, and the recipient signed it. Both are pure
  // arithmetic over bytes this page already has — no network, nothing to trust.
  useEffect(() => {
    if (!round) return;
    void (async () => {
      const bytes = rlFromHex(round.announcement);
      const ann = bytes ? decodeAnnouncement(bytes) : null;
      if (!bytes || !ann) {
        setIdOk("bad");
        setSigOk("bad");
        return;
      }
      const derived = await deriveRoundId(ann);
      setIdOk(derived && rlHex(derived) === roundHex ? "ok" : "bad");
      try {
        const ok = nacl.sign.detached.verify(
          bytes,
          Uint8Array.from(Buffer.from(round.signature, "base64")),
          new PublicKey(round.pubkey).toBytes()
        );
        setSigOk(ok ? "ok" : "bad");
      } catch {
        setSigOk("bad");
      }
    })();
  }, [round, roundHex]);

  // 3–4: the beacon (or beacons), taken from the RPC by this browser, and the
  // wheel re-tallied and re-spun here — then compared with the answer the server
  // gave. Disagreement is the interesting outcome and is shown as loudly as
  // agreement.
  //
  // An elimination round is the same proof repeated: one block per knock-out,
  // each one read from the chain, each spin recomputed over the wheel as it
  // stood at that stage. Nothing about the series is taken from us.
  useEffect(() => {
    if (!round || !wheel?.stakes) return;
    let dead = false;
    void (async () => {
      const bytes = rlFromHex(round.announcement);
      const ann = bytes ? decodeAnnouncement(bytes) : null;
      const rid = rlFromHex(roundHex);
      if (!ann || !rid) return;
      try {
        const call = async (method: string, p: unknown[]) => {
          const res = await fetch(RPC_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: p }),
          }).then((x) => x.json());
          return res?.result;
        };
        const current: number = await call("getSlot", [{ commitment: "finalized" }]);
        if (current < round.closeSlot) {
          if (!dead) setBeaconOk("n/a");
          return;
        }
        /** The first block produced at or after `slot` — the beacon rule, applied here. */
        const beaconAt = async (slot: number): Promise<{ slot: number; hash: string } | null> => {
          const produced: number[] = await call("getBlocks", [slot, Math.min(slot + 300, current)]);
          const at = produced?.[0];
          if (at === undefined) return null;
          const block = await call("getBlock", [
            at,
            { transactionDetails: "none", rewards: false, maxSupportedTransactionVersion: 0 },
          ]);
          return block?.blockhash ? { slot: at, hash: block.blockhash } : null;
        };

        const stageSlots = Number(ann.stageSlots);
        const timed = wheel
          .stakes!.filter((x) => x.slot >= round.openSlot && x.counted)
          .map((x) => ({ key: x.key, gross: BigInt(x.moved), slot: x.slot }))
          .filter((x) => x.gross >= ann.minGross);
        const at = (slot: number, exclude: Set<string>) =>
          timed
            .filter((x) => x.slot < slot && !exclude.has(x.key))
            .map((x) => ({ key: rlFromHex(x.key)!, gross: x.gross }))
            .filter((x) => x.key);

        let verdict: RouletteVerdict | null = null;
        if (stageSlots === 0) {
          const b = await beaconAt(round.closeSlot);
          if (dead) return;
          setBeacon(b);
          setBeaconOk(b ? "ok" : "bad");
          if (!b) return;
          verdict = await spinWheel(rid, bs58.decode(b.hash), tallyWheel(at(round.closeSlot, new Set()), ann.minGross));
        } else {
          // The field is whoever was on the wheel at the close; after that money
          // moves the odds but cannot add a name.
          const field = new Set(
            tallyWheel(at(round.closeSlot, new Set()), ann.minGross).slices.map((x) => rlHex(x.key))
          );
          const gone = new Set<string>();
          const walked: Stage[] = [];
          let last: { slot: number; hash: string } | null = null;
          for (let k = 0; k < field.size; k++) {
            const slot = round.closeSlot + k * stageSlots;
            if (current < slot) break;
            const alive = tallyWheel(
              at(slot, gone).filter((x) => field.has(rlHex(x.key))),
              ann.minGross
            );
            if (alive.slices.length < 2) break;
            const b = await beaconAt(slot);
            if (!b) break;
            const out = await knockOut(rid, bs58.decode(b.hash), k, alive);
            if (!out) break;
            gone.add(rlHex(out));
            walked.push({ stage: k, slot, beacon: b, out: rlHex(out) });
            last = b;
          }
          if (dead) return;
          setSeries(walked);
          setBeacon(last);
          setBeaconOk(last ? "ok" : "n/a");
          const left = tallyWheel(
            at(current + 1, gone).filter((x) => field.has(rlHex(x.key))),
            ann.minGross
          );
          if (field.size > 0 && left.slices.length === 1) {
            const survivor = left.slices[0];
            verdict = { kind: "winner", key: survivor.key, weight: survivor.weight, total: left.total };
          }
        }

        if (dead || !verdict) return;
        setMine(verdict);
        const mineKey = verdict.kind === "winner" ? rlHex(verdict.key) : null;
        // "The site has not settled it yet" is not "the site disagrees". This
        // browser can reach the beacon a few seconds before the server does, and
        // shouting `disagree` in that window would be a false alarm on the one
        // claim the page exists to make.
        if (wheel.winner == null) setAgree("n/a");
        else setAgree(mineKey === wheel.winner ? "ok" : "bad");
      } catch {
        if (!dead) setBeaconOk("bad");
      }
    })();
    return () => {
      dead = true;
    };
  }, [round, wheel, roundHex]);

  if (state === "loading") return <main className="page" />;
  if (state === "missing" || !round) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>No such round</h1>
          <p>Nothing here carries that id.</p>
          <Link className="btn" href={`/@${handle}/roulette`}>
            To the wheel
          </Link>
        </div>
      </main>
    );
  }

  const bytes = rlFromHex(round.announcement);
  const ann = bytes ? decodeAnnouncement(bytes) : null;
  const profile = round.handle ? `@${round.handle}` : null;
  const closedAgo = wheel ? agoText(wheel.currentSlot - round.closeSlot) : null;
  const titles = new Map((wheel?.slices ?? []).map((s) => [s.key, s.title]));
  const hiddenKeys = new Set((wheel?.slices ?? []).filter((s) => s.hidden).map((s) => s.key));
  // A hidden name stays hidden here too, and that costs the proof nothing: this
  // page verifies the DRAW, and the draw runs on keys. The reader who wants the
  // word can get it from whoever staked it — they hold the preimage, and the
  // hash in the memo pins it.
  const name = (key: string) =>
    titles.get(key) ?? `${shortKey(rlFromHex(key) ?? new Uint8Array(32))}${hiddenKeys.has(key) ? " (hidden)" : ""}`;
  const mineKey = mine?.kind === "winner" ? rlHex(mine.key) : null;
  const elimination = !!ann && ann.stageSlots > 0n;
  const topic = ann ? new TextDecoder().decode(ann.topic) || "game" : "game";

  return (
    <main className="page">
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18, padding: "24px 16px" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Verify this round</h1>
          <p className="footnote" style={{ margin: 0 }}>
            Everything below is recomputed in your browser from the round&apos;s own bytes and from Solana. Nothing on
            this page asks you to take our word for the result.
          </p>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <b>The checks</b>
          <Row state={idOk}>
            The round&apos;s id is the hash of its rules — so the rules cannot have been changed after it opened.
          </Row>
          <Row state={sigOk}>
            The rules were signed by <span style={{ fontFamily: "monospace" }}>{round.pubkey.slice(0, 8)}…</span>, the
            wallet this page belongs to.
          </Row>
          <Row state={beaconOk}>
            {beaconOk === "n/a"
              ? elimination
                ? "No knock-out has happened yet, so there is no deciding block to read."
                : "The round has not closed yet, so there is no deciding block to read."
              : beacon
                ? elimination
                  ? `${series.length} knock-out${series.length === 1 ? "" : "s"} so far, each decided by its own block — all read from Solana by this browser, not given to it.`
                  : `The deciding block is ${beacon.slot.toLocaleString()} — read from Solana by this browser, not given to it.`
                : "Reading the deciding block from Solana."}
          </Row>
          <Row state={agree}>
            {agree === "ok"
              ? `Recomputing ${elimination ? "every spin" : "the wheel"} here gives the same winner: ${mineKey ? name(mineKey) : "—"}.`
              : agree === "bad"
                ? "This browser and this site disagree about the winner. Trust the chain, not the site."
                : agree === "n/a"
                  ? mineKey
                    ? `This browser makes it ${name(mineKey)}. The site has not settled the round yet, so there is nothing to compare against — the chain's answer is the one above.`
                    : "Waiting for the round to close before there is a winner to recompute."
                  : "Recomputing the winner from the transactions below."}
          </Row>
        </div>

        {elimination && series.length > 0 && (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <b>The knock-outs, recomputed here</b>
            {series.map((st) => (
              <div key={st.stage} className="footnote">
                #{st.stage + 1} · block <span style={{ fontFamily: "monospace" }}>{st.beacon.slot.toLocaleString()}</span>{" "}
                (due at slot {st.slot.toLocaleString()}) knocked out <b>{name(st.out)}</b>
              </div>
            ))}
            <div className="footnote">
              Each spin runs over the wheel as it stood at that stage — stakes that landed later count in the stages
              after them, which is why money can save a {topic} and cannot bring one back.
            </div>
          </div>
        )}

        {ann && (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <b>The rules, as signed</b>
            {/* Slots are how the chain counts and how the rules are written, but
                nobody reads a round in slot numbers. The window is stated in the
                units a person has ("about 3 minutes, closed 2 hours ago") and the
                slots stay one fold away, where a verifier who wants them looks. */}
            <div className="footnote">
              Stakes toward {profile ? <b>{profile}</b> : "this page"}, over a window of about{" "}
              {slotsText(round.closeSlot - round.openSlot)}
              {closedAgo ? `, closed ${closedAgo}` : ", still open"}. Each at least{" "}
              {usd(dollars(ann.minGross))} as the splitter moves it.{" "}
              {elimination
                ? `Then one is knocked out every ${slotsText(Number(ann.stageSlots))} until one is left. `
                : "One spin decides it. "}
              Winner gets {Number(ann.playMinutes)} minutes. Topic: {new TextDecoder().decode(ann.topic) || "game"}.
            </div>
            <details>
              <summary className="footnote" style={{ cursor: "pointer" }}>The exact rules, in the chain's own units</summary>
              <div className="footnote" style={{ marginTop: 6 }}>
                Recipient <span style={{ fontFamily: "monospace" }}>{round.recipient}</span> · slots{" "}
                {round.openSlot.toLocaleString()} up to (but not including) {round.closeSlot.toLocaleString()} · floor{" "}
                {ann.minGross.toString()} minor units
                {elimination ? ` · a knock-out every ${ann.stageSlots.toString()} slots` : ""}
              </div>
              <div className="footnote" style={{ fontFamily: "monospace", wordBreak: "break-all", marginTop: 6 }}>
                {round.announcement}
              </div>
            </details>
          </div>
        )}

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b>The stakes</b>
          {wheel?.stakes?.length ? (
            wheel.stakes.map((s) => (
              <div key={s.signature} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px", gap: 8, alignItems: "baseline" }}>
                <a
                  href={`https://explorer.solana.com/tx/${s.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: "monospace", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {s.signature.slice(0, 16)}… · slot {s.slot.toLocaleString()} · {name(s.key)}
                </a>
                <span className="num">{usd(dollars(BigInt(s.moved)))}</span>
                <span className="footnote">
                  {!s.counted
                    ? "out of window"
                    : elimination && s.slot >= round.closeSlot
                      ? "counts, after close"
                      : "counts"}
                </span>
              </div>
            ))
          ) : (
            <div className="footnote">No memo-tagged donations found for this round.</div>
          )}
          <div className="footnote">
            <b>This list is the one thing here that comes from us.</b> Each row is a signature you can open above. To
            check that none is missing, walk the recipient&apos;s USDC account over the slot window printed in the rules
            — the same walk this site does.
            {elimination
              ? " On this format the walk runs past the close too: a stake that lands between knock-outs cannot join the field, but it does change who survives the ones that follow."
              : ""}
          </div>
        </div>

        {/* A titled card with nothing under it reads as something that failed to
            load. An empty round has no wheel, and the stakes card above has
            already said so. */}
        {wheel && wheel.slices.length > 0 && (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <b>The wheel</b>
            {wheel.slices.map((s) => (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ opacity: s.out || s.late ? 0.55 : 1, textDecoration: s.out ? "line-through" : undefined }}>
                  {s.title ?? name(s.key)}
                  {mineKey === s.key && <span className="pill ok" style={{ marginLeft: 8 }}><span className="dot" />winner</span>}
                  {s.late && <span className="footnote"> · joined too late</span>}
                </span>
                <span className="num">{usd(dollars(BigInt(s.weight)))}</span>
              </div>
            ))}
          </div>
        )}

        <div className="footnote">
          A stake is a donation: it stays with the content maker whether or not it wins, and nothing on chain compels
          anyone to play the winner. What this page proves is that the draw was not steered — not that the promise will
          be kept.
        </div>

        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <Logo />
        </div>
      </div>
    </main>
  );
}
