# Cheer App

The Cheer frontend and centralized layer: site, creator cabinet, campaigns, mini-games, OBS overlays.

**Outside the trusted perimeter — no money, no keys.** This app only reads the open ledger of [Cheer-Core](https://github.com/Cheer-protocol/Cheer-Core) and renders it. Settlement happens on-chain, past this code.

## What this is

Creator donations with no middleman between the donor's wallet and the recipient. The payment goes into an immutable splitter on Solana, the donation lands in a reputation ledger on ICP, and Cheer App shows it to the viewer and the streamer — profile, goals, OBS overlay.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript |
| Solana | `@solana/web3.js`, `@solana/spl-token`, base58 |
| ICP | `@dfinity/agent`, `@dfinity/candid` |
| Storage | SQLite via `@libsql/client` |
| Signatures | `tweetnacl` (ed25519) |

## Running

```bash
npm install
npm run dev          # http://localhost:3000
```

Checks:

```bash
npm run verify:chain   # network and addresses
npm run verify:db      # database schema and invariants
```

The Telegram bot runs as a separate process:

```bash
npm run bot            # reads bot/.env
```

## Layout

```
app/
  [handle]/     public creator profile
  space/        cabinet: goals, campaigns, page builder
  games/        mini-games
  overlay/      OBS overlays
  discover/     creator directory
  admin/        admin panel
  api/          donations, feed, reputation, profiles, telegram, indexer
lib/server/     database, indexer, auth, rate limiting
scripts/        verify-chain, verify-db
```

## Database

SQLite at `data/cheer.db`. The `donations` table is written **only by the indexer** — never by hand, or it will drift from the chain.

## The project

| Repository | Role |
|---|---|
| [Cheer-Core](https://github.com/Cheer-protocol/Cheer-Core) | splitter (Solana) + reputation ledger (ICP) |
| [Cheer-Factory](https://github.com/Cheer-protocol/Cheer-Factory) | two-outcome escrow, donor attribution via PDA |
| [Conditional-Tasks](https://github.com/Cheer-protocol/Conditional-Tasks) | game: conditional tasks |
| [Conditional-Funding](https://github.com/Cheer-protocol/Conditional-Funding) | game: crowdfunding |
| [Auction](https://github.com/Cheer-protocol/Auction) | game: auction |
| [Subscription](https://github.com/Cheer-protocol/Subscription) | game: prepaid streams |
| **Cheer-App** | frontend and centralized layer |

Frontend details live in [docs/front.md](docs/front.md). Read it alongside the core and factory docs.
