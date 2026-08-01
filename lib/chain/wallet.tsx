"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { connection } from "./solana";
import { isWalletConnectEnabled } from "./appkit";

// The WalletConnect bridge pulls in the heavy AppKit stack (~1.6MB). Load it lazily and client-only so
// that bundle is a separate async chunk fetched ONLY when the bridge actually mounts (WC configured),
// never on the critical path of every page — static-importing it stalled hydration/UI after connect.
const WalletConnectBridge = dynamic(() => import("@/components/WalletConnectBridge"), { ssr: false });

// ──────────────────────────────────────────────────────────────────
// Solana wallet layer: talks to the injected Phantom / Solflare providers
// directly. No wallet-adapter UI stack — our picker (WalletButton) is
// custom, and two first-class wallets cover the Solana userbase the
// backend targets. The provider object shape both wallets share:
//   connect() → { publicKey }, disconnect(), signTransaction(tx),
//   signAndSendTransaction(tx) → { signature }, on("disconnect"|"accountChanged")
// ──────────────────────────────────────────────────────────────────

export type WalletName = "phantom" | "solflare" | "walletconnect";

// What the WalletConnect bridge (a lazily-loaded component using AppKit's hooks) hands up to the
// provider, so the shared WalletCtx methods can route address/sign/send through the WC session when
// it's the active wallet — without the rest of the app knowing WalletConnect exists. Exported so the
// bridge component (components/WalletConnectBridge) can type its props against it.
// The provider type is AppKit's Solana `Provider`; kept as `unknown` here so this module needn't
// import the heavy AppKit types — the bridge passes the real provider through and the two send/sign
// call sites below narrow it to what they use.
export interface WcBridgeState {
  address: string | null;
  connecting: boolean;
  provider: WcSigner | null;
  disconnect: () => Promise<void>;
}

// The slice of AppKit's Solana provider the wallet layer actually calls. Declaring it locally keeps
// the heavy @reown types off this hot module while staying type-safe at the call sites.
interface WcSigner {
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signAndSendTransaction: (tx: Transaction) => Promise<string>;
}

interface InjectedProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } } | void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
  signMessage?: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  off?: (event: string, cb: (...args: unknown[]) => void) => void;
}

function getInjected(name: WalletName): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: InjectedProvider }; solana?: InjectedProvider; solflare?: InjectedProvider };
  if (name === "phantom") {
    const p = w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
    return p ?? null;
  }
  // Solflare exposes window.solflare; some builds also mark window.solana with isSolflare.
  return w.solflare ?? (w.solana?.isSolflare ? w.solana : null) ?? null;
}

// True right now, checked against the live window (not the async probe) — call this at click time so
// a wallet that injected late is never mistaken for "not installed".
export function walletInstalled(name: WalletName): boolean {
  return !!getInjected(name);
}

// A phone browser: mobile wallets don't inject a provider into an ordinary mobile browser, so
// "installed?" is always false there — the app must deep-link into the wallet's in-app browser
// instead of offering a desktop-extension install page.
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// The universal link that opens THIS page inside the wallet's built-in browser, where the provider
// is injected and connecting works. Used on phones in place of the install page.
export function walletBrowseLink(name: WalletName): string {
  const url = typeof window !== "undefined" ? window.location.href : "";
  const ref = typeof window !== "undefined" ? window.location.origin : "";
  if (name === "phantom") return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
}

interface WalletCtx {
  address: string | null; // base58
  connected: boolean;
  connecting: boolean;
  walletName: WalletName | null;
  detected: WalletName[]; // which injected wallets exist in this browser
  connect: (name: WalletName) => Promise<void>;
  disconnect: () => Promise<void>;
  // Signs with the connected wallet and sends to devnet; returns the signature.
  sendTransaction: (tx: Transaction) => Promise<string>;
  // Signs an arbitrary message (auth for mutating APIs); null when no wallet
  // is connected or the wallet can't sign messages.
  signMessage: (msg: Uint8Array) => Promise<Uint8Array | null>;
}

const Ctx = createContext<WalletCtx | null>(null);

// Which wallet the user last connected with, so the silent auto-reconnect tries that one first.
const LAST_WALLET_KEY = "crown-last-wallet";

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<WalletName | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [detected, setDetected] = useState<WalletName[]>([]);
  // Mirrors `address` for the mount-only auto-reconnect effect, whose closure would otherwise capture
  // the initial null forever and never see a manual connect that happened while it was retrying.
  const addressRef = useRef<string | null>(null);
  useEffect(() => { addressRef.current = address; }, [address]);

  // WalletConnect (AppKit) lives in an inner bridge component (WalletConnectBridge) because its hooks
  // must run inside React and only when AppKit was initialised. The bridge writes its live state here,
  // and an `openModal` fn, so the shared methods below can route to WC when it's the active wallet.
  const wcRef = useRef<WcBridgeState>({ address: null, connecting: false, provider: null, disconnect: async () => {} });
  const wcOpenRef = useRef<(() => Promise<void>) | null>(null);
  // Bumps to re-render when the WC bridge reports a change (address/connecting), so `value` recomputes.
  const [wcNonce, setWcNonce] = useState(0);
  // The WC bridge calls AppKit hooks, which require createAppKit to have run and must not execute
  // during SSR — so mount it only after the first client render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const wcEnabled = isWalletConnectEnabled();

  // Reflect the WalletConnect session into the top-level wallet state: when a WC session becomes
  // active it IS the connected wallet; when it drops (and it was the active one) we sign out. Injected
  // connects set walletName directly, so only take over when WC is actually the live wallet.
  const applyWcState = useCallback((s: WcBridgeState) => {
    wcRef.current = s;
    setWcNonce((n) => n + 1);
    setWalletName((prevName) => {
      if (s.address) {
        // WC connected → become the active wallet (unless an injected one is already live).
        setAddress((prevAddr) => (prevName === "walletconnect" || !prevName ? s.address : prevAddr));
        return prevName === "walletconnect" || !prevName ? "walletconnect" : prevName;
      }
      // WC disconnected → only clear if WC was the active wallet.
      if (prevName === "walletconnect") {
        setAddress(null);
        try { localStorage.removeItem(LAST_WALLET_KEY); } catch {}
        return null;
      }
      return prevName;
    });
  }, []);

  // Injection is async (extensions land after hydration, sometimes seconds late) — probe repeatedly,
  // and re-probe whenever the tab regains focus, so a wallet installed WHILE the site is open (user
  // installs the extension, comes back to the tab) is picked up without a manual reload.
  useEffect(() => {
    const probe = () => {
      const found: WalletName[] = [];
      if (getInjected("phantom")) found.push("phantom");
      if (getInjected("solflare")) found.push("solflare");
      setDetected((prev) => (prev.length === found.length && prev.every((p) => found.includes(p)) ? prev : found));
    };
    probe();
    // A longer window (≈6s) than one burst — some wallets inject well after load.
    const timers = [300, 700, 1200, 2000, 3500, 6000].map((ms) => setTimeout(probe, ms));
    window.addEventListener("focus", probe);
    document.addEventListener("visibilitychange", probe);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("focus", probe);
      document.removeEventListener("visibilitychange", probe);
    };
  }, []);

  // Silent auto-reconnect on load — ONLY for the wallet the user actually signed in with before, and
  // only on pages where being signed in matters. Two hard rules learned the hard way:
  //   • Never probe a wallet the user hasn't connected here. Asking an unrelated installed extension
  //     makes a LOCKED wallet throw its "Unlock your wallet" password prompt at someone who merely
  //     opened the homepage.
  //   • Never probe on public pages (landing, /@handle, /games…). A visitor reading the site must not
  //     have a wallet pop at them; the connect button is how you opt in.
  // With a remembered wallet on a cabinet route, connect({onlyIfTrusted:true}) returns the address
  // with no popup when the wallet is unlocked and trusts us, and quietly fails otherwise.
  useEffect(() => {
    let cancelled = false;

    let last: WalletName | null = null;
    try {
      const v = localStorage.getItem(LAST_WALLET_KEY);
      if (v === "phantom" || v === "solflare") last = v;
    } catch {}
    if (!last) return; // never connected here — stay quiet

    // Only the signed-in surfaces need a restored session. Everything else is public.
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const needsSession = path === "/space" || path.startsWith("/space/") || path === "/create" || path === "/me";
    if (!needsSession) return;

    const tryOne = async (name: WalletName): Promise<boolean> => {
      const p = getInjected(name);
      if (!p) return false;
      try {
        const res = await p.connect({ onlyIfTrusted: true });
        const resPk = res && typeof res === "object" && "publicKey" in res ? (res as { publicKey?: { toString(): string } }).publicKey : undefined;
        const pk = resPk ?? p.publicKey ?? null;
        // A manual connect may have landed while this trusted probe was in flight — never overwrite it.
        if (!pk || cancelled || addressRef.current) return false;
        setAddress(new PublicKey(pk.toString()).toBase58());
        setWalletName(name);
        return true;
      } catch {
        return false; // locked, not trusted, or never connected here — stay signed out, no popup
      }
    };

    void (async () => {
      // Injection can be a beat late; give it a couple of retries before giving up.
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        if (cancelled || addressRef.current) return;
        if (await tryOne(last)) return;
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount — a manual connect/disconnect updates state directly, not through this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A wallet-side disconnect or account switch must reflect in the UI, not
  // leave a stale address that then signs for the wrong person.
  useEffect(() => {
    if (!walletName) return;
    const p = getInjected(walletName);
    if (!p?.on) return;
    const onDisconnect = () => {
      setAddress(null);
      setWalletName(null);
    };
    const onAccountChanged = (...args: unknown[]) => {
      const pk = args[0] as { toString(): string } | null | undefined;
      setAddress(pk ? new PublicKey(pk.toString()).toBase58() : null);
    };
    p.on("disconnect", onDisconnect);
    p.on("accountChanged", onAccountChanged);
    return () => {
      p.off?.("disconnect", onDisconnect);
      p.off?.("accountChanged", onAccountChanged);
    };
  }, [walletName]);

  const connect = useCallback(async (name: WalletName) => {
    // WalletConnect: hand off to AppKit's QR modal. The bridge picks up the resulting session and
    // promotes it to the active wallet via applyWcState — there's no address to await here.
    if (name === "walletconnect") {
      if (!wcOpenRef.current) throw new Error("WalletConnect isn't set up — add a Reown project id.");
      setWalletName("walletconnect");
      await wcOpenRef.current();
      return;
    }
    const p = getInjected(name);
    if (!p) throw new Error(name === "phantom" ? "Phantom is not installed." : "Solflare is not installed.");
    setConnecting(true);
    try {
      const res = await p.connect();
      // The key can come back three ways: on the connect() result, on the provider object, or (Solflare
      // sometimes) set a beat AFTER connect() resolves. Read it, and if it's not there yet, poll the
      // provider briefly before giving up — otherwise a working wallet reads as "nothing happened".
      // NB: Solflare resolves connect() to `true` (a boolean, not an object) and puts the key on the
      // provider — so guard the `in` check with typeof, or it throws "right-hand side of 'in'…".
      const resPk = res && typeof res === "object" && "publicKey" in res ? (res as { publicKey?: { toString(): string } }).publicKey : undefined;
      let pk = resPk ?? p.publicKey ?? null;
      for (let i = 0; !pk && i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        pk = getInjected(name)?.publicKey ?? null;
      }
      if (!pk) throw new Error("The wallet connected but didn't return an address. Try again, or reopen the wallet extension.");
      setAddress(new PublicKey(pk.toString()).toBase58());
      setWalletName(name);
      // Remember the choice so the next page load can silently reconnect to the same wallet.
      try {
        localStorage.setItem(LAST_WALLET_KEY, name);
      } catch {}
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (walletName === "walletconnect") {
      try { await wcRef.current.disconnect(); } catch {}
      // The bridge's applyWcState will clear address/walletName once the session drops; do it eagerly
      // too so the UI signs out immediately.
      setAddress(null);
      setWalletName(null);
    } else if (walletName) {
      try {
        await getInjected(walletName)?.disconnect();
      } catch {}
      setAddress(null);
      setWalletName(null);
    }
    // Forget the remembered wallet so a reload doesn't silently sign you back in after a Log out.
    try {
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch {}
  }, [walletName]);

  const sendTransaction = useCallback(
    async (tx: Transaction) => {
      if (!walletName || !address) throw new Error("Connect your wallet first.");
      const conn = connection();
      tx.feePayer = new PublicKey(address);
      tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
      // WalletConnect: sign+send through the AppKit provider (it broadcasts on its own connection).
      if (walletName === "walletconnect") {
        const wp = wcRef.current.provider;
        if (!wp) throw new Error("Wallet not available.");
        const signature = await wp.signAndSendTransaction(tx);
        await conn.confirmTransaction(signature, "confirmed");
        return signature;
      }
      const p = getInjected(walletName);
      if (!p) throw new Error("Wallet not available.");
      // Prefer the wallet's own send (it simulates + picks its RPC), fall back to sign+send.
      if (p.signAndSendTransaction) {
        const { signature } = await p.signAndSendTransaction(tx);
        await conn.confirmTransaction(signature, "confirmed");
        return signature;
      }
      const signed = await p.signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize());
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [walletName, address]
  );

  const signMessage = useCallback(
    async (msg: Uint8Array): Promise<Uint8Array | null> => {
      if (!walletName || !address) return null;
      // WalletConnect: the AppKit provider returns raw signature bytes.
      if (walletName === "walletconnect") {
        const wp = wcRef.current.provider;
        if (!wp) return null;
        try {
          return await wp.signMessage(msg);
        } catch {
          return null;
        }
      }
      const p = getInjected(walletName);
      if (!p?.signMessage) return null;
      try {
        // Phantom returns {signature}, Solflare historically returned raw bytes.
        const res = await p.signMessage(msg, "utf8");
        return res instanceof Uint8Array ? res : res.signature;
      } catch {
        return null; // user closed the wallet prompt
      }
    },
    [walletName, address]
  );

  // WalletConnect, when configured, is always an offerable option (it's a remote QR session, not a
  // locally-installed extension) — surface it in `detected` so the modal can present it as ready.
  const detectedWithWc = useMemo<WalletName[]>(
    () => (wcEnabled ? [...detected, "walletconnect"] : detected),
    [detected, wcEnabled]
  );

  const value = useMemo<WalletCtx>(
    () => ({
      address,
      connected: !!address,
      connecting: connecting || wcRef.current.connecting,
      walletName,
      detected: detectedWithWc,
      connect,
      disconnect,
      sendTransaction,
      signMessage,
    }),
    // wcNonce is intentionally a dep: the memo reads wcRef.current.connecting (a ref, not reactive),
    // so bumping wcNonce is what recomputes `value` when the WC bridge reports a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, connecting, wcNonce, walletName, detectedWithWc, connect, disconnect, sendTransaction, signMessage]
  );

  return (
    <Ctx.Provider value={value}>
      {wcEnabled && mounted && (
        <WalletConnectBridge
          onState={applyWcState}
          registerOpen={(fn) => {
            wcOpenRef.current = fn;
          }}
        />
      )}
      {children}
    </Ctx.Provider>
  );
}

export function useSolanaWallet(): WalletCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSolanaWallet must be used inside SolanaWalletProvider");
  return ctx;
}
