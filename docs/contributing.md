# Contributing

Thanks for your interest in Suinami. This page covers how the repo is organized, the
conventions to follow, and how to make a change land cleanly.

## Set up

```bash
git clone https://github.com/0xNoramiya/suinami.git
cd suinami
pnpm install
cp .env.example .env     # fill in TATUM_API_KEY etc. — see Quickstart
pnpm dev                 # web + api + the boot-safe indexer
```

See the [Quickstart](getting-started/quickstart.md) for the full environment setup and the
[project structure](getting-started/structure.md) for the layout.

## The golden rule: one place per integration

Suinami's design depends on each external system being wired in exactly once. Respect these
boundaries:

| If you're touching… | Go through… | Never… |
|---|---|---|
| A Sui RPC (read/write/event) | `@suinami/sui` (`getSuiClient`) | hit a fullnode directly or drop the Tatum `x-api-key` |
| A Walrus blob | `@suinami/walrus` (`storeBlob` / `blobUrl`) | forget `send_object_to` on writes |
| A constant (tiers, RPC urls, limits) | `@suinami/shared` | hardcode a value that exists there |

If you add a new way to reach Sui or Walrus, route it through these packages so the credential
and ownership rules can't be bypassed. → [Tatum](tatum.md) · [Walrus](walrus.md)

## Code style & checks

- **TypeScript strict is the gate.** There is no ESLint; `tsc` strict mode (plus a clean Vite
  build) is what CI and reviewers expect to pass.

  ```bash
  pnpm typecheck                 # all packages + apps
  pnpm --filter @suinami/web build
  ```

- **Internal packages are source‑first** — `package.json` `exports` point at `src`, resolved via
  tsconfig `paths` + Vite aliases. There's no lib build step; don't add `rootDir` to a package
  tsconfig (it causes `TS6059` across packages).
- **Determinism in motion/render code.** Anything rendered headlessly (HyperFrames compositions)
  must avoid `Math.random()` / `Date.now()` — use a seeded PRNG.
- **Security stays on.** User text is rendered as React text nodes (never `innerHTML`); DB access
  is parameterized (Drizzle); comments go through `@suinami/shared`'s `sanitize.ts`.

## The Move contract

The `suinami::feed` package lives in `packages/contracts`. To build and test:

```bash
cd packages/contracts
sui move build
sui move test
```

The published package is **immutable**, so any contract change is a **new deployment** (new
package id) plus updating `SUINAMI_PACKAGE_ID` / `SUINAMI_FEED_OBJECT_ID` in `.env`. Keep the
Move gift‑tier floors in sync with `GIFT_TIERS` in `@suinami/shared`. → [Move functions](sui/functions.md)

## Working on these docs

The docs are MkDocs Material in `docs/`. To preview and build:

```bash
python3 -m venv .docs-venv
.docs-venv/bin/pip install -r docs/requirements.txt
.docs-venv/bin/mkdocs serve              # live preview at http://127.0.0.1:8000
.docs-venv/bin/mkdocs build --strict     # what CI runs — must pass
```

To add a page: create `docs/<path>.md` and register it under `nav:` in `mkdocs.yml`. Diagrams use
fenced ```` ```mermaid ```` blocks (flowchart / sequenceDiagram / classDiagram / stateDiagram‑v2).
A push to `main` that touches `docs/**` or `mkdocs.yml` redeploys the site via GitHub Actions. →
[Deployment](deploy.md#these-docs-github-pages)

!!! tip "classDiagram stereotypes"
    Use Mermaid's `<<shared>>` annotation syntax inside a class body, not literal `«guillemets»`.

## Commit & PR conventions

- Branch off `main`; keep commits focused and scoped.
- Use a short, imperative subject line, optionally prefixed by area (`docs:`, `web:`, `api:`,
  `contracts:`, `sui:`, `walrus:`).
- A PR should pass `pnpm typecheck` and the web build, and explain *what changed and why*.
- **Never commit secrets.** `.env` is gitignored; only the by‑design client `VITE_*` values are
  ever exposed (and only at build time).

## Verifying behavior

- On‑chain integrations: `pnpm smoke` (Tatum) and `pnpm smoke:walrus` (Walrus round‑trip +
  ownership), described in the [Quickstart](getting-started/quickstart.md#4-verify-the-integrations).
- You can independently check any claim against the chain — see [Verify on‑chain](verify-on-chain.md).
