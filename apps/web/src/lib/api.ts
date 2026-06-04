/**
 * Tiny typed client for the Hono API. Only what the feed needs today: comments.
 *
 * `config.apiBaseUrl` is "" in production (same-origin "/api/…") or the dev
 * server URL locally. videoIds are URL-encoded so synthetic ids like "hf:hero"
 * travel safely as a single path segment.
 */
import { config } from "@/config";
import type {
  Comment,
  CommentsPage,
  FeedCard,
  FeedPage,
  GiftDirection,
  GiftsResponse,
  LeaderboardBoard,
  LeaderboardResponse,
  LeaderboardWindow,
  ProfileData,
} from "@suinami/shared";

const base = config.apiBaseUrl;

/** GET /api/profile/:address — a creator's rollup + their on-chain videos. */
export type ProfileResponse = ProfileData & { videos: FeedCard[] };

export async function fetchProfile(address: string): Promise<ProfileResponse> {
  const res = await fetch(`${base}/api/profile/${encodeURIComponent(address)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  return (await res.json()) as ProfileResponse;
}

/**
 * Newest-first feed from the API (indexer-projected on-chain Videos). Each card's
 * videoId is the real on-chain Video object id, so write paths (like/gift) can
 * target it. Callers fall back to the static SAMPLE_FEED when this is empty/down.
 */
export async function fetchFeed(limit = 30): Promise<FeedPage> {
  const res = await fetch(`${base}/api/feed?limit=${limit}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load feed (${res.status})`);
  return (await res.json()) as FeedPage;
}

/**
 * Creator leaderboard for one board (indexer-rolled on-chain activity). Rows are
 * pre-sorted + ranked by the server; each carries a SuiVision verifyUrl and a
 * real creator address (so row taps open the right on-chain profile). Callers
 * fall back to a SAMPLE_FEED-derived board when this is empty/down.
 */
export async function fetchLeaderboard(
  board: LeaderboardBoard,
  window: LeaderboardWindow = "all",
  limit = 50,
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ board, window, limit: String(limit) });
  const res = await fetch(`${base}/api/leaderboard?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load leaderboard (${res.status})`);
  return (await res.json()) as LeaderboardResponse;
}

/**
 * A creator's on-chain gift ledger (indexer-projected GiftSent events). `dir`
 * picks the side: gifts they RECEIVED (default) or SENT. Each entry carries a tx
 * digest so the UI can link to SuiVision and prove it on-chain.
 */
export async function fetchGifts(
  address: string,
  dir: GiftDirection = "received",
  limit = 50,
): Promise<GiftsResponse> {
  const params = new URLSearchParams({ address, dir, limit: String(limit) });
  const res = await fetch(`${base}/api/gifts?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load gifts (${res.status})`);
  return (await res.json()) as GiftsResponse;
}

function commentsUrl(videoId: string): string {
  return `${base}/api/comments/${encodeURIComponent(videoId)}`;
}

export async function fetchComments(
  videoId: string,
  limit = 50,
): Promise<CommentsPage> {
  const res = await fetch(`${commentsUrl(videoId)}?limit=${limit}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load comments (${res.status})`);
  return (await res.json()) as CommentsPage;
}

export interface PostCommentInput {
  body: string;
  author?: string;
  handle?: string;
}

export async function postComment(
  videoId: string,
  input: PostCommentInput,
): Promise<Comment> {
  const res = await fetch(commentsUrl(videoId), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let msg = `Failed to post comment (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return (await res.json()) as Comment;
}
