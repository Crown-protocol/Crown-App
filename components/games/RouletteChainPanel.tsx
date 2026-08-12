"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCheer } from "@/lib/data/DataProvider";
import { useWallet } from "@/lib/chain/useWallet";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import { usd, usdPrecise } from "@/lib/money";
import { DS_FEE_BPS, USDC_DECIMALS } from "@/lib/chain/config";
import { RouletteWheel } from "@/components/RouletteWheel";
import { GameTabs } from "@/components/games/GameTabs";
import { GameRules } from "@/components/games/GameRules";
import { MinNote } from "@/components/games/MinNote";
import { ReputationDelta } from "@/components/ReputationDelta";
import type { WheelSlice } from "@/components/RouletteWheel";
import type { Profile } from "@/lib/data/types";
import {
  buildMemo,
  decodeAnnouncement,
  deriveEntryKey,
  eliminationWeights,
  rlFromHex,
  rlHex,
  shortKey,
} from "@/lib/chain/roulette";
import {
  aliveSlices,
  nextStageSlot,
  phaseOf,
  FINALIZED_LAG_SLOTS,
  type ChainRound,
  type ChainWheelView,
} from "@/lib/data/useRouletteChain";
import { STAKE_CUTOFF_SLOTS } from "@/lib/chain/rouletteTx";
import { slotsText } from "@/lib/data/rouletteTime";
import styles from "@/app/[handle]/roulette/page.module.css";

const dollars = (minor: bigint) => Number(minor) / 10 ** USDC_DECIMALS;

// ──────────────────────────────────────────────────────────────────
// The wheel, chain-mode.
//
// Same shape as the off-chain page it stands beside — the same tabs, the same
// round card, the same slice rows, the same wheel — because a viewer should not
// have to learn two roulettes. What differs is only what is genuinely different:
//
//   · no category select. The entry key commits the title and nothing else, so a
//     dropdown here would change nothing at all — and a control that changes
//     nothing is worse than no control.
//   · no "suggested by" or backer count. Neither is on chain, and inventing them
//     from our own database would be the one thing this game refuses.
//   · the spin fires when the beacon lands, not on a timer we own.
//
// The honesty — a stake is a donation, nothing is returned, nobody chooses the
// block — lives in the Rules tab with the rest of the rules, not as three cards
// stacked over the game.
// ──────────────────────────────────────────────────────────────────
export function RouletteChainPanel({
  handle,
  profile,
  presets,
  rep,
  round,
  wheel,
  onStaked,
}: {
  handle: string;
  profile: Profile;
  presets: number[];
  rep: number;
  round: ChainRound;
  wheel: ChainWheelView | null;
  onStaked: () => void;
}) {
  const { donate } = useCheer();
  const wallet = useWallet();
  const confirm = useConfirm();

  const [view, setView] = useState<"stake" | "wheel" | "rules">("stake");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const rules = useMemo(() => {
    const bytes = rlFromHex(round.announcement);
    return bytes ? decodeAnnouncement(bytes) : null;
  }, [round.announcement]);

  const phase = phaseOf(round, wheel);
  const open = phase === "open";
  const elimination = (wheel?.stageSlots ?? 0) > 0;
  const alive = aliveSlices(wheel);
  // Past the close, an elimination round still takes money but no longer takes
  // names: the field was fixed at the close, so a fresh title would pay the
  // recipient and never compete. The form stops offering it a little early, for
  // the same reason stakes close early — a title has to reach a block, not just
  // a wallet.
  const fieldFixed =
    elimination &&
    !!wheel &&
    wheel.currentSlot + FINALIZED_LAG_SLOTS >= round.closeSlot - STAKE_CUTOFF_SLOTS;

  // The chance of being knocked out at the next spin, per surviving slice.
  //
  // Computed here from the published weights with the same function the crate
  // and the server use — not reported by us. A viewer who does not believe the
  // number can recompute it from the wheel, which is the only kind of number
  // this game shows.
  const elimOdds = useMemo(() => {
    const odds = new Map<string, number>();
    if (!elimination || alive.length === 0) return odds;
    const w = eliminationWeights(alive.map((s) => ({ key: new Uint8Array(32), weight: BigInt(s.weight) })));
    const sum = w.reduce((a, b) => a + b, 0n);
    if (sum === 0n) return odds;
    alive.forEach((s, i) => odds.set(s.key, Number((w[i] * 1000n) / sum) / 10));
    return odds;
    // `alive` is derived from the wheel on every render; the wheel is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheel, elimination]);
  const total = BigInt(wheel?.total ?? "0");
  const topic = rules ? new TextDecoder().decode(rules.topic) || "game" : "game";
  const floorNet = rules?.minGross ?? 0n;
  // The floor is on what the splitter moves; a donor pays the fee on top, so the
  // number they must type is the floor plus the fee — derived, never a literal.
  const minDonation = Math.ceil((dollars(floorNet) * 10_000) / (10_000 - DS_FEE_BPS) / 0.01) * 0.01;

  // The countdown ticks locally between reads and re-anchors on every one.
  //
  // The chain's clock arrives every six seconds, so rendering it raw made the
  // number sit still and then jump — which reads as a page that has frozen, on
  // the one element a viewer is watching to decide whether they still have time.
  // The anchor is still the chain's: local time only fills the gaps, and each
  // read snaps back to what the chain says.
  const [drift, setDrift] = useState(0);
  const anchoredAt = useRef(0);
  useEffect(() => {
    if (!wheel) return;
    anchoredAt.current = Date.now();
    setDrift(0);
    const t = setInterval(() => setDrift(Date.now() - anchoredAt.current), 1000);
    return () => clearInterval(t);
  }, [wheel]);

  const slotsLeft = wheel ? nextStageSlot(round, wheel) - wheel.currentSlot : 0;
  const secondsLeft = wheel ? Math.max(0, Math.round(slotsLeft * 0.4 - drift / 1000)) : 0;
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const name = (s: { key: string; title: string | null; hidden: boolean }) =>
    s.title ?? `${shortKey(rlFromHex(s.key) ?? new Uint8Array(32))}${s.hidden ? " · hidden" : ""}`;

  // The slice a knock-out just removed, held on the wheel until its spin lands.
  //
  // Without this the wheel would redraw to the survivors the instant the chain
  // reported the stage, and the spin would have nothing to land on — the one
  // moment the format exists for would play out on a wheel that no longer had
  // the loser in it.
  const [pending, setPending] = useState<string | null>(null);

  // The wheel component speaks the mock's shape. Only the fields it draws are
  // filled: what is not on chain is not invented here.
  const drawn = elimination
    ? [...alive, ...(wheel?.slices.filter((s) => s.key === pending) ?? [])]
    : (wheel?.slices ?? []);
  // On elimination a slice's size is its chance of being knocked out, not its
  // share of the pot — and with `pending` still in, that is exactly the wheel
  // the stage spun on. On a single spin the two are the same number.
  const shares = elimination
    ? eliminationWeights(drawn.map((s) => ({ key: new Uint8Array(32), weight: BigInt(s.weight) })))
    : null;
  const slices: WheelSlice[] = drawn.map((s, i) => ({
    id: s.key,
    title: name(s),
    genre: "Other",
    pool: dollars(BigInt(s.weight)),
    ...(shares ? { share: Number(shares[i] / 1_000_000_000n) } : {}),
    backers: 0,
    suggestedBy: "",
  }));

  // The spin belongs to the beacon: it fires once, when the verdict first
  // appears to someone who was watching. Opening an already-decided round parks
  // the winner under the pointer instead — replaying a spin on every reload
  // would be theatre.
  const [spin, setSpin] = useState<{ id: string; nonce: number }>({ id: "", nonce: 0 });
  const sawOpen = useRef(false);
  useEffect(() => {
    if (!wheel) return;
    if (!wheel.winner) {
      sawOpen.current = true;
      return;
    }
    if (sawOpen.current && spin.nonce === 0) {
      setSpin({ id: wheel.winner, nonce: 1 });
      setView("wheel"); // the moment the game exists for
    }
  }, [wheel, spin.nonce]);

  // Every knock-out gets its own spin, for the same reason the verdict does: it
  // is a thing that happened to the wheel, and the wheel should show it. A round
  // opened after the fact does not replay them — the count is adopted, not spun.
  const seenStages = useRef<number | null>(null);
  useEffect(() => {
    if (!wheel || !elimination) return;
    const n = wheel.stages.length;
    if (seenStages.current === null) {
      seenStages.current = n;
      return;
    }
    if (n <= seenStages.current) return;
    seenStages.current = n;
    const justOut = wheel.stages[n - 1].out;
    setPending(justOut);
    setSpin((prev) => ({ id: justOut, nonce: prev.nonce + 1 }));
    setView("wheel");
  }, [wheel, elimination]);

  const chosen = amount ?? presets[0] ?? minDonation;
  const customN = Number(custom) || 0;
  const finalAmount = custom ? customN : chosen;
  const winner = wheel?.slices.find((s) => s.key === wheel.winner) ?? null;
  const lastOutKey = wheel?.stages[wheel.stages.length - 1]?.out ?? null;
  const lastOut = wheel?.slices.find((s) => s.key === lastOutKey) ?? null;
  const canStake = open && !busy && title.trim().length > 0 && finalAmount >= minDonation;

  async function stake() {
    if (!canStake) return;
    setErr("");
    if (!wallet.connected) {
      if (!wallet.hasWallet) {
        setErr("No Solana wallet found in the browser. Install Phantom or Solflare.");
        return;
      }
      wallet.connect();
      return;
    }
    setBusy(true);
    try {
      const roundId = rlFromHex(round.roundHex);
      if (!roundId) throw new Error("That round is unreadable.");
      // The exact bytes the donor typed are what the key commits to — this game
      // normalizes nothing, so what is hashed must be what is sent and what is
      // published as the title.
      const chosenTitle = title.trim();
      const key = await deriveEntryKey(roundId, new TextEncoder().encode(chosenTitle));
      if (!key) throw new Error("That title is empty or too long.");
      // Checked here rather than only in the input: the guard that matters is
      // the one standing between a donor and a payment that cannot win.
      if (fieldFixed && !alive.some((s) => s.key === rlHex(key))) {
        throw new Error("New titles are closed for this round — back one that is still in.");
      }

      await donate(
        { handle, amount: finalAmount, message: chosenTitle, source: "roulette", memo: buildMemo(roundId, key) },
        wallet.address
      );
      // The title is published only after the money moved: a name on a slice
      // nobody paid for would be a slice that does not exist.
      void fetch("/api/roulette/entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundHex: round.roundHex, entryHex: rlHex(key), title: chosenTitle }),
      }).catch(() => {});

      setTitle("");
      setCustom("");
      setDone(true);
      setTimeout(() => setDone(false), 2500);
      onStaked();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  const stagesDone = wheel?.stages.length ?? 0;
  const stageMinutes = slotsText(wheel?.stageSlots ?? 0);
  const head =
    elimination && phase !== "decided" && wheel
      ? `This round · ${alive.length} left · next out in ${clock}`
      : phase === "open"
        ? `This round · ${clock} left`
        : phase === "closing"
          ? "This round · closing"
          : phase === "settling"
            ? "This round · closed"
            : phase === "decided"
              ? "This round · decided"
              : "This round · reading the chain…";

  return (
    <>
      <GameTabs
        value={view}
        onChange={(v) => setView(v as "stake" | "wheel" | "rules")}
        tabs={[
          { key: "stake", label: `Back a ${topic}`, count: wheel?.slices.length ?? 0 },
          { key: "wheel", label: "The wheel" },
          { key: "rules", label: "Rules" },
        ]}
      />

      <div className={styles.panel}>
        {view === "rules" && (
          <GameRules
            lines={[
              { term: "How to enter", desc: `Back a ${topic} with a donation. What you give becomes that ${topic}'s share of the wheel.` },
              { term: "Minimum", desc: `${usdPrecise(minDonation)} per stake — backing something already on the wheel is a stake of its own and has to clear it too.` },
              elimination
                ? {
                    term: "The odds",
                    desc: `Every ${stageMinutes} the wheel knocks one ${topic} out, until one is left. Backing protects: the chance of going out falls as the square root of what is behind it, so four times the money is half the risk — and it never reaches zero.`,
                  }
                : {
                    term: "The odds",
                    desc: `One spin decides it. A ${topic} with a bigger share of the pot has a proportionally bigger slice.`,
                  },
              ...(elimination
                ? [
                    {
                      term: "The field",
                      desc: `Whoever is on the wheel at slot ${round.closeSlot.toLocaleString()} plays. After that money still counts — it changes who survives — but a new title cannot join.`,
                    },
                  ]
                : []),
              {
                term: "Who decides",
                desc: elimination
                  ? `A Solana block for each knock-out — the first one produced at the slot that stage falls on. Not the viewers, not ${profile.name}, not Cheer. Anyone can recompute every one of them.`
                  : `A Solana block — the first one produced at slot ${round.closeSlot.toLocaleString()}. Not the viewers, not ${profile.name}, not Cheer. Anyone can recompute it.`,
              },
              { term: "Your money isn't returned", desc: `A stake is a donation: it pays ${profile.name} whether or not it wins.` },
              {
                term: "What isn't guaranteed",
                desc: `Nothing on chain makes anyone play the winner. That promise rests on the public record and nothing else — there is no escrow here.`,
              },
              ...(rules ? [{ term: "If it wins", desc: `${Number(rules.playMinutes)} minutes on stream.` }] : []),
              // Only when it applies. A rule about hidden names on a wheel with
              // none is noise, and noise is what people learn to skip.
              ...(wheel?.slices.some((s) => s.hidden)
                ? [
                    {
                      term: "A hidden name",
                      desc: `${profile.name} took a name off this page. The slice keeps its pool and its odds and can still win — the winner is drawn from keys, not words.`,
                    },
                  ]
                : []),
            ]}
            mine={profile}
            note={
              <>
                The money moves the moment you sign, straight to {profile.name} — there is no escrow on this wheel and
                nothing to refund, win or lose. What the chain guarantees here is the draw, not the money back.
              </>
            }
          />
        )}

        {view === "wheel" && (
          <div className={styles.wheelCol} style={{ position: "static" }}>
            <RouletteWheel
              round={slices}
              spinToId={spin.id || null}
              spinNonce={spin.nonce}
              onLanded={() => setPending(null)}
              winnerId={wheel?.winner ?? null}
              size={400}
              onSliceClick={open ? (s) => setTitle(s.title) : undefined}
            />
            {total === 0n && <p className="footnote">The wheel fills as stakes come in.</p>}
            {elimination && !winner && lastOut && (
              <div className={styles.verdict}>
                <span className="pill">{name(lastOut)} is out</span>
                <span className={styles.verdictNote}>
                  Block {wheel?.stages[stagesDone - 1]?.beacon.slot.toLocaleString()} · {alive.length} still in
                </span>
              </div>
            )}
            {winner && (
              <div className={styles.verdict}>
                <span className="pill ok">
                  <span className="dot" />
                  {name(winner)}
                </span>
                <span className={styles.verdictNote}>
                  Decided by block {wheel?.beacon?.slot.toLocaleString()}
                  {rules ? ` — ${Number(rules.playMinutes)} min on stream.` : "."}
                </span>
              </div>
            )}
          </div>
        )}

        {view === "stake" && (
          <div className={styles.stack}>
            <div className={styles.roundCard}>
              <div className={styles.roundHead}>
                <span>{head}</span>
                <span className="num">{usd(dollars(total))} in the pot</span>
              </div>
              {wheel?.slices.length ? (
                wheel.slices.map((s, i) => {
                  const w = BigInt(s.weight);
                  // On elimination the number on screen is the chance of being
                  // knocked out NEXT, not of winning — otherwise a viewer reads
                  // "47%" as good news while it means the opposite.
                  // Once it is over there is nothing left to be knocked out of:
                  // the number goes back to being a share of the pot, which is
                  // the only thing it can honestly mean on a finished round.
                  const pct = elimination && !wheel.winner
                    ? elimOdds.get(s.key) ?? 0
                    : total > 0n
                      ? Number((w * 1000n) / total) / 10
                      : 0;
                  const isWinner = wheel.winner === s.key;
                  const dead = s.out || s.late;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      className={`${styles.suggestion}${s.out ? ` ${styles.sOut}` : s.late ? ` ${styles.sLate}` : ""}`}
                      style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
                      onClick={() => s.title && open && !dead && setTitle(s.title)}
                      disabled={!open || !s.title || dead}
                      title={
                        s.late
                          ? "Staked after the field was fixed — not in the running"
                          : s.out
                            ? "Knocked out"
                            : s.title
                              ? `Back ${s.title}`
                              : "Nobody has published this title yet"
                      }
                    >
                      <span className={styles.sTitle}>
                        {name(s)}
                        {isWinner && <span className={styles.sGenre}>winner</span>}
                        {s.out && <span className={styles.sGenre}>out</span>}
                        {s.late && <span className={styles.sGenre}>late</span>}
                      </span>
                      <span className={styles.sBar} aria-hidden>
                        <span className={styles.sFill} style={{ width: `${Math.max(3, Math.round(pct))}%` }} />
                      </span>
                      <span className={`${styles.sPool} num`}>{usd(dollars(w))}</span>
                      <span className={styles.sOdds}>{Math.round(pct)}%</span>
                    </button>
                  );
                })
              ) : (
                <div className="footnote">Nothing staked yet — yours starts the round.</div>
              )}
              <div className={styles.roundFoot}>
                {open
                  ? elimination
                    ? `Each spin knocks one ${topic} out — the last one standing wins, and a Solana block decides every spin. Backing protects: the more behind a ${topic}, the safer it is. The % is its chance of going out next.`
                    : `One spin decides it, and a Solana block decides the spin. Tap a ${topic} to back it — losing stakes stay donated.`
                  : phase === "closing"
                    ? "Stakes are closed a little before the round is, so a payment can still reach a block in time."
                    : phase === "settling"
                      ? "Closed — waiting for the block that decides it."
                      : phase === "decided"
                        ? "The wheel has spoken. Losing stakes stay donated."
                        : "Reading the round from the chain…"}
              </div>
            </div>

            {open && (
              <div className={`card ${styles.suggestCard}`}>
                <div className="field">
                  <input
                    type="text"
                    placeholder={
                      fieldFixed
                        ? `Tap a ${topic} above to protect it`
                        : `${topic.charAt(0).toUpperCase()}${topic.slice(1)} title`
                    }
                    value={title}
                    // Once the field is fixed there is nothing to type: the only
                    // move left is to put money behind one of the survivors.
                    readOnly={fieldFixed}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="chips" style={{ justifyContent: "center" }}>
                  {presets.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`chip${!custom && chosen === p ? " active" : ""}`}
                      onClick={() => {
                        setAmount(p);
                        setCustom("");
                      }}
                    >
                      ${p}
                    </button>
                  ))}
                  <input
                    className={styles.customAmount}
                    type="number"
                    min={minDonation}
                    placeholder="Custom"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                </div>
                <MinNote
                  floor={{ amount: minDonation, source: "platform", short: `${usdPrecise(minDonation)} minimum per stake.` }}
                  amount={finalAmount}
                />
                <ReputationDelta rep={rep} gain={finalAmount} tiers={profile.tiers} />
                <button
                  type="button"
                  className="btn"
                  disabled={!canStake}
                  onClick={() => confirm(dangerCopy.roulette(finalAmount), stake)}
                >
                  {busy ? "Sending…" : done ? "On the wheel ✓" : `Back it for ${usd(finalAmount)}`}
                </button>
                {err ? (
                  <div className="footnote" style={{ color: "var(--error)" }}>{err}</div>
                ) : (
                  <div className="footnote">
                    {done
                      ? "Counted — your slice appears once Solana finalizes it."
                      : title.trim()
                        ? "It's a donation either way — win or lose, it stays with the content maker."
                        : fieldFixed
                          ? `Tap a ${topic} above — the field is set, so backing one is all that is left.`
                          : `Name a ${topic} to back, or tap one above.`}
                  </div>
                )}
              </div>
            )}

            <a className={styles.verifyLink} href={`/@${handle}/roulette/verify/${round.roundHex}`}>
              Check this round against the chain →
            </a>
          </div>
        )}
      </div>
      {confirm.dialog}
    </>
  );
}
