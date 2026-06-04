/**
 * GET /api/gifts — a creator's on-chain gift ledger.
 *
 * Reads the indexer's `gift_events` table (projected from GiftSent events, every
 * RPC through Tatum) and returns the gifts a creator RECEIVED (`dir=received`,
 * default) or SENT (`dir=sent`), newest first. Each row carries the tx digest
 * (parsed from the event id) so the client can link to SuiVision /txblock and
 * prove the gift on-chain. Empty ledger -> { ..., entries: [] }.
 */
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  giftsQuerySchema,
  type GiftLedgerEntry,
  type GiftsResponse,
} from "@suinami/shared";
import { giftEvents } from "../db/schema";
import { db } from "../db";

export const gifts = new Hono();

gifts.get("/", (c) => {
  const parsed = giftsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "invalid query", issues: parsed.error.issues }, 400);
  }
  const { address, dir, limit } = parsed.data;

  // received → match the recipient; sent → match the sender.
  const filterCol = dir === "received" ? giftEvents.toAddr : giftEvents.fromAddr;
  const rows = db
    .select()
    .from(giftEvents)
    .where(eq(filterCol, address))
    .orderBy(desc(giftEvents.sentAt))
    .limit(limit)
    .all();

  const entries: GiftLedgerEntry[] = rows.map((r) => ({
    id: r.id,
    videoId: r.videoId,
    from: r.fromAddr,
    to: r.toAddr,
    counterparty: dir === "received" ? r.fromAddr : r.toAddr,
    amountMist: r.amountMist,
    tier: r.tier,
    sentAt: r.sentAt,
    // The event id is `${txDigest}:${eventSeq}` — the digest is the SuiVision key.
    digest: r.id.split(":")[0] ?? "",
  }));

  const response: GiftsResponse = { address, direction: dir, entries };
  return c.json(response);
});
