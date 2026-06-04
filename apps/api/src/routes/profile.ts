/**
 * GET /api/profile/:address — a creator's profile rollup + their videos.
 *
 * Returns a ProfileData-shaped object enriched with the creator's videos as
 * FeedCards (Walrus blob_ids resolved to aggregator URLs). If the creator has
 * no rollup row yet we synthesise an empty-but-valid profile so the client can
 * render a placeholder rather than 404.
 */
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  suiAddressSchema,
  type FeedCard,
  type ProfileData,
} from "@suinami/shared";
import { blobUrl } from "@suinami/walrus";
import { creatorStats, videos } from "../db/schema";
import { db } from "../db";
import { env } from "../env";

export const profile = new Hono();

interface ProfileResponse extends ProfileData {
  videos: FeedCard[];
}

/** Resolve a blob_id to an aggregator URL, or null when empty. */
function blobUrlFallback(aggregatorUrl: string, blob: string | undefined): string | null {
  if (!blob) return null;
  return blobUrl(aggregatorUrl, blob);
}

profile.get("/:address", async (c) => {
  const address = c.req.param("address");
  const parsed = suiAddressSchema.safeParse(address);
  if (!parsed.success) {
    return c.json({ error: "invalid Sui address" }, 400);
  }

  const stats = db
    .select()
    .from(creatorStats)
    .where(eq(creatorStats.address, address))
    .get();

  const creatorVideos = db
    .select()
    .from(videos)
    .where(eq(videos.creator, address))
    .orderBy(desc(videos.createdAt))
    .all();

  const cards: FeedCard[] = creatorVideos.map((v) => ({
    videoId: v.videoId,
    creator: v.creator,
    handle: v.handle || stats?.handle || "",
    avatarUrl: blobUrlFallback(env.WALRUS_AGGREGATOR_URL, stats?.avatarBlob),
    // ----- Walrus blob_id ↔ Sui bridge: on-chain blob_id -> aggregator URL.
    videoUrl: blobUrl(env.WALRUS_AGGREGATOR_URL, v.blobId),
    posterUrl: blobUrlFallback(env.WALRUS_AGGREGATOR_URL, v.posterBlob),
    caption: v.caption,
    likeCount: v.likeCount,
    viewCount: v.viewCount,
    tipTotal: v.tipTotal,
    durationMs: v.durationMs,
    width: v.width,
    height: v.height,
    createdAt: v.createdAt,
  }));

  // Dedup by caption (newest wins; createdAt-desc above) so a re-posted video
  // doesn't show twice — matches the feed route's behaviour.
  const seenCaptions = new Set<string>();
  const dedupedCards = cards.filter((card) => {
    if (card.caption && seenCaptions.has(card.caption)) return false;
    if (card.caption) seenCaptions.add(card.caption);
    return true;
  });

  const response: ProfileResponse = {
    // ProfileData fields. `id` is unknown to the rollup (it lives on-chain),
    // so we surface the address as a stable identifier until the indexer
    // backfills the Profile object ID.
    id: address,
    owner: address,
    handle: stats?.handle ?? "",
    displayName: stats?.displayName || stats?.handle || "",
    avatarBlob: stats?.avatarBlob ?? "",
    bio: stats?.bio ?? "",
    videoCount: stats?.videoCount || dedupedCards.length,
    totalTipsReceived: stats?.totalTips ?? "0",
    totalLikesReceived: stats?.totalLikes ?? 0,
    createdAtMs: 0,
    videos: dedupedCards,
  };

  return c.json(response);
});
