"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSolanaWallet } from "@/lib/chain/wallet";
import { buildAuthMessage } from "@/lib/chain/authMessage";
import { isDemoAddress } from "./session";
import type { Profile } from "./types";

// How publishing to the Crown DB went. "unsigned" = the wallet didn't sign (declined / not connected)
// so the server refused; "taken" = handle reserved or owned by someone else; "network" = unreachable.
// `signed` says whether the wallet actually produced a signature for this save. A demo-address page
// publishes fine WITHOUT one, so callers must not treat plain success as proof of wallet ownership.
export type SaveResult = { ok: true; signed: boolean } | { ok: false; reason: "unsigned" | "taken" | "network" };

const KEY = "crown-profile";

// How long editing must be idle before the signed publish fires. Long enough to type a name without a
// popup per letter, short enough that leaving the screen still lands the change.
const PUBLISH_DELAY_MS = 2500;

// Storage that belongs to the PAGE (game state, sessions, cached feed) and must go when the page is
// deleted or signed out of. Everything else — wallet choice, mode toggle, the per-wallet login proofs,
// the demo session — belongs to the browser/visitor and is left alone. This is an allow-list on
// purpose: the old "wipe every crown-* except four" swept away `crown-login-proof:<other wallet>` and
// `crown-demo-session`, logging OTHER wallets out of this device.
const PAGE_KEY_PREFIXES = [
  "crown-tasks",
  "crown-roulette",
  "crown-auction",
  "crown-fundraiser",
  "crown-donations",
  "crown-game-sessions",
  "crown-current-session",
  "crown-fresh-scope",
  "crown-gamesync",
];

function clearPageData() {
  try {
    Object.keys(localStorage)
      .filter((k) => PAGE_KEY_PREFIXES.some((prefix) => k === prefix || k.startsWith(prefix)))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

interface ProfileCtx {
  ready: boolean;
  profile: Profile | null;
  registered: boolean;
  // True when the server recognised our session cookie on load. Survives a reload; the wallet
  // connection does not, which is why "am I signed in" can't be asked of the wallet alone.
  hasSession: boolean;
  // False until that question has been answered. Screens that lock people out — the cabinet gate —
  // must wait for it: `ready` flips as soon as the cached profile is read, and deciding then meant
  // slamming the gate a beat before the server said "yes, I know you".
  sessionChecked: boolean;
  save: (p: Profile) => Promise<SaveResult>;
  // Same as save() but batched: local write is instant, the signed publish waits for edits to stop.
  saveDeferred: (p: Profile) => void;
  hydrate: (p: Profile) => void;
  signOut: () => void;
  reset: () => Promise<SaveResult>;
}

const Ctx = createContext<ProfileCtx | null>(null);

// A streamer profile = "registration": localStorage is the cabinet's own copy,
// the Crown DB (/api/profiles) is the server copy public pages resolve against.
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const wallet = useSolanaWallet();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Restore on load: localStorage first (instant, no flash of the signed-out landing), then ask the
  // server who the session cookie belongs to.
  //
  // The server step is the one that matters. Being logged in used to depend on localStorage alone,
  // so anything that cleared site data — the browser trimming storage, a "clear cookies and site
  // data" click, a fresh profile — logged the account out even though the session cookie was still
  // valid for hours. The cookie is the real credential; localStorage is only a cache of it.
  useEffect(() => {
    let alive = true;
    let cached = false;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        setProfile(JSON.parse(raw));
        cached = true;
      }
    } catch {}

    // With a cached profile the UI can render at once. With nothing cached it must NOT: `ready` is
    // what TopRight uses to choose between "Create or log in" and the account, and flipping it
    // before the session answers paints the signed-out nav over a perfectly valid session.
    if (cached) setReady(true);

    (async () => {
      try {
        const res = await fetch("/api/profiles/me", { credentials: "same-origin", cache: "no-store" });
        if (!alive || !res.ok) return;
        const json = (await res.json()) as { profile?: Profile | null };
        if (!alive || !json?.profile) return;
        setHasSession(true);
        // The session's account wins over the local copy: it's the one the server will accept writes
        // for, and a stale cached profile here is how you end up editing a page you no longer own.
        setProfile(json.profile);
        try {
          localStorage.setItem(KEY, JSON.stringify(json.profile));
        } catch {}
      } catch {
        // Offline or the server is down — the localStorage copy above already stands in.
      } finally {
        if (alive) {
          setSessionChecked(true);
          setReady(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Re-read when another document on this origin writes the profile. The `storage` event fires
  // in every same-origin document EXCEPT the one that made the change — so when the cabinet's
  // page builder saves, its live iframe preview (a separate document) picks the edit up here and
  // re-renders. Also keeps two open tabs of the app in sync.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== KEY) return;
      try {
        const raw = localStorage.getItem(KEY);
        setProfile(raw ? JSON.parse(raw) : null);
      } catch {}
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Self-heal: a page that exists here but not on the server ────────────────────────────────
  // The /@handle routes 404 unless the DB has the page, so a local-only profile makes the builder's
  // own preview (and every share link) show "Page not found" while the cabinet looks fine. That
  // happens whenever a publish never landed — offline at sign-up, a server wipe, a stale browser.
  // Re-publish once on load so the page repairs itself instead of silently being invisible.
  // No wallet prompt: demo pages post unsigned, and a real page needs its owner's signature, which
  // the next real edit (or sign-in) supplies — this must never pop a wallet on page load.
  const healedRef = useRef(false);
  useEffect(() => {
    if (!ready || !profile || healedRef.current) return;
    healedRef.current = true;
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/profiles/${encodeURIComponent(profile.handle)}`);
        if (!alive || r.status !== 404) return; // exists, or the server can't answer — leave it be
        await publish(profile);
      } catch {
        // offline — the next edit publishes anyway
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, profile?.handle]);

  // Saves locally at once (the cabinet never blocks on the network) AND publishes to the Crown DB —
  // returning how the publish went, so callers that must not lie to the user (registration!) can react.
  // Editing screens can keep ignoring the result; a page that only lives in localStorage is invisible
  // to every other browser, so registration checks it.
  // Publishes to the Crown DB. Asks the wallet for ONE signature, so callers must not run this per
  // keystroke — see saveDeferred below.
  const publish = useCallback(
    (p: Profile, opts?: { allowWalletPrompt?: boolean }): Promise<SaveResult> => {
      return (async (): Promise<SaveResult> => {
        const headers: Record<string, string> = { "content-type": "application/json" };
        const body = JSON.stringify(p);

        // 1) Try the editing session first (httpOnly cookie from the one sign-in signature). This is
        //    what keeps the wallet quiet while you rename a page or drag a gradient slider.
        try {
          const res = await fetch("/api/profiles", { method: "POST", headers, body, credentials: "same-origin" });
          if (res.ok) return { ok: true, signed: false };
          // 401/403 here just means "no usable session" — fall through to the wallet below.
          if (res.status !== 401 && res.status !== 403) {
            if (res.status === 409) return { ok: false, reason: "taken" };
            return { ok: false, reason: "network" };
          }
        } catch {
          return { ok: false, reason: "network" };
        }

        // 2) No session (first save after a cold start, expired cookie, or registration). Sign — but
        //    only where a popup is expected: registration and explicit retries, never a background
        //    autosave, which is how the wallet used to interrupt editing.
        if (!opts?.allowWalletPrompt) return { ok: false, reason: "unsigned" };

        let signed = false;
        if (wallet.connected && wallet.address) {
          const ts = Math.floor(Date.now() / 1000);
          const sig = await wallet.signMessage(await buildAuthMessage("profile", p.handle, ts, p));
          if (sig) {
            headers["x-crown-pubkey"] = wallet.address;
            headers["x-crown-ts"] = String(ts);
            headers["x-crown-signature"] = Buffer.from(sig).toString("base64");
            signed = true;
          }
        }
        if (!signed && !isDemoAddress(p.address)) return { ok: false, reason: "unsigned" };
        try {
          const res = await fetch("/api/profiles", { method: "POST", headers, body, credentials: "same-origin" });
          if (res.ok) return { ok: true, signed };
          if (res.status === 401) return { ok: false, reason: "unsigned" };
          if (res.status === 403 || res.status === 409) return { ok: false, reason: "taken" };
          return { ok: false, reason: "network" };
        } catch {
          return { ok: false, reason: "network" };
        }
      })();
    },
    [wallet]
  );

  // Registration and anything else that must know the server accepted it: saves locally and publishes
  // immediately, one signature, result awaited.
  const save = useCallback(
    (p: Profile): Promise<SaveResult> => {
      setProfile(p);
      try {
        localStorage.setItem(KEY, JSON.stringify(p));
      } catch {}
      return publish(p, { allowWalletPrompt: true });
    },
    [publish]
  );

  // Editing screens (Settings, page builders) call this on every keystroke and every toggle. It saves
  // locally at once — the cabinet is instant and never blocks — but DELAYS the signed publish until the
  // edits stop. Publishing per change meant the wallet threw a "Sign message" popup for every single
  // letter typed into the name field, which is what made editing feel broken.
  const pendingRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; profile: Profile | null }>({ timer: null, profile: null });
  // Drop a queued publish outright. Log out and Delete MUST call this: a publish armed a moment before
  // deleting would fire afterwards and re-create the row in the DB (the wallet is still the signer, so
  // the server happily accepts it) — the page came back from the dead.
  const cancelPending = useCallback(() => {
    if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
    pendingRef.current.timer = null;
    pendingRef.current.profile = null;
  }, []);
  const saveDeferred = useCallback(
    (p: Profile) => {
      setProfile(p);
      try {
        localStorage.setItem(KEY, JSON.stringify(p));
      } catch {}
      pendingRef.current.profile = p;
      if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
      pendingRef.current.timer = setTimeout(() => {
        const latest = pendingRef.current.profile;
        pendingRef.current.timer = null;
        pendingRef.current.profile = null;
        if (latest) void publish(latest);
      }, PUBLISH_DELAY_MS);
    },
    [publish]
  );

  // Don't let a queued publish die with the page: flush it when the tab is hidden or closed, so edits
  // made a second before leaving still reach the server. Both listeners are named so BOTH get removed —
  // an anonymous visibilitychange handler used to be re-added on every wallet-state change and never
  // removed, so hiding the tab eventually fired a burst of signature popups, some bound to a stale wallet.
  useEffect(() => {
    const flush = () => {
      const latest = pendingRef.current.profile;
      if (!latest) return;
      cancelPending();
      void publish(latest);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [publish, cancelPending]);

  // Log in with an account that already exists on the server (found by wallet owner). Unlike save(),
  // this does NOT POST back — the page is already in the DB, and re-posting would ask the wallet to
  // sign for nothing. It just seeds the cabinet's local copy so the app renders you signed in.
  const hydrate = useCallback((p: Profile) => {
    setProfile(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {}
  }, []);

  // Log out on THIS device: forget the cached profile only. The server copy (the Crown DB) is left
  // intact — signing back in re-fetches it by wallet owner — but locally we're back to "no profile",
  // so the next sign-in goes through the full flow (wallet + one-time ownership signature) again.
  // Distinct from reset(), which DELETES the page from the DB.
  const signOut = useCallback(() => {
    cancelPending();
    setProfile(null);
    setHasSession(false);
    // Drop the server session too, not just the local copy. Now that a live session counts as being
    // signed in (it's what survives a reload), leaving the cookie behind would quietly sign you back
    // in on the next load — and worse, it would still authorise edits from this browser.
    void fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    try {
      localStorage.removeItem(KEY);
    } catch {}
    // The page's own data goes with the sign-out, so the next person here doesn't see the previous
    // owner's tasks and rounds. Other wallets' login proofs are NOT touched.
    clearPageData();
  }, [cancelPending]);

  // Delete the page for real: the DB row goes first, and only a confirmed delete clears the local
  // copy. The old version fired the request in the background and wiped localStorage immediately —
  // the caller then navigated away, killing the in-flight fetch, so the page vanished from this
  // browser while still living on the server (public /@handle kept working, and signing in again
  // restored it from the DB, which read as "Delete doesn't work").
  const reset = useCallback(async (): Promise<SaveResult> => {
    cancelPending(); // never let a queued edit republish the page we're about to delete
    // Prefer the live React state; fall back to storage. Reading ONLY storage meant a corrupt or
    // missing crown-profile made delete report success without ever touching the DB — the page stayed
    // online while the UI said it was gone.
    let handle: string | null = profile?.handle ?? null;
    if (!handle) {
      try {
        const raw = localStorage.getItem(KEY);
        handle = raw ? (JSON.parse(raw) as Profile).handle : null;
      } catch {}
    }
    // Nothing on the server to remove (never published) — just clear this device.
    if (!handle) {
      setProfile(null);
      setHasSession(false);
      void fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
      try {
        localStorage.removeItem(KEY);
      } catch {}
      clearPageData();
      return { ok: true, signed: false };
    }

    const headers: Record<string, string> = {};
    let signed = false;
    if (wallet.connected && wallet.address) {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await wallet.signMessage(await buildAuthMessage("delete", handle, ts, null));
      if (sig) {
        headers["x-crown-pubkey"] = wallet.address;
        headers["x-crown-ts"] = String(ts);
        headers["x-crown-signature"] = Buffer.from(sig).toString("base64");
        signed = true;
      }
    }
    // The server refuses an unsigned delete of an owned page; don't pretend it worked.
    if (!signed) return { ok: false, reason: "unsigned" };

    let res: Response;
    try {
      res = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, { method: "DELETE", headers });
    } catch {
      return { ok: false, reason: "network" };
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "unsigned" };
      return { ok: false, reason: "network" };
    }

    setProfile(null);
    // The account no longer exists — a session still authorising writes for it must go with it.
    setHasSession(false);
    void fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    try {
      localStorage.removeItem(KEY);
    } catch {}
    // The page is gone, so its leftovers go too — otherwise old tasks, an old roulette round and stale
    // donations resurface inside a NEWLY created page.
    clearPageData();
    return { ok: true, signed: true };
  }, [wallet, cancelPending, profile]);

  const value = useMemo<ProfileCtx>(
    () => ({ ready, profile, registered: !!profile, hasSession, sessionChecked, save, saveDeferred, hydrate, signOut, reset }),
    [ready, profile, hasSession, sessionChecked, save, saveDeferred, hydrate, signOut, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfile() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
