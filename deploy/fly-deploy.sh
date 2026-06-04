#!/usr/bin/env bash
#
# Deploy Suinami to fly.io. Run from anywhere; it cd's to the repo root.
# Prereqs:  flyctl installed, `fly auth login` done, and an app created
#           (`fly apps create <name>` or `fly launch --no-deploy --copy-config`),
#           with the app name matching `app =` in fly.toml.
#
# It reads VITE_* + TATUM_API_KEY from .env, sets the runtime secret, and deploys
# with the web build args. No secrets are committed — they live only in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "✗ Missing .env — copy .env.example to .env and fill it."; exit 1; }
command -v fly >/dev/null 2>&1 || command -v flyctl >/dev/null 2>&1 || {
  echo "✗ flyctl not found. Install: curl -L https://fly.io/install.sh | sh"; exit 1; }
FLY="$(command -v fly || command -v flyctl)"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${TATUM_API_KEY:?TATUM_API_KEY missing in .env}"
: "${VITE_SUI_RPC_URL:?VITE_SUI_RPC_URL missing in .env}"
: "${VITE_TATUM_API_KEY:?VITE_TATUM_API_KEY missing in .env}"
: "${VITE_WALRUS_AGGREGATOR_URL:?VITE_WALRUS_AGGREGATOR_URL missing in .env}"
: "${VITE_SUINAMI_PACKAGE_ID:?VITE_SUINAMI_PACKAGE_ID missing in .env}"
: "${VITE_SUINAMI_FEED_OBJECT_ID:?VITE_SUINAMI_FEED_OBJECT_ID missing in .env}"

echo "→ staging TATUM_API_KEY secret (server-side: indexer + /api Sui reads)…"
"$FLY" secrets set TATUM_API_KEY="$TATUM_API_KEY" --stage

echo "→ building + deploying (VITE_API_BASE_URL is empty ⇒ SPA calls /api same-origin)…"
"$FLY" deploy \
  --build-arg VITE_SUI_NETWORK="${VITE_SUI_NETWORK:-mainnet}" \
  --build-arg VITE_SUI_RPC_URL="$VITE_SUI_RPC_URL" \
  --build-arg VITE_TATUM_API_KEY="$VITE_TATUM_API_KEY" \
  --build-arg VITE_WALRUS_AGGREGATOR_URL="$VITE_WALRUS_AGGREGATOR_URL" \
  --build-arg VITE_SUINAMI_PACKAGE_ID="$VITE_SUINAMI_PACKAGE_ID" \
  --build-arg VITE_SUINAMI_FEED_OBJECT_ID="$VITE_SUINAMI_FEED_OBJECT_ID" \
  --build-arg VITE_API_BASE_URL=""

echo "✓ deployed. Open it:  $FLY open    (or:  $FLY status)"
