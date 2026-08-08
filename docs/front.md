# Cheer Front

**v0.1 · The site and only the site · No money, no keys**

The front end is outside the trusted perimeter (`cheer-core/docs/project-map.md` §3): it can lie, so it cannot be trusted with anything. All money moves via transactions from the user's wallet; all reputation is read from the canister. The front end is glass between the person and the contracts.

Parts: [I. Specification](#i-specification) · [II. Design](#ii-design) · [III. Build Plan](#iii-build-plan) · [IV. Post-front](#iv-post-front)

---

# I. Specification

## 1. Surfaces

Ten routes. Each has one job. A new surface only appears via an explicit owner decision (like the `/games` catalog) or Part IV.

| Route | Job | Register |
|---|---|---|
| `/` | first screen — a bare search bar (like 1inch); scroll down — a landing page for streamers + a mini-games teaser | strict |
| `/@handle` | streamer page: hero, donation form, feed, viewer reputation | mixed |
| `/@handle/<slug>` | campaign: fundraiser / game / donation request. One screen, reached via a link | mixed |
| `/space` | cabinet: viewer + streamer, sidebar | strict |
| `/create` | page-creation wizard, 4 steps, no sidebar | strict |
| `/games` | platform mini-games catalog: a showcase — what exists and what's coming. You play a game on the page of the streamer who enabled it | strict |
| `/discover` | streamer directory: search, sort (all-time/7 days), platform filters, a card grid with a mini-chart and top-donor per streamer. Reached via "Find a streamer" in the top nav — not a default landing surface | mixed |
| `/overlay/<handle>/<widget>` | bare pages for OBS: alerts, goal, top donors | viewer-facing |
| 404 | "no such streamer, check the link" — anti-phishing, its own style | strict |
| legal | terms, privacy. Written last | strict |

**`/games` is a catalog of game types, not a way to manage them.** A list of everything that exists on the platform (data — `lib/data/games.ts`, `GAMES`); the UI iterates the registry instead of hardcoding games. Managing a specific game for a streamer (enable it, create a round, get the link) lives in the cabinet `/space → Games` (§6) and on the campaign page `/@handle/<slug>` (§5). No game is built yet — all are "Soon" (an honest disabled state, not a fake placeholder).

**`/discover` is a v2 rebuild of a pre-charter "realm directory" concept.** The old version used per-user accent colors and "cheered"/"the cheer" wording — both retired (§7 Glossary: one purple accent only, no gold). The rebuild keeps the shape (search, sort, platform filters, sparkline, top donor) but renames the copy ("received", "top donor") and drops per-card color. Data comes from `MOCK_REALMS`/`MOCK_STREAMERS` (`lib/data/mock.ts`) — no new backend surface.

**The `/` landing page speaks to one person — the streamer.** Viewers don't visit the homepage; they arrive via a direct link. The landing page's pillars: money arrives straight in your wallet (payouts don't exist) · 3% and that's it · you don't need to trust us — it's all open, verify it · create a page in a minute.

## 2. Data layer

Mode is a property of the **data type**, not the app. `DataProvider` serves each type from its own source:

| Data | Source | Mode |
|---|---|---|
| donation, escrow | contracts, via a transaction from the user's wallet | `chain` |
| reputation | cheer-index canister, query | `icp` |
| donation feed | `Settled` events via RPC | `chain` |
| profiles, handle→address, tiers, campaigns, donation messages and names | nowhere to store them yet | `mock` → `api` |

Migration rule: `mock` switches to `api` **per data type**; the provider's interface doesn't move. Components don't know where the data came from.

**A donation message doesn't live on the blockchain.** `Splitter.donate(streamer, gross)` doesn't take text; it's absent from `Settled`. The message, the viewer's name, and the campaign config are off-chain, tied to the transaction hash. That's exactly the spec for `cheer-app/api`: one small database — messages, names, campaigns. Until it exists, all of this lives in `mock`; a donation with no message works with no server at all.

## 3. Money: what the front end must and must not do

Must:

1. Call the splitter and the factory **only via a user transaction**. The donor is `msg.sender`; a wrapper contract would receive the reputation itself (`factory-spec.md` §3).
2. Show the exact amount before confirmation. USDC and only USDC.
3. Present the two-step flow (`approve` + `donate`) externally as one action: `donateWithPermit` where the wallet supports it; a progress indicator where it doesn't.

Forbidden — not "for now," but by design:

| | Why |
|---|---|
| storing keys, signing on the user's behalf | the front end is outside the trusted perimeter |
| holding/proxying money, its own balance | no platform balance exists. The word "balance" is banned from the UI |
| computing reputation | the canister computes it; the front end only reads |
| deciding an escrow outcome | that's the resolver's job. The front end only relays the signature to `claim` |
| verifying an escrow's "authenticity" | that's core arithmetic, not UI |

## 4. Donation: a state machine

From the outside, a viewer sees three states. Internally there are more, but each internal one must map to one of the external ones — there are no new external states.

```
FILLING OUT              SENDING                     DONE
amount (presets 1/5/10/custom)  one smooth animation      +reputation,
name, message             no crypto jargon            donation in the feed
"Donate $5" button
   │
   ├─ no wallet     → "Connect wallet"    (button changes, same screen)
   ├─ wrong network → "Switch network"    (one button, wallet handles it)
   ├─ low on USDC   → "Short $3"          (button disabled, reason in words)
   └─ no allowance  → internal approve step, viewer sees progress, not the term
```

Errors — in plain language, no codes or jargon: `approve`, `allowance`, `gas`, `pending`, "transaction" — words that don't appear in the UI. Canceling in the wallet isn't an error: quietly return to "filling out."

**Escrow donation (a task)** — the same form plus a lifecycle. Exactly four terminal statuses, matching the contract one-to-one, no fifth:

```
IN ESCROW ──outcome 0──► PAID OUT   (+reputation)
   │  ──────outcome 1──► CANCELED
   └──after DEADLINE────► REFUNDED  (anyone can press "refund")
```

`deadline` is always shown in the UI as "money returns no later than …" — that's the contract's promise, the only thing the front end is entitled to promise.

## 5. Campaigns

A campaign is a streamer's payment link. It doesn't exist for the contracts: money flows through the same splitter to the same wallet, reputation accrues the same way. A campaign is an off-chain wrapper (type, copy, goal, status) on top of the same donation form.

- v1 types: **fundraiser** (goal + progress), **game** (class A), **request** (text + form). Type determines the screen's center; everything else is shared.
- URL `/@handle/<slug>` — the streamer's handle is visible in the link, that's anti-phishing.
- Screen: avatar + name (small, for trust) → title → type-specific center → form. No site navigation.
- Lifecycle: active → completed. A completed page isn't a 404: it shows the outcome, the form is disabled.

**Class A games** (`project-map.md` §7) live here: a game = a campaign type + front-end rules + an overlay. Zero contracts. Class B games add the escrow form from §4 and a resolver — a keyed service that signs the outcome; the front end only knows its URL.

## 6. Cabinet

Sidebar — flat items. A nested submenu is a sign of an overloaded section; it's forbidden — the one exception is the Games group, where each game may expand into its own tabs.

```
Home         donation chart, total for the period, recent donations
Donations    full feed: who, how much, message
Games        per-game: build/configure, link, active/completed
Widgets      OBS overlays: alerts, goal, top donors
Settings     profile, socials, wallet
```

No `Viewers` section — not part of this product. A viewer's reputation and tier already show on the streamer's own public page (§4); the cabinet doesn't need a second, platform-side view of it.

Top bar: logo · avatar + name · "My page" (opens the public page, through a viewer's eyes). **There's no balance in the top bar and there won't be** — nothing to show, the money is the streamer's.

**The form builder lives inside a game — currently "Task for donation"** (pulled forward from IV's deferred "page and widget customization" — live streamer requests arrived earlier than expected). It's the streamer's tool for that game: build the form viewers fill in, then share the link + QR (both sit above the editor); viewers open a separate page and act there — the builder never takes money. Two inner tabs: **My page** (avatar/description on-off toggles, an ordered list of widgets — donate form, social icons — each with its own on-off toggle and reorder) and **Design** (a gallery of ready-made **themes** for one-click looks, plus manual background: color / gradient / image). No accent-color theme picker — the donate button and every interactive element stay Cheer purple everywhere, per §II.1's one-accent rule; themes differ by backdrop only. A live preview with a **Phone/Desktop** toggle sits beside the editor so the streamer checks both before sharing.

`/create` wizard: profile (name + `@handle`, link preview) → socials (official domains only, ≤5) → wallet → tiers. One mandatory step — wallet; default is "use the connected wallet," manual entry is a secondary option with a warning: money will go straight there and only there. Tiers are skippable (default $10/100/1000). Minimum to get your own page: name + wallet, under a minute.

Socials go through normalization: a link is only accepted from a platform's official domain. Phishing disguised as YouTube isn't saved — validation happens on input, not on display.

## 7. Glossary

The old terminology (Realm, Reign, Cheering, "to cheer") is retired. "Tiers" is adopted and stays. Until a full brand vocabulary exists:

- in the UI — plain words: streamer page, donation, reputation, tiers, campaign;
- in code — neutral names: `StreamerPage`, `Reputation`, `DonateForm`, `Campaign`. Brand words, once they exist, get swapped in via a string dictionary, not a refactor;
- easter eggs — in game and section names (candidate: "Messages from the Stars" for alerts), never in buttons and hints.

---

# II. Design

**One color · Dark theme · Clear to anyone**

References: Solana, Phantom, Aave, Rabby — crypto that's "just fun." Anti-references: Monero, cryptopunks, trading terminals.

## 1. Palette

Four roles. No fifth. More than three shades on a page is a defect.

| Role | Value | Where |
|---|---|---|
| background | `#141318`, surfaces one step lighter (`#1B1A21`, `#232230`, `#2E2D39`) | everywhere |
| text | near-white `#F1EFF7` → `#A6A2B4` → `#8B8798`; amounts large, `tabular-nums` | everywhere |
| accent | purple — flat `#C0B7FA`, or the accent **gradient** on filled surfaces (below) | **only** actions and brand |
| error | muted red `#E5726B` | only for something broken |

### Accent gradient

The accent isn't one flat purple — filled accent surfaces are painted with a vertical gradient (top purple → bottom near-white), so the accent reads as this gradient rather than a slab of color. The flat token is the gradient's *midpoint*, used for small tints where a gradient would be noise.

| Token | Value | Where |
|---|---|---|
| `--accent` (flat) | `#C0B7FA` (midpoint of `#8B7CF6`→`#F4F2FE`) | chips, dots, borders, links, active states, small tints |
| `--accent-hover` / `--accent-down` | `#CFC7FC` / `#B0A5F9` | flat-accent hover / press |
| `--accent-soft` | `rgba(192,183,250,.16)` | focus rings, faint tinted backdrops |
| `--accent-grad` | `linear-gradient(180deg, #8B7CF6 0%, #F4F2FE 100%)` | primary buttons, the fundraiser **cheer fill** (`CheerFill`) |
| `--accent-grad-hover` / `--accent-grad-down` | `…#CFC7FC→#FFF` / `…#B0A5F9→#EBE7FB` | button hover / press |
| `--accent-grad-ink` | `#0F0E14` | text/icons on any accent-gradient surface |
| `--chart-grad` | `linear-gradient(180deg, #8B7CF6 0%, #ffffff 100%)` | chart bars/line (runs to pure white) |

SVG can't take a CSS `linear-gradient()` as a `fill`, so components that fill with the accent (e.g. `CheerFill`) declare a matching `<linearGradient>` `#8B7CF6→#F4F2FE` in `<defs>` and reference it — same stops as `--accent-grad`.

Rules:

- Colors are NOT plentiful. Like Claude and Discord: a neutral interface, a pinpoint accent. On a typical screen there are two or three purple spots — the action button, the active nav item, the logo. Purple backgrounds, hero fills, decoration — forbidden.
- The accent **gradient** stays to ~2–3 filled spots per screen (primary button, chart, one hero figure). Small tints (chips, dots, nav, borders) stay the flat `--accent` so a page never turns into gradient soup.
- **No green numbers.** An amount doesn't need color: size and weight do the job. A reputation gain — in white.
- Statuses communicate via shape (a pill, an icon), not a traffic light.
- Third-party service logos (YouTube, Twitch, Kick, X) are recolored to our neutral. Someone else's red on our page is a hole in the palette.
- The theme is dark. Light mode — maybe later; don't design for it now.

## 2. Minimalism

- No small type, no extra detail, no decoration. One idea and one button per screen.
- Understandable to someone who's never touched a computer. This rule is about **words and step count**, not visuals: no crypto jargon, a two-step flow presented externally as one action, errors in plain language ("Short $2," not "insufficient allowance").
- Hints — at most one short line per section.
- Animations are smooth and sparing: the moment of donating, state transitions. Not ambient flickering.
- Beautiful and pleasant to look at. Beauty here is precise spacing and typography, not special effects.

## 3. Two registers

| Register | Where | How |
|---|---|---|
| strict | anywhere money and control live: the form at the moment of confirmation, escrow, the wizard (wallet step), the cabinet, the landing page | neutrals, one accent on one button. Playing with color here reads as a scam |
| viewer-facing | the streamer page, campaign games, overlays, the mascot | the same rules, but livelier: a donation animation, personality |

The boundary runs within pages: on a streamer's page, the hero is viewer-facing, the donation form is strict.

## 4. Identity

- Mascot: candidate — a cheer-creature (like Anthropic's crab, Discord's Clyde). A simple shape, legible at 16px. Appears in the viewer-facing register, never next to money.
- Easter eggs with love — in game and section names. UI copy stays functional.

---

# III. Build Plan

Every stage ends with something working that can be shown. Don't start the next one until the current one's done-criterion is met. Everything up to F8 needs nothing from the backend dev except the testnet address file.

| # | What | Depends on | Done when |
|---|---|---|---|
| F1 | Design tokens + mockups of four screens: campaign, streamer page, homepage, cabinet | — | mockups approved by the owner |
| F2 | Skeleton: routes from I §1, `DataProvider` split by data type, everything on `mock` | F1 | the site clicks through end-to-end on mocks, including 404 |
| F3 | On-chain donation: network/address config, wallet connection, the form with the state machine from I §4 | F2, **testnet addresses from the backend** (splitter, USDC) | a real USDC donation on Sepolia goes through; every error branch is shown in words |
| F4 | Reading: feed from `Settled`, reputation from the canister | F3, canister address | a donation from F3 shows up in the feed and the reputation number with no reload |
| F5 | Campaigns on mock + the first class-A game | F2 (money — F3) | a streamer creates a campaign in the cabinet, the link opens, a donation through it works |
| F6 | `/create` wizard + cabinet (6 sections) | F2 | a new streamer: connects a wallet → creates a page → gets a link, under a minute |
| F7 | OBS overlays: alerts, goal, top donors | F4 | the OBS overlay shows a donation seconds after the transaction |
| F8 | Escrow donations: creation form, statuses, `claim`/`refund` | F3, **factory on testnet + resolver** | a full cycle on Sepolia: create → verdict → payout; plus the refund branch |

The F3↔F5 order can swap if testnet addresses take a while: campaigns and the game live entirely on mock either way.

**What to ask the backend for, one artifact:** a testnet address file — splitter, USDC, canister (for F3–F4); later the factory (for F8). The front end stands up its own resolver for development (a keyed service that signs `keccak(chainid, escrow, outcome)`); the production one is the backend's territory.

**What's accumulating for `cheer-app/api`** (blocks nothing before public launch): donation messages and names (tied to the transaction hash), campaign configs, a `handle → address` index for search. One database, one small service. Until then — `mock`.

---

# IV. Post-front

Everything the front end **doesn't** have, and why. Every line is a deliberately deferred piece with a known place to plug in.

Same rule as in the core: **while a line is here, there's no component, hook, or config field for it in the code.** "Prepare a place for it" is a forbidden speculative generality.

Built it — delete the line.

## Deferred surfaces

| What | Why not now | Trigger |
|---|---|---|
| `/u/<address>` — a public viewer page | not part of the "donation → reputation" loop | once viewers start sharing profiles |
| `/ops`, `/admin` — moderation, metrics | no backend, no users, nothing to moderate | alongside `cheer-app/api` and moderation |
| light theme | the product is honestly dark; the audience lives in OBS/Discord | after launch, on complaints |
| short redirect links for campaigns | `/@handle/<slug>` is enough and it's anti-phishing | if links turn out too long for chat |

## Deferred features

| What | Why not now | Trigger |
|---|---|---|
| streamer live/offline status | polling the Twitch/YouTube API — a separate service | alongside `cheer-app/api` |
| onramp: a viewer with no crypto buys USDC by card | a third-party widget, jurisdictional questions | before public launch — the main barrier for viewers |
| Solana path | the core is only deployed to an EVM testnet | backend deploy to devnet |
| ENS/wallet names in the feed | cosmetic layer over addresses | after F4 |
| TTS in alerts | requires messages, i.e. `api` | alongside the message service |
| keeper: who presses `claim` for the winner | anyone can call `claim` — manual/button for now | the first live class-B game |
| notifications (a bell icon) | nothing to deliver yet | after launch |
| new terminology and mascot | an owner decision, not a code one | before public launch |
| donation history export (CSV, taxes) | streamers will want it, but not in v1 | first request |

## Decisions, not code

| What | Fork in the road | When to decide |
|---|---|---|
| where `cheer-app/api` lives | its own service next to Next.js (API routes) vs. a separate repo per the project map | before public launch; doesn't matter at the mock stage |
| launch network | Base / Arbitrum / Optimism — all have Cancun (`TSTORE`) | alongside the backend, before mainnet |
| does the platform pay gas for the viewer | the "you need ETH for gas" UX barrier | alongside onramp |
