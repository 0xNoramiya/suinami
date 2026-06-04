/**
 * Drizzle (sqlite-core) schema for the Suinami indexer rollups.
 *
 * This DB is a denormalised CACHE of on-chain state — the source of truth is
 * always the Sui chain (objects + events), which the indexer projects into
 * these tables so the API can serve fast feed/leaderboard/profile reads
 * without hitting RPC on every request.
 *
 * Money amounts (MIST) are stored as TEXT because they are u64 on-chain and
 * would overflow JS numbers / SQLite integers.
 */
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * One row per posted video. The `blobId` column is the Walrus↔Sui bridge:
 * the on-chain Video object stores this Walrus blob_id, and the API turns it
 * into a playable aggregator URL (`/v1/blobs/${blobId}`) when serving a feed.
 */
export const videos = sqliteTable(
  "videos",
  {
    /** Sui object ID of the Video object (0x…). */
    videoId: text("video_id").primaryKey(),
    creator: text("creator").notNull(),
    handle: text("handle").notNull().default(""),
    // ----- Walrus blob_id ↔ Sui bridge: core media link, mirrored from chain.
    blobId: text("blob_id").notNull(),
    posterBlob: text("poster_blob").notNull().default(""),
    caption: text("caption").notNull().default(""),
    durationMs: integer("duration_ms").notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    /** Total MIST tipped on this video (decimal string). */
    tipTotal: text("tip_total").notNull().default("0"),
    createdAt: integer("created_at").notNull().default(0),
  },
  (t) => [index("idx_videos_created_at").on(t.createdAt)],
);

/** Per-creator rollup used by profile + leaderboard reads. */
export const creatorStats = sqliteTable("creator_stats", {
  address: text("address").primaryKey(),
  handle: text("handle").notNull().default(""),
  /** On-chain Profile.display_name (projected by the indexer). */
  displayName: text("display_name").notNull().default(""),
  /** On-chain Profile.bio (projected by the indexer). */
  bio: text("bio").notNull().default(""),
  avatarBlob: text("avatar_blob").notNull().default(""),
  videoCount: integer("video_count").notNull().default(0),
  /** Lifetime MIST received (decimal string). */
  totalTips: text("total_tips").notNull().default("0"),
  totalLikes: integer("total_likes").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

/** One row per on-chain GiftSent event (drives the tips leaderboard). */
export const giftEvents = sqliteTable(
  "gift_events",
  {
    /** Synthetic id: `${txDigest}:${eventSeq}` (idempotent upsert key). */
    id: text("id").primaryKey(),
    videoId: text("video_id").notNull(),
    fromAddr: text("from_addr").notNull(),
    toAddr: text("to_addr").notNull(),
    /** Gift amount in MIST (decimal string). */
    amountMist: text("amount_mist").notNull().default("0"),
    tier: integer("tier").notNull().default(0),
    sentAt: integer("sent_at").notNull().default(0),
  },
  (t) => [index("idx_gift_events_sent_to").on(t.sentAt, t.toAddr)],
);

/** One row per like (lets us dedupe and compute creator like totals). */
export const likes = sqliteTable("likes", {
  /** Synthetic id, e.g. the Like object ID or `${videoId}:${fan}`. */
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  fan: text("fan").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});

/**
 * One row per comment. Off-chain social (NOT projected from chain) — the only
 * table here that takes direct user writes, so it is the injection-sensitive
 * one: writes go through zod + sanitizeCommentText, and all SQL is Drizzle-
 * parameterized (no string concatenation), so neither the text nor the videoId
 * can break out of its bind parameter.
 */
export const comments = sqliteTable(
  "comments",
  {
    /** Synthetic id: `${createdAt}-${counter}` style, minted server-side. */
    id: text("id").primaryKey(),
    videoId: text("video_id").notNull(),
    /** Author wallet address, or "" when posted anonymously. */
    author: text("author").notNull().default(""),
    handle: text("handle").notNull().default("guest"),
    /** Sanitized comment text. Rendered as plain text on the client only. */
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(0),
  },
  (t) => [index("idx_comments_video_created").on(t.videoId, t.createdAt)],
);

/**
 * Single-row table tracking how far the indexer has consumed the event stream
 * so polling resumes from the right place across restarts.
 */
export const indexerCursor = sqliteTable("indexer_cursor", {
  id: text("id").primaryKey().default("sui"),
  cursorTxDigest: text("cursor_tx_digest"),
  cursorEventSeq: text("cursor_event_seq"),
  updatedAt: integer("updated_at").notNull().default(0),
});

// Inferred row types for use across routes / indexer.
export type VideoRow = typeof videos.$inferSelect;
export type CreatorStatsRow = typeof creatorStats.$inferSelect;
export type GiftEventRow = typeof giftEvents.$inferSelect;
export type LikeRow = typeof likes.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type IndexerCursorRow = typeof indexerCursor.$inferSelect;

/**
 * Raw CREATE TABLE IF NOT EXISTS statements run on boot so a fresh database
 * works with no migration step. Kept here (next to the schema) so the two stay
 * in lock-step. Executed by db/index.ts against the better-sqlite3 handle.
 */
export const CREATE_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    handle TEXT NOT NULL DEFAULT '',
    blob_id TEXT NOT NULL,
    poster_blob TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    like_count INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    tip_total TEXT NOT NULL DEFAULT '0',
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at)`,
  `CREATE TABLE IF NOT EXISTS creator_stats (
    address TEXT PRIMARY KEY,
    handle TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    avatar_blob TEXT NOT NULL DEFAULT '',
    video_count INTEGER NOT NULL DEFAULT 0,
    total_tips TEXT NOT NULL DEFAULT '0',
    total_likes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS gift_events (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    amount_mist TEXT NOT NULL DEFAULT '0',
    tier INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gift_events_sent_to ON gift_events (sent_at, to_addr)`,
  `CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    fan TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    handle TEXT NOT NULL DEFAULT 'guest',
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_video_created ON comments (video_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS indexer_cursor (
    id TEXT PRIMARY KEY DEFAULT 'sui',
    cursor_tx_digest TEXT,
    cursor_event_seq TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
];
