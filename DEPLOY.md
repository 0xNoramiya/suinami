# Deploying Suinami (fly.io)

Suinami ships as **one container**: the Hono API serves the built web SPA *and*
`/api/*`, so judges get a single URL. The indexer rebuilds the feed from chain on
boot, so **no database volume is needed** — the feed repopulates within ~8 s of
start, and one machine is kept warm so it's always populated.

Verified locally: `docker build` + `docker run` serves the SPA, hashed assets,
`/health`, and `/api/feed` (real mainnet data via Tatum). `fly deploy` does the
same on fly's remote builder.

## What's in the repo

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: install deps → `vite build` the SPA → run the API (which hosts the SPA) |
| `fly.toml` | App config — public env (network, RPC, Walrus, package IDs), `internal_port = 8080`, one warm machine, `/health` check |
| `deploy/fly-deploy.sh` | Reads `.env`, sets the `TATUM_API_KEY` secret, and runs `fly deploy` with the `VITE_*` build args |
| `.dockerignore` | Keeps `node_modules`, `dist`, `.env`, db, etc. out of the build context |

Secrets are never committed — `fly.toml` holds only public values; the
`TATUM_API_KEY` is set as a fly secret, and the (client-exposed-by-design)
`VITE_*` values are passed as build args from your local `.env` at deploy time.

## One-time setup

```bash
# 1. Install + log in
curl -L https://fly.io/install.sh | sh        # adds `fly` to PATH (or `flyctl`)
fly auth login                                 # opens a browser

# 2. Create the app (name must be globally unique; edit `app =` in fly.toml to match)
fly apps create suinami-demo                   # or pick your own name
#    └─ if the name is taken, choose another and update `app =` in fly.toml
```

## Deploy

```bash
# From the repo root, with .env filled in (same vars you run locally):
./deploy/fly-deploy.sh
```

That sets the `TATUM_API_KEY` secret and deploys with the web build args
(`VITE_API_BASE_URL` is empty, so the SPA calls `/api` on the same origin). When
it finishes:

```bash
fly open        # open the live URL
fly status      # machine + health
fly logs        # tail logs (you'll see "indexer: starting poll loop")
```

Your demo URL is `https://<app>.fly.dev`.

## Notes for judges / reviewers

- **It's the real mainnet app.** Every Sui RPC routes through Tatum; media streams
  from Walrus mainnet; the feed/leaderboard/profile/gifts are projected from
  on-chain events.
- **Writes need a wallet.** Like / gift / post and the Profile tab prompt a wallet
  connection (e.g. Sui Wallet / Suiet). Browsing the feed, leaderboard, and any
  creator's profile works without connecting.
- **Comments are off-chain** and stored in the container's ephemeral SQLite, so
  they reset if the machine restarts. Everything else is chain-derived and
  rebuilds automatically. To persist comments, attach a fly volume and point
  `DATABASE_URL` at it (e.g. `/data/suinami.db`).

## Tearing it down

```bash
fly apps destroy suinami-demo
```
