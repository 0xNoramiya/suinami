/**
 * GET /api/leaderboard — creator rankings across four boards.
 *
 *  - tips   : lifetime / windowed MIST received (from gift_events).
 *  - rising : tips received within the selected window (24h/7d), emphasising
 *             recent momentum rather than all-time totals.
 *  - likes  : total likes received (creator_stats.totalLikes).
 *  - videos : number of videos posted (creator_stats.videoCount).
 *
 * verifyUrl points at SuiVision so each row is provably backed by on-chain
 * activity. Empty data -> { ..., rows: [] }.
 */
import { Hono } from "hono";
import { desc, gte, sql } from "drizzle-orm";
import {
  SUIVISION_URLS,
  leaderboardQuerySchema,
  mistToSui,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LeaderboardWindow,
} from "@suinami/shared";
import { creatorStats, giftEvents } from "../db/schema";
import { db } from "../db";
import { env } from "../env";

export const leaderboard = new Hono();

/** Window -> earliest sentAt (ms) we still count, or 0 for "all". */
function windowFloorMs(window: LeaderboardWindow, now: number): number {
  switch (window) {
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "all":
      return 0;
  }
}

/** SuiVision account link for the "verified on Sui" badge. */
function verifyUrl(address: string): string {
  return `${SUIVISION_URLS[env.SUI_NETWORK]}/account/${address}`;
}

leaderboard.get("/", async (c) => {
  const parsed = leaderboardQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "invalid query", issues: parsed.error.issues }, 400);
  }
  const { board, window, limit } = parsed.data;

  let rows: LeaderboardRow[];

  if (board === "tips" || board === "rising") {
    // Sum MIST per recipient from gift_events, respecting the time window.
    // (rising == tips within a window; "all" rising falls back to lifetime.)
    const floor = windowFloorMs(window, Date.now());
    const where = floor > 0 ? gte(giftEvents.sentAt, floor) : undefined;

    const agg = db
      .select({
        address: giftEvents.toAddr,
        // amount_mist is a u64 decimal string; sum via CAST. Fits in SQLite's
        // 64-bit integer for realistic hackathon volumes.
        total: sql<number>`SUM(CAST(${giftEvents.amountMist} AS INTEGER))`,
      })
      .from(giftEvents)
      .where(where)
      .groupBy(giftEvents.toAddr)
      .orderBy(desc(sql`SUM(CAST(${giftEvents.amountMist} AS INTEGER))`))
      .limit(limit)
      .all();

    // Pull handles/avatars/video counts in one pass.
    const meta = new Map<
      string,
      { handle: string; avatarBlob: string; videoCount: number }
    >();
    for (const s of db.select().from(creatorStats).all()) {
      meta.set(s.address, {
        handle: s.handle,
        avatarBlob: s.avatarBlob,
        videoCount: s.videoCount,
      });
    }

    rows = agg.map((r, i) => {
      const m = meta.get(r.address);
      const mist = BigInt(Math.trunc(r.total ?? 0));
      const sui = mistToSui(mist);
      return {
        rank: i + 1,
        address: r.address,
        handle: m?.handle ?? "",
        avatarUrl: avatarUrl(m?.avatarBlob),
        metric: `${sui.toFixed(sui >= 1 ? 2 : 4)} SUI`,
        metricRaw: sui,
        videoCount: m?.videoCount ?? 0,
        verifyUrl: verifyUrl(r.address),
      };
    });
  } else if (board === "likes") {
    const agg = db
      .select()
      .from(creatorStats)
      .orderBy(desc(creatorStats.totalLikes))
      .limit(limit)
      .all();
    rows = agg.map((s, i) => ({
      rank: i + 1,
      address: s.address,
      handle: s.handle,
      avatarUrl: avatarUrl(s.avatarBlob),
      metric: `${s.totalLikes}`,
      metricRaw: s.totalLikes,
      videoCount: s.videoCount,
      verifyUrl: verifyUrl(s.address),
    }));
  } else {
    // board === "videos"
    const agg = db
      .select()
      .from(creatorStats)
      .orderBy(desc(creatorStats.videoCount))
      .limit(limit)
      .all();
    rows = agg.map((s, i) => ({
      rank: i + 1,
      address: s.address,
      handle: s.handle,
      avatarUrl: avatarUrl(s.avatarBlob),
      metric: `${s.videoCount}`,
      metricRaw: s.videoCount,
      videoCount: s.videoCount,
      verifyUrl: verifyUrl(s.address),
    }));
  }

  const response: LeaderboardResponse = { board, window, rows };
  return c.json(response);
});

/** Resolve an avatar blob to an aggregator URL (Walrus↔Sui bridge), or null. */
function avatarUrl(avatarBlob: string | undefined): string | null {
  if (!avatarBlob) return null;
  return `${env.WALRUS_AGGREGATOR_URL}/v1/blobs/${avatarBlob}`;
}
