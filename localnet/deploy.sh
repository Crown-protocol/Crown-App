#!/usr/bin/env bash
# The local ICP half of the stack, from nothing to wired, in one run.
#
# What this is FOR: the perimeter's canisters have no public principals, so the
# app's ICP paths (the book, the two games, the paid relay) can only be exercised
# against a replica you own. Solana is untouched — the splitter and the factory on
# devnet are the real ones, and this script never goes near them.
#
# What it deliberately does NOT do: change a single file in the perimeter repos.
# Every local-vs-mainnet difference is passed at DEPLOY time, through the init
# arguments those canisters already accept for exactly this purpose:
#   · the games take the replica's own root key (their proofs verify against it),
#   · the games and the relay take this deployment's index principal,
#   · the relay takes the allowlist that decides whose key it will pay for.
#
# The one piece that cannot be passed in is the SOL RPC canister the index calls:
# its principal is pinned in frozen code. So the perimeter's own e2e mock is
# deployed AT that principal (`--specified-id`), which the local replica allows.
# Ingest therefore works exactly as it does in the games' own live runs: a test
# preloads the reply, the index folds it.
#
# Usage:
#   cd crown-app/localnet
#   dfx start --clean --background
#   ./deploy.sh                       # prints the env block for crown-app/.env.local
set -euo pipefail

cd "$(dirname "$0")"
export PATH="$HOME/.local/share/dfx/bin:$PATH"

echo "▸ building canisters (release, wasm32)"
for spec in \
  "crown-indexer:../../crown-indexer" \
  "crown-relay:../../crown-relay" \
  "conditional-tasks:../../crown-games/conditional-tasks" \
  "conditional-funding:../../crown-games/conditional-funding" \
  "mock-sol-rpc:../../crown-games/e2e-fixtures/mock-sol-rpc"
do
  pkg="${spec%%:*}"; dir="${spec#*:}"
  cargo build --target wasm32-unknown-unknown --release -p "$pkg" --manifest-path "$dir/Cargo.toml" >/dev/null
done

echo "▸ sol-rpc mock at the pinned principal"
dfx canister create sol-rpc --specified-id tghme-zyaaa-aaaar-qarca-cai 2>/dev/null || true
dfx deploy sol-rpc >/dev/null

echo "▸ index"
dfx deploy crown-indexer >/dev/null
INDEX=$(dfx canister id crown-indexer)

# The games verify the index's certificate against a root key. On mainnet that is
# the NNS key baked into their code; here it has to be this replica's, which is
# why `InitArgs` carries it.
ROOT=$(python3 - <<'PY'
import json, subprocess
out = subprocess.run(["dfx", "ping"], capture_output=True, text=True).stdout
print("blob \"" + "".join("\\%02x" % b for b in json.loads(out[out.index("{"):])["root_key"]) + "\"")
PY
)

echo "▸ games"
dfx deploy conditional-tasks --argument "(opt record { nns_root_key = $ROOT; index = principal \"$INDEX\" })" >/dev/null
dfx deploy conditional-funding --argument "(opt record { nns_root_key = $ROOT; index = principal \"$INDEX\" })" >/dev/null
TASKS=$(dfx canister id conditional-tasks)
FUNDING=$(dfx canister id conditional-funding)

# Each game fetches its threshold key once, and nothing else works until it has:
# no key means no resolver, which means every escrow of every scope is left to
# its deadline refund.
dfx canister call conditional-tasks bootstrap >/dev/null
dfx canister call conditional-funding bootstrap >/dev/null

echo "▸ relay key"
RELAY_KEY_FILE="${RELAY_KEY_FILE:-$PWD/.relay-identity.json}"
if [ ! -f "$RELAY_KEY_FILE" ]; then
  node -e '
    const { Ed25519KeyIdentity } = require("../node_modules/@dfinity/identity");
    const id = Ed25519KeyIdentity.generate();
    require("fs").writeFileSync(process.argv[1], JSON.stringify(id.toJSON()));
    console.error("  new key: " + id.getPrincipal().toText());
  ' "$RELAY_KEY_FILE"
fi
RELAY_PRINCIPAL=$(node -e '
  const { Ed25519KeyIdentity } = require("../node_modules/@dfinity/identity");
  const id = Ed25519KeyIdentity.fromJSON(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(id.getPrincipal().toText());
' "$RELAY_KEY_FILE")

echo "▸ relay (allowlisting that key)"
dfx deploy crown-relay --argument "(opt record { games = vec { principal \"$TASKS\"; principal \"$FUNDING\" }; index = principal \"$INDEX\"; allowlist = vec { principal \"$RELAY_PRINCIPAL\" } })" >/dev/null
RELAY=$(dfx canister id crown-relay)

cat <<EOF

▸ done. Put this in crown-app/.env.local:

NEXT_PUBLIC_IC_HOST=http://127.0.0.1:4943
NEXT_PUBLIC_CHEER_INDEX_PRINCIPAL=$INDEX
NEXT_PUBLIC_RELAY_PRINCIPAL=$RELAY
NEXT_PUBLIC_TASKS_PRINCIPAL=$TASKS
NEXT_PUBLIC_FUNDING_PRINCIPAL=$FUNDING
RELAY_IDENTITY_JSON=$(cat "$RELAY_KEY_FILE")
EOF
