import type { Metadata } from "next";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { SiteFooter } from "@/components/SiteFooter";
import { GameIcon } from "@/components/icons";
import { GAMES } from "@/lib/data/games";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Crown works: donations straight to your wallet, reputation that builds with each one, and the mini-games on top. Non-custodial and on-chain.",
};

// The org that hosts the real contracts — kept in step with the footer's "Open & honest" column.
const ORG = "https://github.com/Crown-protocol";

const TOC = [
  { id: "what", label: "What Crown is" },
  { id: "donations", label: "Donations" },
  { id: "reputation", label: "Reputation & tiers" },
  { id: "games", label: "The mini-games" },
  { id: "escrow", label: "Escrow & refunds" },
  { id: "makers", label: "For content makers" },
  { id: "open", label: "Open & honest" },
  { id: "faq", label: "FAQ" },
  { id: "contact", label: "Contact" },
];

export default function DocsPage() {
  return (
    <main className={styles.wrap}>
      <TopNav />

      <div className={styles.main}>
        <header className={styles.head}>
          <h1>How Crown works</h1>
          <p>
            Crown is a donation page in dollars, plus mini-games your viewers run — with the money going straight to your
            wallet. Here&apos;s the whole thing in plain language.
          </p>
        </header>

        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="On this page">
            <div className={styles.tocHead}>On this page</div>
            {TOC.map((t) => (
              <a key={t.id} href={`#${t.id}`}>
                {t.label}
              </a>
            ))}
          </nav>

          <div className={styles.content}>
            <section id="what">
              <h2>What Crown is</h2>
              <p>
                Crown gives a content maker one page where viewers can support them. Every donation is in dollars and
                lands <b>straight in the creator&apos;s own wallet</b> — Crown never touches the money. On top of plain
                donations sit four mini-games that turn a donation into a moment: a paid task, a game roulette, a
                goal to chip in toward, an auction for your time.
              </p>
              <p>
                Two things travel with every dollar: it reaches the creator, and it builds the giver&apos;s{" "}
                <b>reputation</b> with that creator. That&apos;s the whole idea — support that adds up to something.
              </p>
            </section>

            <section id="donations">
              <h2>Donations</h2>
              <p>
                A viewer opens a creator&apos;s page, connects a wallet, and sends an amount. It settles on-chain in{" "}
                <b>USDC</b> (dollar-pegged) on Solana, arriving in the creator&apos;s wallet directly. No middleman
                account holds it on the way.
              </p>
              <p>
                Each dollar is one point of reputation with that creator (<b>$1 = 1 reputation</b>). A donation can be a
                one-off, or the entry to a mini-game — the money moves the same way either time.
              </p>
              <div className={styles.callout}>
                <p>
                  <b>Non-custodial.</b> Crown is glass between you and the contracts. It can&apos;t hold, move, or freeze
                  anyone&apos;s money — every transfer is a transaction from your own wallet.
                </p>
              </div>
            </section>

            <section id="reputation">
              <h2>Reputation &amp; tiers</h2>
              <p>
                Reputation is <b>per creator</b>, never one global number — the points you hold with one creator mean
                nothing on another&apos;s page. It only ever goes up, and only for money that actually reached the
                creator (a refunded contribution earns nothing).
              </p>
              <p>
                Each creator sets their own named <b>tiers</b> — thresholds in dollars donated, with the names and
                colors they choose. As your reputation climbs, you move up their tiers, and it shows on their page and
                yours. Some games can gate who joins by a minimum tier.
              </p>
            </section>

            <section id="games">
              <h2>The mini-games</h2>
              <p>
                A game is a layer on top of a donation — the money and reputation travel the same path, the game just
                sets the moment. A creator enables the ones they want from their space; each has its own page viewers
                open from a link or QR. Here&apos;s every game with its full rules and settings.
              </p>

              {GAMES.map((g) => (
                <div key={g.id} id={g.id} className={styles.gameBlock}>
                  <div className={styles.gameHead}>
                    <span className={styles.gameIcon} aria-hidden>
                      <GameIcon id={g.id} width={22} height={22} />
                    </span>
                    <div>
                      <Link href={`/games/${g.id}`} className={styles.gameName}>
                        {g.title}
                      </Link>
                      <p className={styles.gameTagline}>{g.tagline}</p>
                    </div>
                  </div>

                  {g.playRules && g.playRules.length > 0 && (
                    <>
                      <h3>Rules</h3>
                      <ol className={styles.ruleList}>
                        {g.playRules.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ol>
                    </>
                  )}

                  {g.knobs && g.knobs.length > 0 && (
                    <>
                      <h3>Settings</h3>
                      <dl className={styles.settings}>
                        {g.knobs.map((k) => (
                          <div className={styles.setting} key={k.label}>
                            <dt>
                              {k.label}
                              <span className={styles.settingVal}>{k.value}</span>
                            </dt>
                            <dd>{k.hint}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className={styles.settingsNote}>Values shown are the defaults — a creator changes any of them in their space.</p>
                    </>
                  )}
                </div>
              ))}
            </section>

            <section id="escrow">
              <h2>Escrow &amp; refunds</h2>
              <p>
                Every game that puts a promise on the line runs through <b>escrow</b>. When a viewer pays into a task, a
                fundraiser, or an auction, the money locks in a contract — not in the creator&apos;s pocket, not in
                Crown&apos;s. It only moves when the outcome is settled.
              </p>
              <ul>
                <li>
                  Deliver what you promised — the task, the goal, the winning condition — and the escrow releases to you,
                  and backers earn reputation for exactly what they put in.
                </li>
                <li>
                  Miss the deadline, or don&apos;t deliver, and everyone is <b>refunded automatically</b> — to the cent,
                  even if a goal was fully met. Nobody can ever earn more than they contributed.
                </li>
                <li>
                  For the roulette, a suggestion is a plain donation: it isn&apos;t held or refunded — losing picks stay
                  donated either way.
                </li>
              </ul>
            </section>

            <section id="makers">
              <h2>For content makers</h2>
              <p>
                A page is free — one per wallet. You set your payout wallet, your name and avatar, your tiers, and the
                amount buttons viewers see, then share the link (and QR). It works on phone and desktop; a live preview
                sits beside the editor so you can check both before sharing.
              </p>
              <p>
                Enable a game and you get its own page and overlays for your stream. Everything you set — minimums,
                deadlines, windows — is yours to change any time, and you can turn a game off entirely from your space.
              </p>
              <p>
                <Link href="/create">Create your page →</Link>
              </p>
            </section>

            <section id="open">
              <h2>Open &amp; honest</h2>
              <p>
                The money rules aren&apos;t enforced by us — they&apos;re enforced by the contracts, and the contracts
                are open. The splitter that routes donations and the escrow factory the games use are both public:
              </p>
              <ul>
                <li>
                  <a href={`${ORG}/Crown-Core`} target="_blank" rel="noreferrer">
                    Crown-Core
                  </a>{" "}
                  — the donation splitter and reputation canister.
                </li>
                <li>
                  <a href={`${ORG}/Crown-Factory`} target="_blank" rel="noreferrer">
                    Crown-Factory
                  </a>{" "}
                  — the escrow the mini-games settle through.
                </li>
                <li>
                  <a href={ORG} target="_blank" rel="noreferrer">
                    Everything on GitHub
                  </a>
                  .
                </li>
              </ul>
            </section>

            <section id="faq">
              <h2>FAQ</h2>
              <h3>Does Crown take a cut of my donations?</h3>
              <p>Crown is non-custodial — it never holds your money, so it can&apos;t skim it. Donations settle straight to the creator&apos;s wallet on-chain.</p>
              <h3>Do I need crypto to donate?</h3>
              <p>You donate in USDC — a dollar-pegged stablecoin — from a Solana wallet. A dollar in is a dollar the creator receives.</p>
              <h3>Can I get my money back?</h3>
              <p>If a creator doesn&apos;t deliver a task, fundraiser, or auction you backed, the escrow refunds you automatically. A plain donation and a roulette suggestion are final — they&apos;re gifts.</p>
              <h3>Is my reputation the same everywhere?</h3>
              <p>No — it&apos;s separate for each creator. It reflects what you&apos;ve given to that one person.</p>
              <h3>Who confirms a delivery?</h3>
              <p>For the fundraiser and auction, a creator&apos;s own reputation holders confirm whether they delivered — no confirmation, or a miss, means everyone is refunded.</p>
            </section>

            <section id="contact">
              <h2>Contact</h2>
              <p>
                Questions, a bug, or a partnership? Find us on{" "}
                <a href="https://x.com/Crownprotocol2" target="_blank" rel="noreferrer">
                  X
                </a>{" "}
                and{" "}
                <a href="https://t.me/+LBrKLgrPuY9kYjI6" target="_blank" rel="noreferrer">
                  Telegram
                </a>
                , or email{" "}
                <a href="mailto:crowndonate@proton.me">crowndonate@proton.me</a>.
              </p>
            </section>

            <p className={styles.note}>
              This is a plain-language guide to how Crown works today. The exact rules are the ones the contracts
              enforce — read them above.
            </p>
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
