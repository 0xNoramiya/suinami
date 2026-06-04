/**
 * Suinami indexer — projects on-chain Sui events into the local SQLite rollups.
 *
 * BOOT-SAFETY CONTRACT: if the Move package isn't published yet
 * (`packageConfigured === false`), `startIndexer()` logs a notice and returns
 * immediately. NO interval is scheduled and NO RPC client is constructed, so
 * the API process makes zero network calls at startup.
 *
 * When configured, the indexer polls the Tatum-gated Sui RPC on an interval,
 * reads VideoPosted / GiftSent events, and upserts the rollups. Every RPC call
 * goes through the Tatum gateway via `getSuiClient` (the client attaches the
 * `x-api-key: TATUM_API_KEY` header to every request — see @suinami/sui).
 */
import { getSuiClient } from "@suinami/sui";

/**
 * The Tatum-gated Sui client type, inferred from the @suinami/sui factory so we
 * don't take a direct dependency on @mysten/sui from this package.
 */
type SuiClient = ReturnType<typeof getSuiClient>;
import { db } from "./db";
import { creatorStats, giftEvents, videos } from "./db/schema";
import { desc, sql } from "drizzle-orm";
import { env, packageConfigured } from "./env";

/** Lifecycle state surfaced by /health. */
export type IndexerState = "idle" | "running" | "waiting-for-package";

/** Poll cadence in ms. Conservative — the feed is event-driven, not realtime.
 * Each tick makes ~4 RPC calls; the @suinami/sui transport throttles to <3/s, so
 * a tick takes ~1.5s — well inside this interval. */
const POLL_INTERVAL_MS = 8_000;

/** Coerce a Move event's parsedJson into a string-keyed bag. */
function fields(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
const s = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

let state: IndexerState = "idle";
let timer: ReturnType<typeof setInterval> | null = null;
/** Guards against overlapping polls if one tick runs long. */
let polling = false;

export function getIndexerState(): IndexerState {
  return state;
}

/**
 * Start the indexer.
 *
 * - Not configured -> log + return (dormant; the health endpoint reports
 *   "waiting-for-package"). This is the path taken at hackathon boot before
 *   the Move package is published, and it touches NOTHING on the network.
 * - Configured -> schedule the polling interval.
 */
export function startIndexer(): void {
  if (!packageConfigured) {
    state = "waiting-for-package";
    console.log("indexer: waiting for SUINAMI_PACKAGE_ID");
    return;
  }

  if (timer) return; // already running

  state = "running";
  console.log(
    `indexer: starting poll loop (every ${POLL_INTERVAL_MS}ms) on ${env.SUI_NETWORK}`,
  );

  // Construct the Tatum-gated client lazily, only on the configured path so a
  // dormant server never builds an RPC transport.
  const client = getSuiClient({
    network: env.SUI_NETWORK,
    apiKey: env.TATUM_API_KEY, // ----- Tatum auth: becomes the x-api-key header.
    rpcUrl: env.SUI_RPC_URL,
  });

  timer = setInterval(() => {
    void tick(client);
  }, POLL_INTERVAL_MS);

  // Don't keep the event loop alive solely for the indexer.
  if (typeof timer.unref === "function") timer.unref();
}

/** Stop the loop (used by tests / graceful shutdown). */
export function stopIndexer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  state = packageConfigured ? "idle" : "waiting-for-package";
}

/**
 * One polling tick: pull recent feed + gift events and upsert rollups.
 * Cursor bookkeeping (resuming from last position across restarts) is a scale
 * concern deferred post-hackathon; each tick re-reads the 50 newest events.
 */
async function tick(client: SuiClient): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const pkg = env.SUINAMI_PACKAGE_ID;
    const ev = (name: string) => `${pkg}::feed::${name}` as const;
    // Re-read the head each tick (50 newest of each type). Idempotent upserts
    // keep it correct; cursor bookkeeping (indexer_cursor) is a scale concern.

    // 1. ProfileCreated -> handle map + creator_stats(handle).
    const profiles = await client.queryEvents({
      query: { MoveEventType: ev("ProfileCreated") },
      limit: 50,
      order: "descending",
    });
    const handleByOwner = new Map<string, string>();
    const profileIdByOwner = new Map<string, string>();
    for (const e of profiles.data) {
      const f = fields(e.parsedJson);
      const owner = s(f.owner);
      if (owner && !handleByOwner.has(owner)) {
        handleByOwner.set(owner, s(f.handle));
        const pid = s(f.profile_id);
        if (pid) profileIdByOwner.set(owner, pid);
      }
    }

    // ProfileCreated carries only the handle, so hydrate avatar_blob + bio +
    // display_name from the Profile OBJECTS (ONE call) — the WALRUS↔SUI BRIDGE
    // for identity. We only overwrite a field when we read a non-empty value, so
    // a transient miss never wipes a creator's existing avatar/bio.
    const avatarByOwner = new Map<string, string>();
    const bioByOwner = new Map<string, string>();
    const displayNameByOwner = new Map<string, string>();
    const profileIds = [...profileIdByOwner.values()];
    if (profileIds.length > 0) {
      const ownerByPid = new Map([...profileIdByOwner].map(([o, p]) => [p, o] as const));
      const objs = await client.multiGetObjects({
        ids: profileIds,
        options: { showContent: true },
      });
      for (const o of objs) {
        const content = o.data?.content as { fields?: Record<string, unknown> } | undefined;
        const f = content?.fields;
        const pid = o.data?.objectId;
        const owner = pid ? ownerByPid.get(pid) : undefined;
        if (!owner || !f) continue;
        const avatar = s(f.avatar_blob);
        const bio = s(f.bio);
        const displayName = s(f.display_name);
        if (avatar) avatarByOwner.set(owner, avatar);
        if (bio) bioByOwner.set(owner, bio);
        if (displayName) displayNameByOwner.set(owner, displayName);
      }
    }

    const now = Date.now();
    for (const [address, handle] of handleByOwner) {
      const avatarBlob = avatarByOwner.get(address);
      const bio = bioByOwner.get(address);
      const displayName = displayNameByOwner.get(address);
      const set: Record<string, unknown> = { handle, updatedAt: now };
      if (avatarBlob) set.avatarBlob = avatarBlob;
      if (bio) set.bio = bio;
      if (displayName) set.displayName = displayName;
      db.insert(creatorStats)
        .values({
          address,
          handle,
          avatarBlob: avatarBlob ?? "",
          bio: bio ?? "",
          displayName: displayName ?? "",
          updatedAt: now,
        })
        .onConflictDoUpdate({ target: creatorStats.address, set })
        .run();
    }

    // 2. VideoPosted -> the Walrus pointers + identity (carried in the event).
    const posts = await client.queryEvents({
      query: { MoveEventType: ev("VideoPosted") },
      limit: 50,
      order: "descending",
    });
    const posted = posts.data.map((e) => {
      const f = fields(e.parsedJson);
      return {
        videoId: s(f.video_id),
        creator: s(f.creator),
        blobId: s(f.blob_id),
        posterBlob: s(f.poster_blob),
        caption: s(f.caption),
        createdAt: n(f.created_at_ms),
      };
    });

    // 3. Hydrate authoritative counts + dims from the Video objects (ONE call).
    const objFields = new Map<string, Record<string, unknown>>();
    if (posted.length > 0) {
      const objs = await client.multiGetObjects({
        ids: posted.map((p) => p.videoId),
        options: { showContent: true },
      });
      for (const o of objs) {
        const data = o.data;
        const content = data?.content as { fields?: Record<string, unknown> } | undefined;
        if (data?.objectId && content?.fields) objFields.set(data.objectId, content.fields);
      }
    }

    // 4. Upsert each video (event identity + object counts/dims + handle).
    for (const p of posted) {
      const f = objFields.get(p.videoId) ?? {};
      upsertVideo({
        videoId: p.videoId,
        creator: p.creator,
        handle: handleByOwner.get(p.creator) ?? "",
        blobId: p.blobId,
        posterBlob: p.posterBlob,
        caption: p.caption,
        durationMs: n(f.duration_ms),
        width: n(f.width),
        height: n(f.height),
        likeCount: n(f.like_count),
        viewCount: n(f.view_count),
        tipTotal: s(f.tip_total) || "0",
        createdAt: p.createdAt,
      });
    }

    // 5. GiftSent -> gift_events + creator_stats.totalTips (idempotent by id).
    const gifts = await client.queryEvents({
      query: { MoveEventType: ev("GiftSent") },
      limit: 50,
      order: "descending",
    });
    for (const e of gifts.data) {
      const f = fields(e.parsedJson);
      upsertGift({
        id: `${e.id.txDigest}:${e.id.eventSeq}`,
        videoId: s(f.video_id),
        fromAddr: s(f.from),
        toAddr: s(f.to),
        amountMist: s(f.amount_mist) || "0",
        tier: n(f.tier),
        sentAt: n(f.sent_at_ms),
      });
    }

    // 6. Roll per-creator videoCount + totalLikes into creator_stats. Without
    //    this, both stay 0 forever and the leaderboard 'videos'/'likes' boards +
    //    the profile Likes are empty. videos.like_count is the chain-authoritative
    //    count hydrated from the Video objects (so no separate VideoLiked projection is needed).
    //    Deduped by caption (newest wins) to match the feed/profile display, so a
    //    re-posted video doesn't inflate the rollup. createdAt-desc → first per
    //    caption is the newest. creator_stats.handle/totalTips are left untouched.
    const ranked = db
      .select({
        creator: videos.creator,
        caption: videos.caption,
        likeCount: videos.likeCount,
      })
      .from(videos)
      .orderBy(desc(videos.createdAt))
      .all();
    const seenCaption = new Set<string>();
    const perCreator = new Map<string, { videoCount: number; totalLikes: number }>();
    for (const v of ranked) {
      if (v.caption && seenCaption.has(v.caption)) continue;
      if (v.caption) seenCaption.add(v.caption);
      const aggCur = perCreator.get(v.creator) ?? { videoCount: 0, totalLikes: 0 };
      aggCur.videoCount += 1;
      aggCur.totalLikes += v.likeCount;
      perCreator.set(v.creator, aggCur);
    }
    for (const [address, aggCur] of perCreator) {
      db.insert(creatorStats)
        .values({
          address,
          videoCount: aggCur.videoCount,
          totalLikes: aggCur.totalLikes,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: creatorStats.address,
          set: {
            videoCount: aggCur.videoCount,
            totalLikes: aggCur.totalLikes,
            updatedAt: now,
          },
        })
        .run();
    }
  } catch (err) {
    console.error("indexer: poll tick failed:", err);
  } finally {
    polling = false;
  }
}

// --------------------------------------------------------------------------
// Upsert helpers used by the polling tick to project on-chain events into
// the local rollup tables. Shapes are pinned to the drizzle schema.
// --------------------------------------------------------------------------

/** Mirror an on-chain Video into the `videos` table (idempotent by videoId). */
export function upsertVideo(row: {
  videoId: string;
  creator: string;
  handle: string;
  // ----- Walrus blob_id ↔ Sui bridge: copied verbatim from the Video object.
  blobId: string;
  posterBlob: string;
  caption: string;
  durationMs: number;
  width: number;
  height: number;
  likeCount: number;
  viewCount: number;
  tipTotal: string;
  createdAt: number;
}): void {
  db.insert(videos)
    .values(row)
    .onConflictDoUpdate({
      target: videos.videoId,
      set: {
        handle: row.handle,
        caption: row.caption,
        likeCount: row.likeCount,
        viewCount: row.viewCount,
        tipTotal: row.tipTotal,
      },
    })
    .run();
}

/** Record a GiftSent event and bump the recipient's lifetime tips. */
export function upsertGift(row: {
  id: string;
  videoId: string;
  fromAddr: string;
  toAddr: string;
  amountMist: string;
  tier: number;
  sentAt: number;
}): void {
  const inserted = db
    .insert(giftEvents)
    .values(row)
    .onConflictDoNothing({ target: giftEvents.id })
    .run();

  // Only fold the amount into the rollup if this gift is new (avoid double count).
  if (inserted.changes > 0) {
    db.insert(creatorStats)
      .values({
        address: row.toAddr,
        totalTips: row.amountMist,
        updatedAt: row.sentAt,
      })
      .onConflictDoUpdate({
        target: creatorStats.address,
        set: {
          // total_tips is a u64 decimal string; add in SQL via CAST.
          totalTips: sql`CAST(${creatorStats.totalTips} AS INTEGER) + ${row.amountMist}`,
          updatedAt: row.sentAt,
        },
      })
      .run();
  }
}
