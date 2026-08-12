// A Solana wallet for a headless browser.
//
// Every money path in this app ends at `window.solana` — connect, sign a
// message, sign a transaction. A browser without an extension can therefore be
// walked up to the confirmation and no further, which is exactly where
// `verify:ui` stops. This shim closes that gap: it puts a real keypair behind
// the same interface Phantom exposes, so an automated run can pay for a task,
// chip into a fundraiser and stake on a wheel with real devnet USDC.
//
// It is a TEST tool and lives in `scripts/` for that reason: it never ships, and
// nothing in the app knows it exists. The app sees a wallet; the wallet happens
// to be a file.
//
// Signing is Ed25519 via WebCrypto (Chromium supports it natively), so no
// bundler, no import map and nothing injected into the page's module graph — the
// shim is one plain script evaluated before the app boots.
//
// One known artefact: the init script runs in EVERY frame, including the
// cabinet's live-preview iframe, and that preview renders its error boundary
// under the shim. The page itself is fine — framed from the same origin without
// the shim it renders the real thing — so a "Something went wrong" inside the
// preview during an automated run is this tool, not the product.
import { readFileSync } from "node:fs";

/** Read a Solana CLI keypair file (64 bytes: 32 secret ‖ 32 public). */
export function readKeypair(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const bytes = Uint8Array.from(raw);
  return { secret: [...bytes.slice(0, 32)], publicRaw: [...bytes.slice(32)] };
}

/**
 * Install the wallet into a Playwright page (call before `goto`).
 *
 * `address` is the base58 the app will see; it is passed in rather than derived
 * here so this file stays free of a base58 implementation.
 */
export async function installWallet(page, { secret, publicRaw, address }) {
  await page.addInitScript(
    ({ secret, publicRaw, address }) => {
      // PKCS#8 wrapper for a raw Ed25519 seed — the only form WebCrypto imports.
      const pkcs8 = new Uint8Array([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
        ...secret,
      ]);
      let keyPromise = null;
      const key = () => {
        keyPromise ??= crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
        return keyPromise;
      };
      const sign = async (bytes) =>
        new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, await key(), bytes));

      // The app reads `publicKey.toString()` and hands it to `new PublicKey(...)`,
      // so a plain object with the right string is all it needs.
      const publicKey = { toString: () => address, toBase58: () => address, toBytes: () => new Uint8Array(publicRaw) };

      const provider = {
        isPhantom: true,
        publicKey,
        isConnected: true,
        connect: async () => ({ publicKey }),
        disconnect: async () => {},
        on: () => {},
        off: () => {},
        signMessage: async (message) => ({ signature: await sign(message), publicKey }),
        // The app serializes and sends this itself, so signing is all that is
        // needed here — and `feePayer` is already the PublicKey instance the
        // transaction wants its signature attributed to.
        // `Uint8Array`, never `Buffer`: the page has no global Buffer (the app
        // imports the polyfill as a module), and reaching for one threw
        // "Buffer is not defined" *inside the signature*, which the app then
        // reported as a failed payment — a shim bug wearing an app bug's clothes.
        signTransaction: async (tx) => {
          tx.addSignature(tx.feePayer, await sign(tx.serializeMessage()));
          return tx;
        },
        signAllTransactions: async (txs) => {
          for (const tx of txs) tx.addSignature(tx.feePayer, await sign(tx.serializeMessage()));
          return txs;
        },
      };
      Object.defineProperty(window, "solana", { value: provider, configurable: true });
      Object.defineProperty(window, "phantom", { value: { solana: provider }, configurable: true });
      // The app remembers the last wallet and reconnects to it on the pages that
      // need one; saying "phantom" here spares every run a manual connect click.
      try {
        localStorage.setItem("cheer-last-wallet", "phantom");
      } catch {}
    },
    { secret, publicRaw, address }
  );
}
