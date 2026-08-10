"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePublicProfile } from "@/lib/data/usePublicProfile";
import { useCheer } from "@/lib/data/DataProvider";
import { useWallet } from "@/lib/chain/useWallet";
import { Logo } from "@/components/Logo";
import { ReputationDelta } from "@/components/ReputationDelta";
import { DonateTopBar } from "@/components/DonateTopBar";
import { Mono } from "@/components/Mono";
import { SocialIcon, SOCIAL_LABEL } from "@/components/icons";
import { normalizeSocialLink } from "@/lib/data/social-links";
import { usd } from "@/lib/money";
import { rouletteRules } from "@/lib/data/gameConfig";
import { topicNoun } from "@/lib/data/roulette-topics";
import { RouletteWheel } from "@/components/RouletteWheel";
import { withRouletteDefaults, addSuggestion, readRound, ensureRound, readRoundMeta, setRoundWinner, newRound, survivors, eliminationWeights, eliminate, type RoundMeta } from "@/lib/data/roulette";
import { GAME_GENRES, pickWeighted, roundRand, type GameGenre, type RouletteSuggestion } from "@/lib/data/roulette-mock";
import { backgroundStyle, backgroundInk } from "@/lib/data/pagebuilder";
import { useIsWide } from "@/lib/data/useIsWide";
import { tierInfo } from "@/lib/level";
import { resolvePublicSession, pullSessions } from "@/lib/data/gameSessions";
import { GameTabs } from "@/components/games/GameTabs";
import { GameRules, rouletteLines } from "@/components/games/GameRules";
import { MinNote } from "@/components/games/MinNote";
import { rouletteFloor } from "@/lib/data/floors";
import { useGameSyncState } from "@/lib/data/gameSync";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import styles from "./page.module.css";

type SendState = "idle" | "sending" | "done";

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// The public roulette page — what a viewer opens from the streamer's link or QR: the open
// round with live odds, and the form to suggest (or back) a game by donating toward it.
// The content maker is resolved by handle from the Cheer DB (usePublicProfile), so the page
// renders for any visitor; suggestions still accumulate in localStorage on top of the seeded
// round — same mock backend as the rest of the app until the indexer owns it.
export default function RoulettePage({ params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  // Resolve the content maker by handle from the Cheer DB, so a viewer sees this page in any
  // browser — not just the owner whose localStorage holds the profile.
  const { profile: maker, status } = usePublicProfile(handle);
  const { getReputation, donate } = useCheer();
  const isWide = useIsWide();

  // Session resolution: ?s=<id> picks a specific session; one live session resolves itself;
  // several → the picker below; none → the "nothing running" gate. Streamers who never used
  // sessions fall through on the bare handle (legacy data keeps working).
  const [pub, setPub] = useState<ReturnType<typeof resolvePublicSession> | null>(null);
  useEffect(() => {
    const sParam = new URLSearchParams(window.location.search).get("s");
    // Pull the shared session registry FIRST — a viewer's browser has never seen the streamer's
    // sessions, and without it ?s=<id> resolves to nothing and falls back to the legacy scope.
    let dead = false;
    void pullSessions(handle, "roulette").then(() => {
      if (!dead) setPub(resolvePublicSession(handle, "roulette", sParam));
    });
    return () => {
      dead = true;
    };
  }, [handle]);
  const scope = pub?.scope ?? null;

  const [round, setRound] = useState<RouletteSuggestion[]>([]);
  const [meta, setMeta] = useState<RoundMeta | null>(null);
  const [now, setNow] = useState(0);
  const [spin, setSpin] = useState<{ id: string; nonce: number }>({ id: "", nonce: 0 });
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<GameGenre>("Action");
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [send, setSend] = useState<SendState>("idle");
  const confirm = useConfirm(); // backing a suggestion costs money — ask before it moves
  const wallet = useWallet();
  const [chainErr, setChainErr] = useState("");
  const [view, setView] = useState<"suggest" | "wheel" | "rules">("suggest"); // the top toggle: suggest/back a game vs. the wheel itself

  // Shared game state: other viewers' suggestions/backings land via the nonce effect below.
  // The meta (clock/verdict) deliberately does NOT re-read here — the per-second catch-up effect
  // owns it, so an adopted verdict replays the wheel's landing instead of snapping to it.
  const { nonce: syncNonce, synced } = useGameSyncState(scope);

  useEffect(() => {
    if (!scope) return;
    setRound(readRound(scope));
    setMeta(ensureRound(scope));
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [scope]);

  useEffect(() => {
    if (!scope || !syncNonce) return;
    setRound(readRound(scope));
  }, [scope, syncNonce]);

  // Which spin this tab has already triggered — so expiry, cross-tab verdicts and re-renders can't
  // double-spin. Single rounds key on the round clock; elimination adds the knock-out count, because
  // one elimination round legitimately spins many times.
  const spunFor = useRef<string | null>(null);
  // The round's own meta is authoritative: initRound pins the format when the session opens, so a
  // wheel already spinning can't change shape under the players. The session rules are the fallback
  // for rounds that predate the meta — read here because the spin effects run before `cfg` exists.
  const isElimination = (meta?.format ?? rouletteRules(maker, scope).format ?? "single") === "elimination";

  // Once a second: catch up with the storage — the streamer may have spun early from the
  // cabinet (the maker's call) or started a new round; other tabs may have added suggestions.
  useEffect(() => {
    if (!now || !meta) return;
    const m = readRoundMeta(scope!);
    if (!m) return;
    if (m.startedAt !== meta.startedAt) {
      // New round (the streamer started a fresh one): reset the spin, otherwise `spinning`
      // stays stuck true on the new round and viewers can't suggest or back a game.
      setMeta(m);
      setRound(readRound(scope!));
      setSpin({ id: "", nonce: 0 });
      spunFor.current = null;
      return;
    }
    if (m.winner && !meta.winner && spunFor.current !== String(m.startedAt)) {
      // Verdict decided elsewhere — replay the landing here instead of snapping to it.
      spunFor.current = String(m.startedAt);
      setSpin((s) => ({ id: m.winner!.id, nonce: s.nonce + 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  // Time's up: the clock hits zero with no verdict — the wheel spins itself.
  useEffect(() => {
    if (!now || !meta || meta.winner) return;
    const minutes = rouletteRules(maker, scope).roundMinutes;
    if (now < meta.startedAt + minutes * 60_000) return;
    const r = readRound(scope!);
    if (r.length === 0) {
      // Nothing suggested at all — quietly restart the clock instead of spinning an empty wheel.
      setMeta(newRound(scope!));
      return;
    }

    // Elimination: the wheel keeps spinning, each spin knocking one out. Keyed on the knock-out count
    // so every spin of the same round is allowed exactly once. Money protects — inverted weights.
    if (isElimination) {
      const left = survivors(r, meta);
      // One suggestion (or one survivor left after knock-outs) wins by default — there's no one to
      // eliminate. Cheer it directly: eliminate() only sets the winner as a side effect of a spin,
      // and no spin ever fires here, so without this a lone entry left the round frozen past its
      // deadline forever (dead wheel, no verdict). Guard on spunFor so we cheer exactly once.
      if (left.length === 1) {
        const key = `${meta.startedAt}:solo`;
        if (spunFor.current === key) return;
        spunFor.current = key;
        setMeta(setRoundWinner(scope!, { id: left[0].id, title: left[0].title }));
        return;
      }
      if (left.length < 2) return; // zero survivors — nothing to do
      const key = `${meta.startedAt}:${(meta.eliminated ?? []).length}`;
      if (spunFor.current === key) return;
      const victim = pickWeighted(left, roundRand(meta.startedAt + (meta.eliminated ?? []).length), eliminationWeights(left));
      if (!victim) return;
      spunFor.current = key;
      setSpin((s) => ({ id: victim.id, nonce: s.nonce + 1 }));
      return;
    }

    if (spunFor.current === String(meta.startedAt)) return;
    // Seeded by the round clock: every browser that shares this meta lands the same winner.
    const w = pickWeighted(r, roundRand(meta.startedAt));
    if (!w) return;
    spunFor.current = String(meta.startedAt);
    setSpin((s) => ({ id: w.id, nonce: s.nonce + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, meta]);

  function landed(id: string) {
    const list = readRound(scope!);
    const w = list.find((s) => s.id === id);
    if (!w) return;
    // In elimination the wheel lands on the one that's OUT; eliminate() cheers the last survivor.
    if (isElimination) setMeta(eliminate(scope!, w.id, list));
    else setMeta(setRoundWinner(scope!, { id: w.id, title: w.title }));
  }

  if (status === "loading") return <main className="page" />;

  const mine = maker;
  const rl = mine ? withRouletteDefaults(mine) : null;

  if (!mine || !rl) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>No roulette here</h1>
          <p>This content maker isn&apos;t running a roulette right now.</p>
          <Link className="btn" href={`/@${handle}`}>
            To the content maker's page
          </Link>
        </div>
      </main>
    );
  }

  // The rules THIS round was opened with — the minimum, the topic and the clock a viewer plays under.
  const cfg = rouletteRules(mine, scope);
  // The wheel isn't games-only: speak the streamer's topic ("Suggest a film", "Tap a dish to back it").
  const noun = topicNoun(cfg.topic);
  // Who's still in, and their knock-out odds (only meaningful in elimination).
  const aliveNow = isElimination ? survivors(round, meta) : round;
  const elimWeights = isElimination ? eliminationWeights(aliveNow) : [];
  if (!pub) return <main className="page" />;
  if (!pub.scope) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>{pub.choices.length ? "Pick a session" : "Nothing running right now"}</h1>
          {pub.choices.length ? (
            <>
              <p>Several are live at once — choose the one you were invited to.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                {pub.choices.map((c) => (
                  <a key={c.id} className="btn" href={`?s=${c.id}`}>
                    {c.name}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <>
              <p>Nothing is live. Start a session in your space — Roulette → Sessions — and this page switches on.</p>
              <Link className="btn" href={`/@${handle}`}>
                To the content maker&apos;s page
              </Link>
            </>
          )}
        </div>
      </main>
    );
  }

  const genres = cfg.genres.length ? (cfg.genres as GameGenre[]) : [...GAME_GENRES];
  // Keep the selected genre inside the allowed list — backing a suggestion whose genre the
  // streamer later restricted would otherwise leave <select> with a value that has no <option>.
  const genreValue = genres.includes(genre) ? genre : genres[0];
  const total = round.reduce((sum, s) => sum + s.pool, 0);

  // Round clock: started when the round was first seen, spins on expiry — or earlier,
  // if the streamer hits "Spin now" in the cabinet (the verdict lands in the same storage).
  const deadline = meta ? meta.startedAt + cfg.roundMinutes * 60_000 : 0;
  const msLeft = meta && now ? deadline - now : 1;
  const spinning = spin.nonce > 0 && !meta?.winner;
  const closed = Boolean(meta?.winner) || msLeft <= 0;

  const chosen = amount ?? rl.presets[0];
  const customN = Math.round(Number(custom)) || 0;
  const finalAmount = custom ? customN : chosen;
  const rep = getReputation(handle);

  // Rank mode: putting a game on the wheel is free, but gated by the viewer's rank with this
  // streamer (the maker picked the tier at session creation). Backing stays a donation for everyone.
  const rankMode = meta?.mode === "rank";
  const gateTier = rankMode ? mine.tiers.find((t) => t.name === meta?.minTier) ?? mine.tiers[0] : null;
  const canSuggestByRank = !rankMode || (gateTier ? rep >= gateTier.threshold : true);
  // Backing a suggestion is an ordinary donation carrying words, so the paid
  // floor applies — unless the creator asked for more, in which case theirs wins.
  const floor = rouletteFloor(cfg.minDonation);
  // `synced`: the minimum and the round length on screen must be this run's, not the maker's current
  // (editable) defaults. Rank mode puts a free idea on the wheel, so it isn't gated on money terms.
  const canSend =
    send === "idle" &&
    !closed &&
    title.trim().length > 0 &&
    (rankMode ? canSuggestByRank : synced && finalAmount >= floor.amount);

  // Clicking an existing suggestion pre-fills the form — backing it grows its pool and odds.
  function back(s: RouletteSuggestion) {
    if (closed || spinning) return;
    setTitle(s.title);
    setGenre(s.genre);
  }

  // Backing a game costs real money and goes down the ordinary donation path: the
  // suggestion's title IS the message, so it takes the paid shape (2%) and shows up
  // in the creator's feed and alerts like any other donation with words. Rank mode
  // is the exception the game defines — a free suggestion moves nothing, so there
  // is nothing to send.
  async function suggest() {
    if (!canSend) return;
    setChainErr("");

    if (rankMode) {
      setSend("sending");
      setRound(addSuggestion(scope!, title.trim(), genreValue, 0));
      setTitle("");
      setCustom("");
      setSend("done");
      setTimeout(() => setSend("idle"), 2200);
      return;
    }

    if (!wallet.connected) {
      if (!wallet.hasWallet) {
        setChainErr("No Solana wallet found in the browser. Install Phantom or Solflare.");
        return;
      }
      wallet.connect();
      return;
    }

    setSend("sending");
    try {
      await donate({ handle, amount: finalAmount, message: title.trim(), source: "roulette" }, wallet.address);
      // The wheel only moves once the money has: the pool a viewer sees is money
      // that was actually sent, never an optimistic bump that a failed transaction
      // would leave behind.
      setRound(addSuggestion(scope!, title.trim(), genreValue, finalAmount));
      setTitle("");
      setCustom("");
      setSend("done");
      setTimeout(() => setSend("idle"), 2200);
    } catch (e) {
      setChainErr(e instanceof Error ? e.message.split("\n")[0] : "That didn't go through.");
      setSend("idle");
    }
  }

  return (
    <main className={`${styles.page}${backgroundInk(rl.design) === "light" ? " on-light" : ""}`} style={backgroundStyle(rl.design, isWide)}>
      <DonateTopBar />
      <div className={styles.col}>
        <Link className={styles.who} href={`/@${handle}`} style={{ textDecoration: "none", color: "inherit" }} title={`@${mine.handle} — open profile`}>
          {mine.avatarEnabled !== false && <Mono name={mine.name} size={56} src={mine.avatarUrl} />}
          <div>
            <div className={styles.name}>{mine.name}</div>
            <div className={styles.handle}>@{mine.handle} · <span className={styles.live}>round open</span></div>
          </div>
        </Link>

        {rl.headline.trim() && <h1 className={styles.headline}>{rl.headline}</h1>}
        {rl.descriptionEnabled && rl.description && <p className={styles.desc}>{rl.description}</p>}

        {/* Tab 1: suggest or back a game (the donation). Tab 2: the wheel itself, live. */}
        <GameTabs
          value={view}
          onChange={(v) => setView(v as "suggest" | "wheel" | "rules")}
          tabs={[
            { key: "suggest", label: `Suggest a ${noun}`, count: round.length },
            { key: "wheel", label: "The wheel" },
            { key: "rules", label: "Rules" },
          ]}
        />

        <div className={styles.panel}>
          {view === "rules" && <GameRules lines={rouletteLines(cfg, mine.name, noun)} mine={mine} />}

          {view === "wheel" && (
          <div className={styles.wheelCol} style={{ position: "static" }}>
            <RouletteWheel
              round={rankMode ? round.map((x) => ({ ...x, pool: x.pool || 1 })) : round}
              spinToId={spin.id || null}
              spinNonce={spin.nonce}
              onLanded={landed}
              winnerId={meta?.winner?.id ?? null}
              size={400}
              onSliceClick={closed || spinning ? undefined : back}
            />
            {total === 0 && <p className="footnote">The wheel fills as suggestions come in.</p>}

            {meta?.winner && (
              <div className={styles.verdict}>
                <span className="pill ok">
                  <span className="dot" />
                  {meta.winner.title}
                </span>
                <span className={styles.verdictNote}>The wheel has spoken — {cfg.playMinutes} min on stream.</span>
              </div>
            )}
          </div>
          )}

          {view === "suggest" && (
          <div className={styles.stack}>
            <div className={styles.roundCard}>
              <div className={styles.roundHead}>
                <span>This round{closed ? " · closed" : spinning ? " · spinning…" : ` · ${fmtLeft(msLeft)} left`}</span>
                <span className="num">{usd(total)} in the pot</span>
              </div>
              {round.length ? (
                round.map((s, i) => {
                  const isOut = isElimination && (meta?.eliminated ?? []).includes(s.id);
                  // Single: the % is the chance of WINNING (pool share). Elimination: it's the chance of
                  // being knocked out next — inverted pools, so a big backer reads as a low number.
                  const elimTotal = elimWeights.reduce((sum, n) => sum + n, 0);
                  const elimIdx = aliveNow.findIndex((a) => a.id === s.id);
                  const pct = isElimination
                    ? elimIdx >= 0 && elimTotal > 0
                      ? elimWeights[elimIdx] / elimTotal
                      : 0
                    : total > 0
                      ? s.pool / total
                      : 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`${styles.suggestion}${isOut ? " " + styles.sOut : ""}`}
                      style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
                      onClick={() => !isOut && back(s)}
                      disabled={isOut}
                      title={isOut ? `${s.title} is out` : `Back ${s.title}`}
                    >
                      <span className={styles.sTitle}>
                        {s.title} <span className={styles.sGenre}>{isOut ? "out" : s.genre}</span>
                      </span>
                      <span className={styles.sBar} aria-hidden>
                        <span className={styles.sFill} style={{ width: `${Math.max(3, Math.round(pct * 100))}%` }} />
                      </span>
                      <span className={`${styles.sPool} num`}>{usd(s.pool)}</span>
                      <span className={styles.sOdds}>{isOut ? "—" : `${Math.round(pct * 100)}%`}</span>
                    </button>
                  );
                })
              ) : (
                <div className="footnote">Nothing suggested yet — yours starts the round.</div>
              )}
              <div className={styles.roundFoot}>
                {isElimination
                  ? `Elimination — each spin knocks one out, last ${noun} standing wins. Backing protects: the more it has, the safer it is. Tap a ${noun} to back it.`
                  : `Round: ${cfg.roundMinutes} min · winner gets played for ${cfg.playMinutes} min. Tap a ${noun} to back it.`}
              </div>
            </div>

            {closed && (
              <p className="footnote">Round closed — suggestions reopen when {mine.name} starts a new one.</p>
            )}

            {!closed && rankMode && !canSuggestByRank && (
              <p className="footnote" style={{ textAlign: "center" }}>
                Putting a {noun} on the wheel is for <b>{gateTier?.name}+</b> viewers (yours: {rep} rep). You can still back
                any {noun} above — that&apos;s open to everyone.
              </p>
            )}

            {!closed && canSuggestByRank && rl.widgets.find((w) => w.kind === "donate")?.enabled && (
              <div className={`card ${styles.suggestCard}`}>
                <div className={styles.suggestFields}>
                  <div className="field" style={{ flex: 1 }}>
                    <input type="text" placeholder={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} title`} value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <select className={styles.genreSelect} value={genreValue} onChange={(e) => setGenre(e.target.value as GameGenre)}>
                    {genres.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                {!rankMode && (
                  <>
                    <div className="chips" style={{ justifyContent: "center" }}>
                      {rl.presets.map((p) => (
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
                        min={floor.amount}
                        placeholder="Custom"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                      />
                    </div>
                    <MinNote floor={floor} amount={finalAmount} />
                    <ReputationDelta rep={rep} gain={finalAmount} tiers={mine.tiers} />
                  </>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={!canSend}
                  // Rank mode puts an idea on the wheel for free — nothing to confirm. Paid mode is
                  // money on the table, so it goes through the same gate as every other spend.
                  onClick={() => (rankMode ? suggest() : confirm(dangerCopy.roulette(finalAmount), suggest))}
                >
                  {send === "sending"
                    ? "Sending…"
                    : send === "done"
                      ? rankMode ? "On the wheel ✓" : "In the pot ✓"
                      : rankMode ? "Put it on the wheel" : `Suggest for ${usd(finalAmount)}`}
                </button>
                {chainErr ? (
                  <div className="footnote" style={{ color: "var(--error)" }}>
                    {chainErr}
                  </div>
                ) : (
                  <div className="footnote">
                    {send === "done"
                      ? rankMode ? "On the wheel — anyone can back it with a donation." : "Counted — the odds just moved."
                      : rankMode
                        ? `Free for ${gateTier?.name ?? "ranked"}+ viewers. Backing a ${noun} is a donation, open to everyone.`
                        : "It's a donation either way — win or lose, it stays with the content maker."}
                  </div>
                )}
              </div>
            )}

            {!closed && canSuggestByRank && !rl.widgets.find((w) => w.kind === "donate")?.enabled && (
              <div className={`card ${styles.suggestCard}`}>
                <div className="footnote" style={{ textAlign: "center" }}>
                  {mine.name} isn&apos;t taking suggestions right now.
                </div>
              </div>
            )}

            {rl.widgets.find((w) => w.kind === "socials")?.enabled && (
              <div className={styles.socials}>
                {mine.socials.map((s) => {
                  const safe = normalizeSocialLink(s.kind, s.url);
                  if (!safe) return null;
                  return (
                    <a key={s.kind} href={safe} target="_blank" rel="noreferrer nofollow" aria-label={SOCIAL_LABEL[s.kind]}>
                      <SocialIcon kind={s.kind} />
                    </a>
                  );
                })}
              </div>
            )}

          </div>
          )}
        </div>

        <div className={styles.footer}>
          <Logo />
        </div>
      </div>
      {confirm.dialog}
    </main>
  );
}
