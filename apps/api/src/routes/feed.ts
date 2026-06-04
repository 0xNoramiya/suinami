/**
 * GET /api/feed — newest-first vertical feed.
 *
 * Reads the local `videos` rollup (joined with `creator_stats` for handle +
 * avatar) and hydrates each row into a FeedCard. The crucial step is turning
 * the on-chain Walrus blob_id into a playable aggregator URL — that is the
 * Walrus↔Sui bridge resolved for the client.
 *
 * Empty DB (e.g. before the indexer has run) -> { cards: [], nextCursor: null }.
 */
import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import { feedQuerySchema, type FeedCard, type FeedPage } from "@suinami/shared";
import { blobUrl } from "@suinami/walrus";
import { db } from "../db";
import { creatorStats, videos } from "../db/schema";
import { env } from "../env";

export const feed = new Hono();

feed.get("/", async (c) => {
  const parsed = feedQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "invalid query", issues: parsed.error.issues }, 400);
  }
  const { cursor, limit, creator } = parsed.data;

  // Cursor is the createdAt of the last card from the previous page. Fetch one
  // extra row to know whether a next page exists.
  const cursorTs = cursor ? Number(cursor) : undefined;

  const conditions = [];
  if (creator) conditions.push(eq(videos.creator, creator));
  if (cursorTs !== undefined && Number.isFinite(cursorTs)) {
    conditions.push(lt(videos.createdAt, cursorTs));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = db
    .select({
      videoId: videos.videoId,
      creator: videos.creator,
      videoHandle: videos.handle,
      blobId: videos.blobId,
      posterBlob: videos.posterBlob,
      caption: videos.caption,
      likeCount: videos.likeCount,
      viewCount: videos.viewCount,
      tipTotal: videos.tipTotal,
      durationMs: videos.durationMs,
      width: videos.width,
      height: videos.height,
      createdAt: videos.createdAt,
      statsHandle: creatorStats.handle,
      avatarBlob: creatorStats.avatarBlob,
    })
    .from(videos)
    .leftJoin(creatorStats, eq(creatorStats.address, videos.creator))
    .where(where)
    .orderBy(desc(videos.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const cards: FeedCard[] = pageRows.map((r) => {
    const handle = r.videoHandle || r.statsHandle || "";
    const avatarBlob = r.avatarBlob ?? "";
    return {
      videoId: r.videoId,
      creator: r.creator,
      handle,
      avatarUrl: avatarBlob ? blobUrl(env.WALRUS_AGGREGATOR_URL, avatarBlob) : null,
      // ----- Walrus blob_id ↔ Sui bridge: resolve the on-chain blob_id to a
      // playable aggregator URL so the client can stream it directly.
      videoUrl: blobUrl(env.WALRUS_AGGREGATOR_URL, r.blobId),
      posterUrl: r.posterBlob ? blobUrl(env.WALRUS_AGGREGATOR_URL, r.posterBlob) : null,
      caption: r.caption,
      likeCount: r.likeCount,
      viewCount: r.viewCount,
      tipTotal: r.tipTotal,
      durationMs: r.durationMs,
      width: r.width,
      height: r.height,
      createdAt: r.createdAt,
    };
  });

  // Dedup by caption, keeping the NEWEST (rows are createdAt-desc, so the first
  // occurrence wins). This lets a re-posted video (new on-chain object + new
  // Walrus blob id, same caption) cleanly supersede the one it replaces — e.g.
  // when media is re-rendered — without deleting the old immutable Video object.
  const seenCaptions = new Set<string>();
  const deduped = cards.filter((card) => {
    if (card.caption && seenCaptions.has(card.caption)) return false;
    if (card.caption) seenCaptions.add(card.caption);
    return true;
  });

  const last = pageRows.at(-1);
  const nextCursor = hasMore && last ? String(last.createdAt) : null;

  const page: FeedPage = { cards: deduped, nextCursor };
  return c.json(page);
});
