/**
 * Zod (v4) schemas for API request validation. Kept in `shared` so the client
 * and server agree on the wire contract.
 */
import { z } from "zod";
import { MAX_COMMENT_LENGTH, MAX_HANDLE_LENGTH } from "./sanitize";

/** A Sui address: 0x followed by 1–64 hex chars. */
export const suiAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/, "invalid Sui address");

/**
 * A feed videoId path param. Whitelist of the only shapes we ever mint:
 * synthetic ids ("hf:hero", "ad:a1", "seed:3") or an on-chain object id.
 * Whitelisting the param keeps junk/oversized keys out of the store.
 */
export const feedVideoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9:_-]{1,80}$/, "invalid videoId");

/**
 * Body for `POST /api/comments/:videoId`. The raw caps here are coarse DoS
 * guards; the authoritative trimming/normalization happens in
 * sanitizeCommentText / sanitizeHandle before anything is stored.
 */
export const commentBodySchema = z.object({
  body: z.string().min(1).max(MAX_COMMENT_LENGTH * 8),
  /** Author wallet address (present only when a wallet is connected). */
  author: suiAddressSchema.optional(),
  /** Optional chosen display handle; defaults to a shortened address / "guest". */
  handle: z.string().max(MAX_HANDLE_LENGTH * 4).optional(),
});

/** Query for `GET /api/comments/:videoId`. */
export const commentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Query params for `POST /api/upload`. */
export const uploadQuerySchema = z.object({
  creator: suiAddressSchema,
  epochs: z.coerce.number().int().positive().max(200).optional(),
});

/** Query params for `GET /api/feed`. */
export const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  creator: suiAddressSchema.optional(),
});

/** Query params for `GET /api/leaderboard`. */
export const leaderboardQuerySchema = z.object({
  board: z.enum(["tips", "likes", "rising", "videos"]).default("tips"),
  window: z.enum(["24h", "7d", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Query params for `GET /api/gifts`. */
export const giftsQuerySchema = z.object({
  address: suiAddressSchema,
  dir: z.enum(["received", "sent"]).default("received"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type UploadQuery = z.infer<typeof uploadQuerySchema>;
export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type GiftsQuery = z.infer<typeof giftsQuerySchema>;
export type CommentBody = z.infer<typeof commentBodySchema>;
export type CommentsQuery = z.infer<typeof commentsQuerySchema>;
