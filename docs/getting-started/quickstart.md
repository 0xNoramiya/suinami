# Quickstart

Run the whole Suinami stack locally — web + API + indexer — against Sui mainnet through Tatum,
with media on Walrus.

## Prerequisites

- **Node 22.11+** and **pnpm 9**
- A **Tatum API key** (for the Sui RPC gateway)
- A Sui wallet browser extension (e.g. Sui Wallet or Suiet) to sign writes
- *(only if deploying your own contract)* the **Sui CLI**

## 1. Install

```bash
git clone https://github.com/0xNoramiya/suinami.git
cd suinami
pnpm install
```

## 2. Configure

Copy the example env and fill in your values:

```bash
cp .env.example .env
```

The key variables (see [`.env.example`](https://github.com/0xNoramiya/suinami/blob/main/.env.example)):

| Variable | Purpose |
|---|---|
| `TATUM_API_KEY` | Auth for the Tatum Sui RPC gateway (`x-api-key`) |
| `SUI_NETWORK` | `mainnet` · `testnet` · `devnet` |
| `SUI_RPC_URL` | Tatum gateway URL (defaults per network) |
| `SUINAMI_PACKAGE_ID` | Published `suinami::feed` package id |
| `SUINAMI_FEED_OBJECT_ID` | Shared `Feed` object id |
| `WALRUS_PUBLISHER_URL` | Walrus publisher (write side) |
| `WALRUS_AGGREGATOR_URL` | Walrus aggregator (read side) |
| `VITE_*` | Client‑side copies (Tatum read key, package ids, aggregator) |

!!! tip "Use the live mainnet deployment"
    To point at the already‑published package, set `SUI_NETWORK=mainnet`,
    `SUINAMI_PACKAGE_ID=0xc8cd42bb010547a96436db9680576a3d112fdbc39e5016def3a97b9bbfb77317`, and
    `SUINAMI_FEED_OBJECT_ID=0x3560a1ee825b2b61adbcbdacec489cfc9e96e18e057ba1ea24cac665b1690885`.

## 3. Run

```bash
pnpm dev        # web + api (+ the boot-safe indexer) via Turborepo
```

- Web: the Vite dev server URL it prints
- API: `http://localhost:<API_PORT>` — try `/health` and `/api/feed`

The indexer starts polling automatically **only if** `SUINAMI_PACKAGE_ID` is set; otherwise it
stays dormant and `/health` reports `waiting-for-package`. → [The indexer](../architecture/indexer.md)

## 4. Verify the integrations

Two smoke tests check the real infrastructure:

```bash
pnpm smoke          # a Sui read returns through Tatum with the x-api-key header
pnpm smoke:walrus   # bytes store→read byte-for-byte; the Blob object's owner
                    # (read back through Tatum) equals the creator
```

## Deploy your own contract (optional)

The Move package lives in `packages/contracts`. Publish it with the Sui CLI, then put the
resulting package id and shared `Feed` object id into `.env`:

```bash
cd packages/contracts
sui move build
sui client publish --gas-budget 100000000
```

→ Next: the [project structure](structure.md) or the [architecture overview](../architecture/overview.md).
