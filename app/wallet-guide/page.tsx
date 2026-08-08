import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { SiteFooter } from "@/components/SiteFooter";
import { PhantomIcon, SolflareIcon } from "@/components/WalletIcons";
import styles from "./page.module.css";

export const metadata = { title: "How to get a wallet · Cheer" };

// First-party, plain-language guide the wallet modal's "?" links to: what a wallet is, how to make
// one, how to fund it, and how to connect it to Cheer. Solana-only, devnet for now.
export default function WalletGuidePage() {
  return (
    <main className={styles.wrap}>
      <TopNav />
      <article className={styles.article}>
        <h1 className={styles.title}>How to get a wallet</h1>
        <p className={styles.lead}>
          A wallet is how you sign in and pay on Cheer — no account, no password. You set it up once, and it&apos;s yours
          across every Solana app. Here&apos;s the whole thing, start to finish.
        </p>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.num}>1</span>
            <div className={styles.body}>
              <h2>Install a wallet</h2>
              <p>Pick one and add the browser extension (they have phone apps too). Both are free and work with Cheer.</p>
              <div className={styles.walletRow}>
                <a className={styles.walletCard} href="https://phantom.app/download" target="_blank" rel="noreferrer">
                  <PhantomIcon size={30} />
                  <span>Phantom</span>
                </a>
                <a className={styles.walletCard} href="https://solflare.com/download" target="_blank" rel="noreferrer">
                  <SolflareIcon size={30} />
                  <span>Solflare</span>
                </a>
              </div>
            </div>
          </li>

          <li className={styles.step}>
            <span className={styles.num}>2</span>
            <div className={styles.body}>
              <h2>Create your wallet</h2>
              <p>
                Open the extension and choose <b>Create a new wallet</b>. It shows you a recovery phrase — 12 words. Write
                them down and keep them somewhere safe and offline.
              </p>
              <div className={styles.warn}>
                Never share your recovery phrase. Anyone who has it controls your money — Cheer will never ask for it.
              </div>
            </div>
          </li>

          <li className={styles.step}>
            <span className={styles.num}>3</span>
            <div className={styles.body}>
              <h2>Add some funds</h2>
              <p>Two things live in a wallet:</p>
              <ul className={styles.bullets}>
                <li>
                  <b>SOL</b> — pays the tiny network fee for each transaction.
                </li>
                <li>
                  <b>USDC</b> — the dollars you actually donate.
                </li>
              </ul>
              <p>
                Buy them right inside Phantom or Solflare (both have a <b>Buy</b> button), or send them to your wallet
                address from an exchange.
              </p>
              <div className={styles.note}>
                Cheer runs on Solana <b>devnet</b> for now, so nothing here is real money yet — grab free test SOL from{" "}
                <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                  faucet.solana.com
                </a>{" "}
                and use devnet USDC to try everything out.
              </div>
            </div>
          </li>

          <li className={styles.step}>
            <span className={styles.num}>4</span>
            <div className={styles.body}>
              <h2>Connect to Cheer</h2>
              <p>
                Hit <b>Connect wallet</b> at the top of any donation page, pick your wallet, and approve the connection.
                That&apos;s it — you&apos;re ready to donate.
              </p>
            </div>
          </li>
        </ol>

        <div className={styles.backRow}>
          <Link className={styles.back} href="/discover">
            Find a content maker →
          </Link>
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}
