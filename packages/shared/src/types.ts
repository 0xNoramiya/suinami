/**
 * Domain DTOs shared across the API and the web client. These mirror the
 * on-chain Move objects, but money amounts (MIST) are carried as decimal
 * strings so they survive JSON without precision loss.
 */
import type { GiftTierId } from "./constants";

export interface ProfileData {
  id: string;
  owner: string;
  handle: string;
  displayName: string;
  /** Walrus blob ID of the avatar (empty string if none). */
  avatarBlob: string;
  bio: string;
  videoCount: number;
  /** Lifetime MIST tipped to this creator, as a decimal string. */
  totalTipsReceived: string;
  totalLikesReceived: number;
  createdAtMs: number;
}

export interface VideoData {
  id: string;
  creator: string;
  /** Walrus blob ID of the video — the core Sui↔Walrus link. */
  blobId: string;
  /** Walrus blob ID of the poster/thumbnail frame. */
  posterBlob: string;
  caption: string;
  durationMs: number;
  width: number;
  height: number;
  likeCount: number;
  viewCount: number;
  /** Total MIST tipped on this specific video, as a decimal string. */
  tipTotal: string;
  createdAtMs: number;
}

/**
 * A feed card as served by `GET /api/feed`: on-chain metadata with Walrus
 * media URLs already resolved to the aggregator so the client just plays them.
 */
export interface FeedCard {
  videoId: string;
  creator: string;
  handle: string;
  avatarUrl: string | null;
  /** `${AGGREGATOR}/v1/blobs/${blobId}` */
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  likeCount: number;
  viewCount: number;
  tipTotal: string;
  durationMs: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface FeedPage {
  cards: FeedCard[];
  nextCursor: string | null;
}

/**
 * One comment on a video. Off-chain social (not a Move object) — stored in the
 * API's SQLite. `body`/`handle` are user-supplied and MUST be treated as
 * untrusted: they are sanitized on write (see sanitizeCommentText) and rendered
 * as plain text on the client (React auto-escapes — never via innerHTML).
 */
export interface Comment {
  id: string;
  videoId: string;
  /** Author wallet address if connected, else "" (anonymous). Never rendered as HTML. */
  author: string;
  /** Display handle (sanitized). e.g. "0x12…ab" or a chosen name. */
  handle: string;
  /** Comment text (sanitized, length-capped). Rendered as plain text only. */
  body: string;
  createdAt: number;
}

export interface CommentsPage {
  comments: Comment[];
  total: number;
}

export type LeaderboardBoard = "tips" | "likes" | "rising" | "videos";
export type LeaderboardWindow = "24h" | "7d" | "all";

export interface LeaderboardRow {
  rank: number;
  address: string;
  handle: string;
  avatarUrl: string | null;
  /** Formatted metric for display (e.g. "12.5" SUI or "340" likes). */
  metric: string;
  /** Raw numeric metric for sorting / sparkline scaling. */
  metricRaw: number;
  /** Videos this creator has posted — shown as a sub-metric on every board. */
  videoCount: number;
  /** SuiVision link proving the value is real on-chain activity. */
  verifyUrl: string;
}

export interface LeaderboardResponse {
  board: LeaderboardBoard;
  window: LeaderboardWindow;
  rows: LeaderboardRow[];
}

export interface GiftReceiptData {
  id: string;
  videoId: string;
  from: string;
  to: string;
  amountMist: string;
  tier: GiftTierId;
  sentAtMs: number;
}

/** Which side of a creator's gift ledger to read. */
export type GiftDirection = "received" | "sent";

/** One row of the on-chain gift ledger (projected from a GiftSent event). */
export interface GiftLedgerEntry {
  /** `${txDigest}:${eventSeq}` — stable, idempotent id. */
  id: string;
  videoId: string;
  from: string;
  to: string;
  /** The OTHER party relative to the queried address (sender or recipient). */
  counterparty: string;
  amountMist: string;
  tier: number;
  /** Unix ms the gift was sent. */
  sentAt: number;
  /** Tx digest (parsed from `id`) for a SuiVision /txblock link. */
  digest: string;
}

export interface GiftsResponse {
  address: string;
  direction: GiftDirection;
  entries: GiftLedgerEntry[];
}

/** Result of the two-blob Walrus upload performed by `POST /api/upload`. */
export interface UploadResult {
  videoBlobId: string;
  posterBlobId: string;
}

/** Health payload from `GET /health`. */
export interface HealthStatus {
  ok: boolean;
  service: string;
  network: SuiNetworkLike;
  packageConfigured: boolean;
  indexer: "idle" | "running" | "waiting-for-package";
  uptimeMs: number;
}

/** Loosened network type to avoid a hard import cycle in some consumers. */
export type SuiNetworkLike = "mainnet" | "testnet" | "devnet";
