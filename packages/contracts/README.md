# @suinami/contracts

The on-chain layer of Suinami: the `suinami::feed` Sui Move package (the social
graph + gifting), plus publish/seed tooling.

Videos themselves live on **Walrus** — only their content-addressed
`blob_id` / `poster_blob` are stored on Sui. Those two `String`s on the `Video`
object are the entire **Walrus ↔ Sui bridge**. Every RPC the tooling makes goes
through the **Tatum** gateway (`x-api-key` header), never a public fullnode.

## Layout

- `Move.toml` — package manifest (`edition = "2024.beta"`, Sui framework).
- `sources/feed.move` — module `suinami::feed`: `Profile`, `Video`, `Feed`,
  `Like`, `GiftReceipt`, events, and entry funcs (`create_profile`, `post_video`,
  `like_video`, `unlike_video`, `record_view`, `update_profile`, `send_gift`).
- `scripts/publish.ts` — compiles the package and publishes it via Tatum.
- `scripts/seed.ts` — fully-implemented idempotent on-chain seeder: reads
  `SAMPLE_FEED`, dedupes by Walrus `blob_id` (via `VideoPosted` events), reuses
  or creates the deployer `Profile`, batches every missing `post_video` into one
  PTB, and ensures at least one like + one gift exist so leaderboards are
  non-empty.

## Build & test (requires the Sui CLI)

```bash
# from this package directory:
sui move build      # compile
sui move test       # run the Move unit tests in sources/feed.move
```

Or via the workspace scripts:

```bash
pnpm --filter @suinami/contracts build:move
pnpm --filter @suinami/contracts test:move
```

## Publish

```bash
pnpm --filter @suinami/contracts publish
```

Requirements (read from the repo-root `.env`):

- `TATUM_API_KEY` — Tatum Sui gateway key (used for the `x-api-key` header).
- `SUI_NETWORK` — `mainnet` | `testnet` | `devnet` (default `testnet`).
- `SUINAMI_DEPLOYER_KEY` — a **funded** deployer key in `suiprivkey...` format.
  Export with `sui keytool export --key-identity <alias>`. The publish gas is
  paid by this account (use the faucet on testnet/devnet; fund directly on
  mainnet).
- The **Sui CLI** must be on `PATH` (used locally to compile bytecode; the
  actual submit goes through Tatum).

On success it prints copy-paste lines for `.env`:

```
SUINAMI_PACKAGE_ID=0x...
SUINAMI_FEED_OBJECT_ID=0x...
VITE_SUINAMI_PACKAGE_ID=0x...
VITE_SUINAMI_FEED_OBJECT_ID=0x...
```

Paste these back into `.env` so the API and web app can find the package and the
shared `Feed` registry object.

## Seed

```bash
pnpm --filter @suinami/contracts run seed
```

Idempotent — safe to run multiple times. The seeder:

1. Reads `SAMPLE_FEED` (demo videos already stored on Walrus).
2. Queries `VideoPosted` events to find which `blob_id`s are already on-chain.
3. Reuses the deployer's existing `Profile` or creates one if absent.
4. Posts every missing video in a single PTB, anchoring each Walrus `blob_id`
   on Sui.
5. Adds one like + one Ripple gift if no `GiftSent` event exists yet.

Required env vars (in addition to the publish vars above):

- `SUI_NETWORK=mainnet` — set to target mainnet.
- `SUINAMI_MAINNET_DEPLOYER_KEY` — used automatically when `SUI_NETWORK=mainnet`;
  falls back to `SUINAMI_DEPLOYER_KEY` on other networks.

## Gift tiers (mirror of `@suinami/shared`)

| tier | name    | floor (MIST)    | SUI  |
| ---- | ------- | --------------- | ---- |
| 0    | ripple  | `10_000_000`    | 0.01 |
| 1    | splash  | `100_000_000`   | 0.1  |
| 2    | wave    | `500_000_000`   | 0.5  |
| 3    | tsunami | `1_000_000_000` | 1.0  |
