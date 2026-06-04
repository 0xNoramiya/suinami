# API reference

The API is a small Hono server (`apps/api`). Read endpoints serve the indexer's SQLite
rollups; the upload endpoint writes to Walrus. **All on‑chain reads behind these routes go
through Tatum.** Base path is the same origin as the web app (`/api/*`); in local dev the
server listens on `API_PORT`.

!!! note "What's on‑chain vs not"
    `feed`, `leaderboard`, `profile`, and `gifts` are **projections of on‑chain state**
    (rebuilt by the [indexer](architecture/indexer.md)). `upload` writes bytes to **Walrus**.
    `comments` are the only **off‑chain** data — stored in ephemeral SQLite and rate‑limited.

## `GET /health`

Liveness + indexer state. Makes no network calls.

```json
{
  "ok": true,
  "service": "suinami-api",
  "network": "mainnet",
  "packageConfigured": true,
  "indexer": "running",
  "uptimeMs": 1234567
}
```

`indexer` is one of `idle` · `running` · `waiting-for-package`.

## `GET /api/feed`

Newest‑first vertical feed, deduped by caption (newest wins).

| Query | Type | Default | Notes |
|---|---|---|---|
| `cursor` | string | – | `createdAt` of the last card from the previous page |
| `limit` | int | 10 | page size (`FEED_PAGE_SIZE`) |
| `creator` | Sui address | – | restrict to one creator |

**Response** `FeedPage`:

```json
{
  "cards": [{
    "videoId": "0x…",
    "creator": "0x…",
    "handle": "creator",
    "avatarUrl": "https://<aggregator>/v1/blobs/<avatar_blob>",
    "videoUrl": "https://<aggregator>/v1/blobs/<blob_id>",
    "posterUrl": "https://<aggregator>/v1/blobs/<poster_blob>",
    "caption": "hello suinami",
    "likeCount": 0, "viewCount": 0, "tipTotal": "0",
    "durationMs": 15000, "width": 1080, "height": 1920,
    "createdAt": 1733000000000
  }],
  "nextCursor": "1733000000000"
}
```

`videoUrl` / `posterUrl` / `avatarUrl` are the Walrus `blob_id`s resolved to aggregator URLs —
the [Walrus↔Sui bridge](walrus.md#the-walrus-sui-bridge) resolved for the client.

## `POST /api/upload`

Stores a video + poster on Walrus and returns their blob ids. The **client** then submits the
`post_video` transaction carrying these ids. Multipart body with `video` and `poster` file
fields; `creator` (and optional `epochs`) in the query string.

| Query | Type | Notes |
|---|---|---|
| `creator` | Sui address | becomes `send_object_to` — the creator owns the Walrus `Blob` |
| `epochs` | int | optional storage lifetime |

**Response** `UploadResult`:

```json
{ "videoBlobId": "…", "posterBlobId": "…" }
```

Hardening: declared‑length pre‑check, size caps (`100 MB` video / `8 MB` poster → `413`), and a
**magic‑byte sniff** that ignores the spoofable MIME type (unsupported → `415`). Allowed:
MP4 / WebM / MOV and JPEG / PNG / WebP.

## `GET /api/leaderboard`

The **Tide Charts** — creator rankings across four boards.

| Query | Values | Default |
|---|---|---|
| `board` | `tips` · `rising` · `likes` · `videos` | `tips` |
| `window` | `24h` · `7d` · `all` | `all` |
| `limit` | int | – |

**Response** `LeaderboardResponse`: `{ board, window, rows: LeaderboardRow[] }`. Each row carries
a `verifyUrl` pointing at SuiVision so the ranking is provably backed by on‑chain activity.

## `GET /api/profile/:address`

A creator's profile rollup plus their videos as feed cards. If no rollup row exists yet, a
valid empty profile is synthesized (no `404`). Response is `ProfileData` extended with
`videos: FeedCard[]`.

## `GET /api/gifts`

A creator's on‑chain gift ledger (projected from `GiftSent`).

| Query | Values | Default |
|---|---|---|
| `address` | Sui address | required |
| `dir` | `received` · `sent` | `received` |
| `limit` | int | – |

**Response** `GiftsResponse`: `{ address, direction, entries: GiftLedgerEntry[] }`. Each entry's
`digest` is parsed from the event id (`txDigest:eventSeq`) so the client can link to SuiVision
and prove the gift on chain.

## Comments (off-chain)

| Endpoint | Notes |
|---|---|
| `GET /api/comments/:videoId` | Paginated comments for a video |
| `POST /api/comments/:videoId` | Add a comment; returns `201`. **Rate‑limited per IP** (`429` on burst). Body validated + sanitized |

Comments are stored in the container's ephemeral SQLite, so they reset if the machine
restarts — everything else is chain‑derived and rebuilds automatically.

## Errors

All routes return `{ "error": "…" }` with an appropriate status: `400` (invalid query/body),
`413` (too large), `415` (unsupported media), `429` (rate limited), `502` (Walrus upload
failed).
