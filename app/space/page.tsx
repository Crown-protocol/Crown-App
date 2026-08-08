"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSolanaWallet } from "@/lib/chain/wallet";
import { useProfile } from "@/lib/data/ProfileProvider";
import { useCheer } from "@/lib/data/DataProvider";
import { SpaceGate } from "@/components/SpaceGate";
import { isDemoAddress, isOwnerAddress, readDemoSession, startDemoSession, endDemoSession, OWNER_ADDRESS } from "@/lib/data/session";
import { lookupAccountByOwner } from "@/lib/data/lookupAccount";
import { proveOwnership, clearProof, hasProof } from "@/lib/data/proveOwnership";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";
import { Mono } from "@/components/Mono";
import { DonationsPanel } from "@/components/DonationsPanel";
import { DonationsChart } from "@/components/DonationsChart";
import { HomeLive } from "@/components/HomeLive";
import { TaskPanel } from "@/components/TaskPanel";
import { WidgetsPanel } from "@/components/WidgetsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TelegramPanel } from "@/components/TelegramPanel";
import { TaskOverview } from "@/components/TaskOverview";
import { FundraiserPanel } from "@/components/FundraiserPanel";
import { FundraiserOverview } from "@/components/FundraiserOverview";
import { RoulettePanel } from "@/components/RoulettePanel";
import { RouletteOverview } from "@/components/RouletteOverview";
import { AuctionPanel } from "@/components/AuctionPanel";
import { AuctionOverview } from "@/components/AuctionOverview";
import { GameSessions, SessionBar } from "@/components/GameSessions";
import { getCurrentSession, activeSessions, pullSessions, readSessions } from "@/lib/data/gameSessions";
import { pullScope } from "@/lib/data/gameSync";
import { NavIcon, GameIcon, ChevronDown } from "@/components/icons";
import { usd } from "@/lib/money";
import { MOCK_DASHBOARD, type DashboardPeriodKey } from "@/lib/data/mock";
import { buildDashboard } from "@/lib/data/dashboard";
import { GAMES, type GameId } from "@/lib/data/games";

type Section = "home" | "donations" | "games" | "widgets" | "telegram" | "settings";

// The panel reads as two labelled groups — "Home" and "Games", the same shape — with Settings
// pinned to the bottom on its own (see .side-bottom).
const NAV_HOME: { key: Section; label: string }[] = [
  { key: "home", label: "Dashboard" },
  { key: "donations", label: "Donations" },
  { key: "widgets", label: "Widgets" },
];

// A game's rules used to be a fourth sidebar item ("Settings") rendering the same panel the
// builder's Rules tab now hosts. Two doors to one room read as two different rooms, so the
// sidebar item is gone — Page → Rules is the single way in.
type GameTab = "page" | "sessions" | "overview";
const GAME_SUBTABS: { key: GameTab; label: string }[] = [
  { key: "page", label: "Page" },
  { key: "sessions", label: "Sessions" },
  { key: "overview", label: "Overview" },
];
const GAME_TABS: Record<GameId, { key: GameTab; label: string }[]> = {
  task: GAME_SUBTABS,
  roulette: GAME_SUBTABS,
  fundraiser: GAME_SUBTABS,
  auction: GAME_SUBTABS,
};

export default function SpacePage() {
  const router = useRouter();
  const { address, connected: isConnected, disconnect, signMessage } = useSolanaWallet();
  const { mode, feed, demoData } = useCheer();
  const { ready, registered, profile, hasSession, sessionChecked, markSession, saveDeferred, hydrate, signOut, reset } = useProfile();
  const [section, setSection] = useState<Section>("home");
  const [period, setPeriod] = useState<DashboardPeriodKey>("30");

  // Signing in: the wallet is the login, with an explicit demo way in (see lib/data/session).
  // Read after mount — localStorage doesn't exist during SSR.
  const [demoSession, setDemoSession] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    setDemoSession(readDemoSession());
    setSessionReady(true);
  }, []);

  // Landing here with a connected wallet but no local profile — most often a fresh device, or after
  // clearing the browser. Ask the Cheer DB whether this wallet OWNS an account: if so, load it (log
  // in); if not, this wallet has no page, so go straight to registration instead of the old
  // "create your page first" dead-end. Only runs once per address, and never in demo (no wallet).
  const probedFor = useRef<string | null>(null);
  // Bumped by the gate's "Sign again" action. Declining the ownership popup re-arms probedFor, but the
  // effect's deps don't otherwise change on a decline, so nothing re-ran it and the person sat forever
  // on "Confirm the signature" with no way back to the prompt. This nonce is a dep, so bumping it
  // re-runs the probe and re-opens the wallet request on demand.
  const [signRetry, setSignRetry] = useState(0);
  // Set while we are deliberately leaving the cabinet (page deleted). Deleting wipes the profile, and
  // for the instant before the wallet actually disconnects the probe would see "no profile + no
  // account in the DB" and redirect to /create — hijacking the navigation to the landing page.
  const leavingRef = useRef(false);
  useEffect(() => {
    if (leavingRef.current) return;
    if (!ready || !isConnected || !address) return;
    // Nothing to do once we're already in — but "in" must mean in as THIS connected wallet, not just
    // that some session exists. Past the guard above a wallet IS attached (a plain reload keeps
    // isConnected false while the extension reattaches, and the render gate below already opens the
    // cabinet for a valid cookie in that window). So the only safe fast path here is "the connected
    // wallet is the one that proved ownership on this device" — hasProof(address). We deliberately do
    // NOT short-circuit on hasSession alone: the session cookie and the loaded profile both belong to
    // whoever last signed in, and switching accounts fires accountChanged with a new address while
    // that stale pair lingers — trusting hasSession kept wallet A's cabinet open under wallet B. When
    // the connected wallet hasn't proved itself, we fall through to the probe, which looks up the NEW
    // wallet's own account and hydrate()s it over the stale profile (or routes to /create).
    if (profile && hasProof(address)) return;
    if (probedFor.current === address) return; // one probe per connected wallet
    probedFor.current = address;
    void (async () => {
      const found = await lookupAccountByOwner(address);
      // Couldn't reach the account service — leave everything as-is and let the probe retry on the
      // next address change / reload. Never fall through to /create: that would send an existing
      // creator into re-registration, where finishing overwrites their own live page.
      if (found.status === "error") {
        probedFor.current = null;
        return;
      }
      if (found.status === "found") {
        const account = found.profile;
        // Prove ownership once per device (wallet signs). Declined → let the probe re-arm so a retry
        // (or the gate) can ask again, don't log in unproven.
        const proof = await proveOwnership(address, signMessage);
        // "no-session" too: the signature was fine but no cookie came back, so edits here would be
        // refused. Re-arm the probe and let the gate ask again rather than opening a cabinet that
        // cannot save.
        if (proof === "declined" || proof === "no-session") {
          probedFor.current = null;
          return;
        }
        markSession(); // the server just recognised us — don't wait for a reload to find out
        hydrate(account); // load THIS wallet's own account (replaces any stale profile on the device)
      } else if (!profile && !leavingRef.current) {
        // This wallet owns no page and the device has none either → registration. (Not while we're on
        // our way out after a delete — that navigation owns the screen.)
        router.replace("/create");
      }
      // Wallet owns nothing but a profile sits on this device: it isn't this wallet's account, so we
      // leave it be — the gate below shows "that's not this page's wallet" instead of letting them in.
    })();
  }, [ready, profile, hasSession, isConnected, address, hydrate, router, signMessage, markSession, signRetry]);

  // Bumps whenever a session is created/selected/ended, so everything reading the session
  // registry (a plain localStorage store) re-renders with the fresh pick.
  const [sessionNonce, setSessionNonce] = useState(0);


  // ── Restore this device's games from the server ───────────────────────────────────────────────
  // The session registry and every game's state are localStorage stores, and Log out deliberately
  // wipes them (clearPageData) — so signing back in showed a cabinet with no mini-games and the
  // streamer built every one of them again. They were never lost: the registry syncs to
  // /api/gamestate under "<handle>:<gameId>" and each session's state under its own scope. Nothing
  // in the CABINET pulled any of it back, though — every other surface does (the public game pages,
  // the overlays, ViewerLive), which is why a page kept running for viewers while its own cabinet
  // looked empty. Pull the same things ViewerLive pulls, then bump the nonce so the reads below
  // pick them up. One shot per handle: the cabinet is the only writer of the registry, and each
  // panel's own useGameSync keeps the live game state flowing after that.
  const pulledFor = useRef<string | null>(null);
  useEffect(() => {
    const handle = profile?.handle;
    if (!handle || pulledFor.current === handle) return;
    pulledFor.current = handle;
    let dead = false;
    void (async () => {
      const ids = GAMES.map((g) => g.id);
      await Promise.all(ids.map((g) => pullSessions(handle, g)));
      // Each session keeps its state under its OWN scope, so the registries alone would restore the
      // tabs and leave every one of them empty. The bare handle is the legacy scope the first
      // session ever adopts, and the scope of a page that predates sessions — always worth pulling.
      const scopes = new Set<string>([handle]);
      for (const g of ids) for (const s of readSessions(handle, g)) scopes.add(s.scope);
      await Promise.all([...scopes].map((s) => pullScope(s)));
      if (!dead) setSessionNonce((n) => n + 1);
    })();
    return () => {
      dead = true;
    };
  }, [profile?.handle]);

  // "Games" accordion in the sidebar: which game is expanded and which of its tabs is selected.
  const [openGame, setOpenGame] = useState<GameId | null>(null);
  const [gameId, setGameId] = useState<GameId>(GAMES[0].id);
  const [gameTab, setGameTab] = useState<GameTab>(GAME_TABS[GAMES[0].id][0].key);

  // Ending the last session while standing on Page or Overview leaves you on a tab that just
  // vanished from the sidebar — the content stays, but nothing in the nav is highlighted and there
  // is no way back to it. Fall back to Sessions, which is where a new run starts.
  useEffect(() => {
    if (section !== "games") return;
    if (gameTab === "sessions") return;
    if (activeSessions(profile?.handle ?? "", gameId).length === 0) setGameTab("sessions");
    // sessionNonce is the dependency that matters: it bumps on every create/select/end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, gameTab, gameId, sessionNonce, profile?.handle]);

  // The sidebar is a drawer: open by default on desktop (pushes content aside), tucked away on a
  // phone (slides over with a scrim). `navAnim` gates the slide transition so setting the correct
  // initial state on mount doesn't animate. On a phone, picking anything closes the drawer.
  const [navOpen, setNavOpen] = useState(true);
  const [navAnim, setNavAnim] = useState(false);
  useEffect(() => {
    setNavOpen(window.matchMedia("(min-width: 901px)").matches);
    const id = requestAnimationFrame(() => setNavAnim(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Escape closes the drawer (phone), matching the scrim tap.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !window.matchMedia("(min-width: 901px)").matches) setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);
  const closeNavOnPhone = () => { if (!window.matchMedia("(min-width: 901px)").matches) setNavOpen(false); };

  // Wait for the session answer too. Deciding on `ready` alone showed the gate for the moment
  // between reading the cached profile and hearing back from the server — on a reload that moment IS
  // the whole experience: the cabinet flashed "Connect your wallet" at someone already signed in.
  if (!ready || !sessionReady || !sessionChecked) return <main className="page" />;

  // No profile loaded on this device yet. Rather than a "create your page first" dead-end, decide by
  // the wallet:
  if (!registered || !profile) {
    // On our way out after deleting the page — render nothing and let the navigation to the landing
    // page finish. Without this, the branches below would fire /create in that same instant.
    if (leavingRef.current) return <main className="page" />;
    // Wallet connected → the probe above is resolving it (load the owned account, or redirect to
    // /create). Show a quiet loading state, never a wall with a redundant button.
    if (isConnected && address) {
      return <main className="page" />;
    }
    // Demo way in but no page exists — there's nothing to show a space for; go make one.
    if (demoSession) {
      router.replace("/create");
      return <main className="page" />;
    }
    // Cold open, no wallet: ask for it. Connecting then routes via the same owner lookup (the probe),
    // so an existing account logs in and a new wallet lands on /create.
    return (
      <SpaceGate
        pageAddress=""
        allowDemo={mode === "mock"}
        onDemoEnter={() => router.replace("/create")}
      />
    );
  }

  // A profile EXISTS on this device — but that alone must NOT open the cabinet: on a shared or
  // borrowed browser someone else's profile can still be sitting in localStorage. Two things do
  // qualify as being signed in:
  //
  //   • the server session (hasSession) — the cookie minted from a verified signature. This is the
  //     one that survives a reload, and leaving it out is why the cabinet threw people back to
  //     "Connect your wallet" on every refresh: the extension needs a moment to reattach, and until
  //     it did, `isConnected` was false and the gate slammed shut on a perfectly valid session.
  //   • the connected wallet that proved ownership here (hasProof).
  //
  // Neither is weaker than what was here before — a session only exists because a wallet signed for
  // it, and logging out deletes it server-side along with the proof.
  //
  // We deliberately do NOT compare against profile.address: that's the PAYOUT address (editable in
  // Settings), not a login — a creator may pay out to a different wallet than the one they sign in
  // with, and comparing against it used to lock people out of their own space.
  // While no wallet is attached yet (the extension reconnects seconds after load, or the person
  // signed in before sessions existed and has no cookie at all), fall back to the device-level
  // proof — the same rule the landing header uses. A proof is only ever written after a verified
  // signature and log out deletes it, so this opens the cabinet for exactly the people who already
  // signed here, and nobody else.
  // With a wallet attached, ask about THAT wallet. Without one (the extension reconnects a beat after
  // load), ask about the wallet that owns the page being opened — not "does this device hold any proof
  // at all". On a shared browser hasAnyProof() let whoever signed in last walk into a cabinet cached
  // from someone else's session; the server refused every save, but the page had already been read.
  const proven = isConnected && !!address ? hasProof(address) : !!profile.address && hasProof(profile.address);
  const signedIn = hasSession || proven || demoSession;
  if (!signedIn) {
    // Either nothing is connected (cold open on a device that holds a profile), or a wallet IS
    // connected but hasn't proved it owns this account — the probe above is asking it to sign, and if
    // it owns nothing the gate below names the mismatch instead of opening someone else's cabinet.
    return (
      <SpaceGate
        pageAddress={profile.address}
        connectedAddress={isConnected && address ? address : undefined}
        allowDemo={isDemoAddress(profile.address) || mode === "mock"}
        onRetry={() => setSignRetry((n) => n + 1)}
        onDemoEnter={() => {
          startDemoSession();
          setDemoSession(true);
        }}
      />
    );
  }

  // Real numbers by default (built from this page's own donations). Demo numbers are opt-in via the
  // admin panel — when on, we hand the tiles/chart the MOCK_DASHBOARD sample AND flag it visually
  // (red tint + "demo" tooltip) so an invented $1,284 can never be mistaken for real money.
  const d = demoData ? MOCK_DASHBOARD[period] : buildDashboard(feed, period, profile.address);
  // Has this page ever been donated to? Deliberately asked of ALL time, not the selected period —
  // keying it on `d.donations` would make the switcher vanish the moment someone picked a quiet week,
  // taking away the only control that could get them back.
  const hasData = demoData || buildDashboard(feed, "all", profile.address).donations > 0;
  const game = GAMES.find((g) => g.id === gameId)!;

  // Which sub-tabs a game shows. With nothing running, "Page" and "Overview" have nothing to be
  // about — the builder previews a page that doesn't exist yet and the overview counts an empty
  // set — so the only honest door is Sessions, where you start one. They appear the moment a
  // session does.
  const tabsFor = (id: GameId) =>
    activeSessions(profile.handle, id).length > 0
      ? GAME_TABS[id]
      : GAME_TABS[id].filter((t) => t.key === "sessions");

  // The session the game tabs are looking at. Reading sessionNonce here is what ties the reads
  // below to the counter, so any create/select/end re-runs them.
  void sessionNonce;
  const currentSession = getCurrentSession(profile.handle, gameId);
  const liveSessions = activeSessions(profile.handle, gameId);
  const gameScope = currentSession?.scope ?? profile.handle;
  const shareQuery = currentSession && currentSession.scope !== profile.handle ? `?s=${currentSession.id}` : "";

  // Click on a game name: expands/collapses its tab list in the sidebar
  // and immediately shows its first tab in the main column.
  function toggleGame(id: GameId) {
    if (openGame === id) {
      // Collapsing the open game: also leave the games section, otherwise its full builder stays
      // rendered in the main column with nothing active in the sidebar.
      setOpenGame(null);
      if (section === "games" && gameId === id) setSection("home");
      return;
    }
    setOpenGame(id);
    setSection("games");
    setGameId(id);
    // First AVAILABLE tab: with no session that's Sessions, not the page builder for a page that
    // isn't there yet.
    setGameTab(tabsFor(id)[0].key);
  }

  // Switching to a flat section (Home/Donations/Widgets/Settings) closes any expanded game row.
  function goSection(s: Section) {
    setSection(s);
    setOpenGame(null);
    closeNavOnPhone();
  }

  function selectGameTab(id: GameId, tab: GameTab) {
    setSection("games");
    setGameId(id);
    setGameTab(tab);
    closeNavOnPhone();
  }

  return (
    <main className="page">
      <div className={`space${navOpen ? " nav-open" : ""}${navAnim ? " nav-anim" : ""}`}>
        <div className="topbar">
          <button
            type="button"
            className="nav-toggle"
            aria-label={navOpen ? "Collapse menu" : "Open menu"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            {/* chevrons both ways, not ✕/burger: the drawer slides — left tucks it away, right brings it back */}
            {navOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </button>
          <Logo />
          <div className="me">
            {/* Identity badge, not a link: it answers "signed in as…" and nothing more. Navigation
                lives in the sidebar, and a second clickable route here only competed with it. */}
            <div className="who" title={`Signed in as @${profile.handle}`}>
              <Mono name={profile.name} size={28} src={profile.avatarUrl} />
              <span>{profile.name}</span>
            </div>
            <NotificationBell handle={profile.handle} />
          </div>
        </div>

        <button type="button" className="nav-scrim" aria-hidden tabIndex={-1} onClick={() => setNavOpen(false)} />

        <div className="space-body">
        <nav className="sidenav" aria-label="Space sections">
          <div className="side-label">Home</div>

          {NAV_HOME.map((n) => (
            <button key={n.key} type="button" className={`nav-item${section === n.key ? " active" : ""}`} onClick={() => goSection(n.key)}>
              <NavIcon name={n.key} />
              {n.label}
            </button>
          ))}

          <div className="side-divider" />
          <div className="side-label">Games</div>

          {GAMES.map((g) => {
            const open = openGame === g.id;
            return (
              <div key={g.id}>
                <button type="button" className={`game-row${open ? " open" : ""}`} aria-expanded={open} onClick={() => toggleGame(g.id)}>
                  <GameIcon id={g.id} width={18} height={18} />
                  {g.title}
                  <ChevronDown className="chev" />
                </button>
                {open && (
                  <div className="game-sub">
                    {tabsFor(g.id).map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`game-sub-item${section === "games" && gameId === g.id && gameTab === t.key ? " active" : ""}`}
                        onClick={() => selectGameTab(g.id, t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="side-divider" />
          <div className="side-label">Bot</div>
          <button
            type="button"
            className={`nav-item${section === "telegram" ? " active" : ""}`}
            onClick={() => goSection("telegram")}
          >
            <NavIcon name="telegram" />
            Telegram
          </button>

          <div className="side-bottom">
            <div className="side-divider" />
            {/* Admin/ops — owner-only entry, deliberately NOT in the public marketing nav (TopNav).
                Shown when this is the platform owner: either the owner's wallet is connected right now,
                OR the owner proved ownership on this device (hasProof) — the wallet extension drops the
                connection for a beat on log out → log back in, and tying the link to the LIVE connection
                alone made the Admin entry vanish every time the owner re-entered until they manually
                reconnected. hasProof only exists after a verified signature and log out clears it, so
                this opens for exactly the owner and nobody else. The /admin route's real gate is on the
                backend regardless. */}
            {(isOwnerAddress(address) || hasProof(OWNER_ADDRESS)) && (
              <Link href="/admin" className="nav-item">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l7 3v5c0 4.3-2.9 7.6-7 8.7C7.9 18.6 5 15.3 5 11V6l7-3Z" />
                  <path d="M9.2 12l2 2 3.6-3.8" />
                </svg>
                Admin
              </Link>
            )}
            <button
              type="button"
              className={`nav-item${section === "settings" ? " active" : ""}`}
              onClick={() => goSection("settings")}
            >
              <NavIcon name="settings" />
              Settings
            </button>
          </div>
        </nav>

        <div className={`main${(section === "games" && gameTab === "page") || section === "widgets" ? " main-wide" : ""}`}>
          {section === "home" && (
            <>
              <div className="main-head">
                <h1>Dashboard</h1>
                {/* The period switcher only appears once there is something to slice. On a page that
                    has never been donated to, every period shows the same zeros — three controls
                    asking a question whose answer can't change yet. */}
                {hasData && (
                  <div className="seg" role="group" aria-label="Period">
                    <button type="button" className={period === "7" ? "active" : ""} onClick={() => setPeriod("7")}>
                      7 days
                    </button>
                    <button type="button" className={period === "30" ? "active" : ""} onClick={() => setPeriod("30")}>
                      30 days
                    </button>
                    <button type="button" className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>
                      All time
                    </button>
                  </div>
                )}
              </div>

              {/* Two tiles, not three. "New viewers" counted distinct donors whose first donation fell
                  in the window — a real number, but it measured donors while calling them viewers, and
                  anonymous ones sharing a name collapsed into one. Money received and how many times
                  are both exact and are what a maker actually opens this page for. */}
              <div className="tiles tiles-2">
                <div className={`card tile${demoData ? " tile-demo" : ""}`} title={demoData ? "demo numbers" : undefined}>
                  <div className="v num">{usd(d.received)}</div>
                  <div className="k">received</div>
                </div>
                <div className={`card tile${demoData ? " tile-demo" : ""}`} title={demoData ? "demo numbers" : undefined}>
                  <div className="v num">{d.donations}</div>
                  <div className="k">donations</div>
                </div>
              </div>

              <div className={`card chart-card${demoData ? " chart-demo" : ""}`} title={demoData ? "demo numbers" : undefined}>
                <DonationsChart d={d} periodLabel={period === "7" ? "7 days" : period === "30" ? "30 days" : "All time"} />
              </div>

              <HomeLive
                profile={profile}
                onOpen={(g) => {
                  setOpenGame(g);
                  selectGameTab(g, "overview");
                }}
              />
            </>
          )}

          {section === "donations" && (
            <>
              <div className="main-head">
                <h1>Donations</h1>
              </div>
              {/* No wrapping .card here on purpose: the panel is two separate things — the filter rail
                  and the feed — and a card around both glued them into one slab, with the rail reading
                  as a box inside a box. Each half now carries its own surface. */}
              <DonationsPanel />
            </>
          )}

          {section === "games" && gameTab === "page" && liveSessions.length === 0 && (
            <>
              <div className="main-head">
                <h1>{game.title}</h1>
              </div>
              <div className="blank-state">
                <span className="blank-mark" aria-hidden>
                  <GameIcon id={game.id} width={26} height={26} />
                </span>
                <h2>No live session</h2>
                <p>The page needs a running session behind it — start one, and the builder and the public link light up.</p>
                <button className="btn" type="button" onClick={() => setGameTab("sessions")}>
                  Create a session
                </button>
                <a className="blank-link" href={`/games/${game.id}`} target="_blank" rel="noreferrer">
                  How {game.title} works ↗
                </a>
              </div>
            </>
          )}

          {section === "games" && gameTab === "page" && liveSessions.length > 0 && (
            <>
              <div className="main-head">
                <h1>{game.title}</h1>
              </div>
              {game.id === "task" && (
                <>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    Build the task page, then share the link or QR — viewers open it and set you a task.
                  </p>
                  <TaskPanel profile={profile} onSave={saveDeferred} />
                </>
              )}
              {game.id === "roulette" && (
                <>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    Build the roulette page, then share the link or QR — viewers open it and suggest a game.
                  </p>
                  <RoulettePanel profile={profile} onSave={saveDeferred} />
                </>
              )}
              {game.id === "fundraiser" && (
                <>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    Build the fundraiser page, then share the link or QR — viewers open it and chip in.
                  </p>
                  <FundraiserPanel profile={profile} onSave={saveDeferred} />
                </>
              )}
              {game.id === "auction" && (
                <>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    Build the auction page, then share the link or QR — viewers open it and bid their lots.
                  </p>
                  <AuctionPanel profile={profile} onSave={saveDeferred} />
                </>
              )}
            </>
          )}

          {section === "games" && gameTab !== "page" && (
            <>
              <div className="main-head">
                <h1>{game.title}</h1>
              </div>

              {gameTab === "sessions" && (
                <GameSessions
                  profile={profile}
                  onSave={saveDeferred}
                  gameId={game.id}
                  gameTitle={game.title}
                  onOpen={() => {
                    setSessionNonce((n) => n + 1);
                    setGameTab("overview");
                  }}
                  onCreated={() => {
                    setSessionNonce((n) => n + 1);
                    setGameTab("page");
                  }}
                />
              )}

              {gameTab === "overview" && (
                <SessionBar
                  handle={profile.handle}
                  gameId={game.id}
                  currentId={currentSession?.id ?? null}
                  onSwitch={() => setSessionNonce((n) => n + 1)}
                />
              )}
              {gameTab === "overview" && liveSessions.length === 0 && !currentSession && (
                <div className="blank-state">
                  <span className="blank-mark" aria-hidden>
                    <GameIcon id={game.id} width={26} height={26} />
                  </span>
                  <h2>No live session</h2>
                  <p>Start a session and this tab becomes its control room.</p>
                  <button className="btn" type="button" onClick={() => setGameTab("sessions")}>
                    Create a session
                  </button>
                  <a className="blank-link" href={`/games/${game.id}`} target="_blank" rel="noreferrer">
                    How {game.title} works ↗
                  </a>
                </div>
              )}

              {game.id === "task" && gameTab === "overview" && (liveSessions.length > 0 || currentSession) && <TaskOverview profile={profile} scope={gameScope} />}

              {game.id === "fundraiser" && gameTab === "overview" && (liveSessions.length > 0 || currentSession) && <FundraiserOverview profile={profile} scope={gameScope} />}

              {game.id === "roulette" && gameTab === "overview" && (liveSessions.length > 0 || currentSession) && <RouletteOverview profile={profile} scope={gameScope} shareQuery={shareQuery} />}

              {game.id === "auction" && gameTab === "overview" && (liveSessions.length > 0 || currentSession) && <AuctionOverview profile={profile} scope={gameScope} shareQuery={shareQuery} />}
            </>
          )}

          {section === "settings" && (
            <>
              <div className="main-head">
                <h1>Settings</h1>
              </div>
              <SettingsPanel
                profile={profile}
                walletAddress={isConnected && address ? address : undefined}
                onSave={saveDeferred}
                onDelete={async () => {
                  // Claim the navigation before anything clears: the probe must not fire /create while
                  // we're deleting and heading to the landing page.
                  leavingRef.current = true;
                  // Wait for the DB row to actually go before leaving — navigating first killed the
                  // in-flight request and the page survived on the server. On failure stay put and
                  // report it; SettingsPanel surfaces the reason.
                  const res = await reset();
                  if (!res.ok) {
                    leavingRef.current = false; // stayed in the cabinet — re-arm the probe
                    return res;
                  }
                  // The page is gone, so this device must not walk straight back in: drop the proof and
                  // the remembered wallet, otherwise the /space probe would re-hydrate on the next load.
                  clearProof(address);
                  disconnect();
                  endDemoSession();
                  setDemoSession(false);
                  router.push("/");
                  // Re-arm once the navigation is under way. Left stuck true, coming BACK to /space
                  // (back button / any in-app link, which reuses the cached route segment) rendered a
                  // permanently blank cabinet with the probe disabled.
                  setTimeout(() => { leavingRef.current = false; }, 1500);
                  return res;
                }}
                onLogOut={() => {
                  // Claim the navigation FIRST. Logging out clears the proof and the profile, but this
                  // component is still mounted and `address` only drops on the next render — the probe
                  // would fire in that gap, re-prove ownership and hydrate the profile straight back in,
                  // so after a reload Log out looked like it did nothing.
                  leavingRef.current = true;
                  // Forget this device: proof for THIS wallet (captured before disconnect nulls the
                  // address), the wallet connection, the cached profile and any demo session. The page
                  // stays in the DB — but the next sign-in must connect AND sign again.
                  clearProof(address); // no address (wallet already gone) → clears every proof on this device
                  disconnect(); // also clears the remembered wallet, so no silent auto-reconnect
                  signOut(); // drop the local profile, so the next login runs the full flow (+ signature)
                  endDemoSession();
                  setDemoSession(false);
                  router.push("/");
                  setTimeout(() => { leavingRef.current = false; }, 1500);
                }}
              />
            </>
          )}

          {section === "telegram" && (
            <>
              <div className="main-head">
                <h1>Telegram bot</h1>
              </div>
              <TelegramPanel handle={profile.handle} name={profile.name} />
            </>
          )}

          {section === "widgets" && (
            <>
              <div className="main-head">
                <h1>Widgets</h1>
              </div>
              <WidgetsPanel handle={profile.handle} />
            </>
          )}
        </div>
        </div>
      </div>
    </main>
  );
}
