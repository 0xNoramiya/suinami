/**
 * /api/comments — off-chain comments for a feed video.
 *
 *   GET  /api/comments/:videoId        → newest-first list + total
 *   POST /api/comments/:videoId  {body, author?, handle?}  → created Comment
 *
 * This is the only route that takes free-form user writes, so it is where the
 * injection defenses concentrate:
 *   1. videoId is whitelisted by `feedVideoIdSchema` (no arbitrary keys).
 *   2. The JSON body is validated by `commentBodySchema` (types + coarse caps).
 *   3. Text is normalized/length-capped by `sanitizeCommentText` /
 *      `sanitizeHandle` (strips control/zero-width/BiDi chars) BEFORE storage.
 *   4. Every query is built with Drizzle's query builder → fully parameterized,
 *      so neither `body` nor `videoId` can break out of a bind parameter
 *      (no SQL injection). Nothing is ever concatenated into SQL.
 *   5. The response is JSON (never HTML); the client renders text via React
 *      nodes (auto-escaped), so stored markup like `<script>` shows as literal
 *      text — no XSS.
 */
import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import {
  commentBodySchema,
  commentsQuerySchema,
  feedVideoIdSchema,
  sanitizeCommentText,
  sanitizeHandle,
  shortAddress,
  type Comment,
  type CommentsPage,
} from "@suinami/shared";
import { db } from "../db";
import { comments, type CommentRow } from "../db/schema";
import { clientIp, rateLimit } from "../lib/rateLimit";

export const commentsRoute = new Hono();

// Anti-spam: at most COMMENT_LIMIT posts per COMMENT_WINDOW_MS per client IP.
// Generous for a human, tight enough to stop a flood (which would also bloat the
// SQLite table). Applied BEFORE parse/sanitize/insert so a burst is cheap to reject.
const COMMENT_LIMIT = 8;
const COMMENT_WINDOW_MS = 10_000;

function toComment(r: CommentRow): Comment {
  return {
    id: r.id,
    videoId: r.videoId,
    author: r.author,
    handle: r.handle,
    body: r.body,
    createdAt: r.createdAt,
  };
}

commentsRoute.get("/:videoId", (c) => {
  const vid = feedVideoIdSchema.safeParse(c.req.param("videoId"));
  if (!vid.success) return c.json({ error: "invalid videoId" }, 400);
  const q = commentsQuerySchema.safeParse(c.req.query());
  if (!q.success) {
    return c.json({ error: "invalid query", issues: q.error.issues }, 400);
  }

  const rows = db
    .select()
    .from(comments)
    .where(eq(comments.videoId, vid.data))
    .orderBy(desc(comments.createdAt))
    .limit(q.data.limit)
    .all();

  const totalRow = db
    .select({ n: sql<number>`count(*)` })
    .from(comments)
    .where(eq(comments.videoId, vid.data))
    .get();

  const page: CommentsPage = {
    comments: rows.map(toComment),
    total: totalRow?.n ?? rows.length,
  };
  return c.json(page);
});

// Disambiguates inserts that land in the same millisecond.
let seq = 0;

commentsRoute.post("/:videoId", async (c) => {
  const vid = feedVideoIdSchema.safeParse(c.req.param("videoId"));
  if (!vid.success) return c.json({ error: "invalid videoId" }, 400);

  // Rate-limit early (before JSON parse / sanitize / insert) so floods are cheap.
  const ip = clientIp(c.req.header("x-forwarded-for"));
  const rl = rateLimit(`comment:${ip}`, COMMENT_LIMIT, COMMENT_WINDOW_MS);
  if (!rl.ok) {
    c.header("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
    return c.json({ error: "Too many comments — give the tide a moment." }, 429);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = commentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }

  // Authoritative sanitization (defense even if a client skips it).
  const body = sanitizeCommentText(parsed.data.body);
  if (!body) {
    return c.json({ error: "comment is empty after sanitization" }, 400);
  }
  const author = parsed.data.author ?? "";
  const handle = sanitizeHandle(
    parsed.data.handle ?? (author ? shortAddress(author) : "guest"),
  );

  const createdAt = Date.now();
  const id = `${createdAt.toString(36)}-${(seq++).toString(36)}`;

  // Parameterized insert — body/handle/videoId travel as bind params.
  db.insert(comments)
    .values({ id, videoId: vid.data, author, handle, body, createdAt })
    .run();

  const comment: Comment = {
    id,
    videoId: vid.data,
    author,
    handle,
    body,
    createdAt,
  };
  return c.json(comment, 201);
});
