# Cheer App

The Cheer frontend and centralized layer: site, creator cabinet, campaigns, mini-games, OBS overlays.

**Outside the trusted perimeter — no money, no keys.** This app reads the open book, builds the
transactions a donor signs themselves, and renders the result. Settlement happens on chain, past this
code. The one thing it does hold is a relay key that pays for ingests and verdict signatures — a
budget, never custody.

## What this is

Creator donations with no middleman between the donor's wallet and the recipient. The payment goes into an immutable splitter on Solana, the donation lands in a reputation ledger on ICP, and Cheer App shows it to the viewer and the streamer — profile, goals, OBS overlay.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript |
| Solana | `@solana/web3.js`, `@solana/spl-token`, base58 |
| ICP | `@dfinity/agent`, `@dfinity/candid`, `@dfinity/identity` (the relay key, server-side only) |
| Storage | SQLite via `@libsql/client` |
| Signatures | `tweetnacl` (ed25519) |

## Running

```bash
npm install
npm run dev          # http://localhost:3000
```

Checks:

```bash
npm run verify:chain   # constants vs the perimeter's own profiles, derivations, live devnet
npm run verify:games   # signed messages and scope ids vs the canisters' pinned vectors
npm run verify:db      # database schema and invariants (needs the server on :3000)
```

The first two read the sibling clones (`../crown-indexer`, `../crown-factory`, `../crown-games/…`)
and compare this app's copy of every id, floor and message format against the source of truth. Absent
siblings mean SKIPPED checks, not green ones.

## Connecting the backend

Solana is already connected: the splitter and the factory are deployed on devnet and their ids are
the defaults, so donations are real transactions the moment a wallet is attached.

The ICP half has no public principals yet, so it runs on a local replica — one script:

```bash
cd localnet
dfx start --clean --background
./deploy.sh            # prints the env block below, already filled in
```

It deploys the index, the relay, both games and the perimeter's own SOL RPC mock, and changes
nothing in the perimeter repos: every local difference (the replica's root key, this deployment's
index principal, the relay's allowlist) is passed as an init argument those canisters already accept.
`node feed-rpc.mjs <tx-signature>` hands the index a REAL devnet transaction to fold.

Whether local or eventually public, the wiring is the same five variables in `.env.local`:

```bash
NEXT_PUBLIC_IC_HOST=https://icp0.io          # or http://127.0.0.1:4943 for a local dfx replica
NEXT_PUBLIC_CHEER_INDEX_PRINCIPAL=…          # crown-indexer  — the book
NEXT_PUBLIC_RELAY_PRINCIPAL=…                # crown-relay    — pays for ingests and signatures
NEXT_PUBLIC_TASKS_PRINCIPAL=…                # conditional-tasks
NEXT_PUBLIC_FUNDING_PRINCIPAL=…              # conditional-funding
RELAY_IDENTITY_JSON={"…"}                    # the allowlisted key, SERVER-SIDE ONLY
```

Nothing else changes: `gamePrincipals.*` starts answering true, the games' chain paths light up, and
reputation switches from our mirror to the book itself. The admin panel's **Launch readiness** screen
mirrors this list live — every amber row names the variable that turns it green.

A game needs both its own principal AND the index principal: it proves things about the book, so a
game without the book cannot admit a single registration.

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

The perimeter lives in sibling clones under one workspace root — the layout every cross-repo
reference here assumes (`crown-spec/docs/repo-map.md`):

| Repository | Role | In the first release |
|---|---|---|
| `crown-spec` | the law: architecture, standards, cost, build order | — |
| `crown-reduce` | the fold of the book (pure, zero-dep) | yes |
| `crown-splitter` | Solana: the splitter, recognition root #1 | yes |
| `crown-factory` | Solana: the `two-outcome` escrow form + address arithmetic | yes |
| `crown-indexer` | ICP: the paid index — the book itself | yes |
| `crown-relay` | ICP: pays for ingests and signatures on an allowlisted key | yes |
| `crown-games/conditional-tasks` | game: a paid task, one escrow | yes |
| `crown-games/conditional-funding` | game: a collection, N escrows | yes |
| **`crown-app`** | frontend, centralized layer, and the ingest submitter | — |

`crown-games/auction` and `crown-games/subscription` exist in the perimeter and are deliberately not
shipped here — no page, no store, no principal.

This app is also the perimeter's **submitter** (`crown-spec/docs/07-build-plan.md §Контракт
подающего впись`): the index keeps no retry budget on purpose, so the ceiling on paying for a read
that will never succeed lives here, in `lib/server/submitter.ts`.

Frontend details live in [docs/front.md](docs/front.md); the working brief — including the exact
order of operations both games follow — is [docs/ai-brief.md](docs/ai-brief.md).
