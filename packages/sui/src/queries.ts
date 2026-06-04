/**
 * Read-side queries against the `suinami::feed` module: feed events, profiles,
 * owned videos, and gift receipts. All return shared DTOs (money as decimal
 * strings) so the API and web client consume them directly.
 *
 * THE WALRUS ↔ SUI BRIDGE SURFACES HERE TOO: the `blobId` / `posterBlob` /
 * `avatarBlob` fields parsed out of on-chain objects are Walrus blob ids. They
 * are the join key the API uses to build aggregator media URLs (`@suinami/walrus`).
 *
 * Guard: when `packageId` is falsy (package not yet deployed), every function
 * short-circuits to an empty result WITHOUT touching the network.
 *
 * Field-name mapping: parsers accept both snake_case and camelCase variants to
 * handle the JSON-RPC and BCS-decoded shapes emitted by the published `feed` module.
 */
import type { SuiEvent, SuiObjectData, SuiParsedData } from "@mysten/sui/jsonRpc";
import {
  MOVE_EVENTS,
  MOVE_MODULE,
  type GiftReceiptData,
  type GiftTierId,
  type ProfileData,
  type VideoData,
} from "@suinami/shared";
import type { SuiClient } from "./client";

/* -------------------------------------------------------------------------- */
/* Event types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Shape of the `VideoPosted` event's `parsedJson`, as emitted by the Move
 * module. Numeric on-chain fields arrive as decimal strings over JSON-RPC.
 *
 * >>> `blobId` here is the Walrus blob id of the freshly posted video — the
 *     core Walrus ↔ Sui link the indexer fans out into a feed card. <<<
 */
export interface VideoPostedEvent {
  videoId: string;
  creator: string;
  blobId: string;
  posterBlob: string;
  caption: string;
  durationMs: string;
  width: string;
  height: string;
  /** Emission timestamp in ms (string over the wire). */
  createdAtMs: string;
}

/** A parsed feed event paired with its on-chain cursor for pagination. */
export interface FeedEventResult {
  event: VideoPostedEvent;
  /** Event sender (the creator's address). */
  sender: string;
  /** ms timestamp, or null if the node didn't return one. */
  timestampMs: number | null;
  /** Opaque cursor string for the next page (encoded EventId). */
  cursor: string;
}

export interface QueryFeedEventsResult {
  events: FeedEventResult[];
  /** Next-page cursor (encoded EventId JSON) or null when exhausted. */
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface QueryFeedEventsArgs {
  packageId: string;
  /** Encoded EventId cursor returned by a previous page. */
  cursor?: string | null;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/* Safe field readers (parsedJson / Move fields are `unknown`)                */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Coerce a JSON scalar to string (on-chain u64/u16 arrive as strings already). */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  return "";
}

/** Coerce a numeric-ish JSON value to a finite number (0 fallback). */
function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "bigint") return Number(value);
  return 0;
}

/** Narrow an arbitrary number to a GiftTierId (0..3), clamped to 0 otherwise. */
function asTierId(value: unknown): GiftTierId {
  const n = num(value);
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

/**
 * Pull the Move struct fields out of an object's content. In JSON-RPC the
 * `moveObject` content's `fields` may be a flat record, or the nested
 * `{ fields: {...}, type }` shape, or an array (for tuple-like structs). We
 * treat it as `unknown` and normalise to a flat record defensively.
 */
function moveFields(content: SuiParsedData | null | undefined): Record<string, unknown> {
  if (!content || content.dataType !== "moveObject") return {};
  // `content.fields` is the `MoveStruct` union; widen to unknown so the
  // shape checks below don't fight the union narrowing under strict mode.
  const fields: unknown = content.fields;
  if (Array.isArray(fields)) return {};
  const rec = asRecord(fields);
  const nested = rec["fields"];
  // Nested `{ fields: {...}, type }` shape — unwrap one level.
  if (typeof rec["type"] === "string" && typeof nested === "object" && nested !== null) {
    return asRecord(nested);
  }
  return rec;
}

/* -------------------------------------------------------------------------- */
/* queryFeedEvents                                                            */
/* -------------------------------------------------------------------------- */

function parseVideoPostedEvent(raw: unknown): VideoPostedEvent {
  const r = asRecord(raw);
  return {
    // Accept both snake_case (JSON-RPC) and camelCase (BCS-decoded) field spellings.
    videoId: str(r["video_id"] ?? r["videoId"] ?? r["id"]),
    creator: str(r["creator"]),
    blobId: str(r["blob_id"] ?? r["blobId"]),
    posterBlob: str(r["poster_blob"] ?? r["posterBlob"]),
    caption: str(r["caption"]),
    durationMs: str(r["duration_ms"] ?? r["durationMs"]),
    width: str(r["width"]),
    height: str(r["height"]),
    createdAtMs: str(r["created_at_ms"] ?? r["createdAtMs"] ?? r["timestamp_ms"]),
  };
}

/**
 * Page the `VideoPosted` event stream (newest first) for a deployed package.
 * Returns `[]` immediately when `packageId` is falsy (no network call).
 */
export async function queryFeedEvents(
  client: SuiClient,
  args: QueryFeedEventsArgs,
): Promise<QueryFeedEventsResult> {
  if (!args.packageId) {
    return { events: [], nextCursor: null, hasNextPage: false };
  }

  const page = await client.queryEvents({
    query: {
      MoveEventType: `${args.packageId}::${MOVE_MODULE}::${MOVE_EVENTS.videoPosted}`,
    },
    // Cursor is an encoded EventId JSON string; decode if present.
    cursor: decodeEventCursor(args.cursor),
    limit: args.limit ?? null,
    order: "descending",
  });

  const events: FeedEventResult[] = page.data.map((ev: SuiEvent) => ({
    event: parseVideoPostedEvent(ev.parsedJson),
    sender: ev.sender,
    timestampMs: ev.timestampMs != null ? num(ev.timestampMs) : null,
    cursor: JSON.stringify(ev.id),
  }));

  return {
    events,
    nextCursor: page.nextCursor ? JSON.stringify(page.nextCursor) : null,
    hasNextPage: page.hasNextPage,
  };
}

/** Decode the JSON-encoded EventId cursor; undefined when absent/invalid. */
function decodeEventCursor(
  cursor: string | null | undefined,
): { txDigest: string; eventSeq: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(cursor);
    const r = asRecord(parsed);
    if (typeof r["txDigest"] === "string" && typeof r["eventSeq"] === "string") {
      return { txDigest: r["txDigest"], eventSeq: r["eventSeq"] };
    }
  } catch {
    // fall through — treat an unparseable cursor as "from the start"
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* getProfile                                                                 */
/* -------------------------------------------------------------------------- */

export interface GetProfileArgs {
  packageId: string;
  owner: string;
}

/**
 * Fetch the first `Profile` object owned by `owner`. Returns `null` when the
 * package isn't configured or the owner has no profile.
 */
export async function getProfile(
  client: SuiClient,
  args: GetProfileArgs,
): Promise<ProfileData | null> {
  if (!args.packageId) return null;

  const page = await client.getOwnedObjects({
    owner: args.owner,
    filter: { StructType: `${args.packageId}::${MOVE_MODULE}::Profile` },
    options: { showContent: true, showType: true },
  });

  const first = page.data.find((o) => o.data != null);
  if (!first?.data) return null;
  return parseProfile(first.data);
}

function parseProfile(obj: SuiObjectData): ProfileData {
  const f = moveFields(obj.content);
  return {
    id: obj.objectId,
    owner: str(f["owner"]),
    handle: str(f["handle"]),
    displayName: str(f["display_name"] ?? f["displayName"]),
    // >>> WALRUS ↔ SUI BRIDGE: avatar Walrus blob id. <<<
    avatarBlob: str(f["avatar_blob"] ?? f["avatarBlob"]),
    bio: str(f["bio"]),
    videoCount: num(f["video_count"] ?? f["videoCount"]),
    totalTipsReceived: str(f["total_tips_received"] ?? f["totalTipsReceived"] ?? "0") || "0",
    totalLikesReceived: num(f["total_likes_received"] ?? f["totalLikesReceived"]),
    createdAtMs: num(f["created_at_ms"] ?? f["createdAtMs"]),
  };
}

/* -------------------------------------------------------------------------- */
/* getOwnedVideos                                                             */
/* -------------------------------------------------------------------------- */

export interface GetOwnedArgs {
  packageId: string;
  owner: string;
}

/**
 * All `Video` objects owned by `owner`. Returns `[]` when the package isn't
 * configured. (Note: in the published `Feed` model Video objects are stored in the shared Feed table (not owned), so this query returns results only when the package ABI places them under the queried `owner` address.)
 */
export async function getOwnedVideos(
  client: SuiClient,
  args: GetOwnedArgs,
): Promise<VideoData[]> {
  if (!args.packageId) return [];

  const page = await client.getOwnedObjects({
    owner: args.owner,
    filter: { StructType: `${args.packageId}::${MOVE_MODULE}::Video` },
    options: { showContent: true, showType: true },
  });

  const out: VideoData[] = [];
  for (const resp of page.data) {
    if (resp.data) out.push(parseVideo(resp.data));
  }
  return out;
}

function parseVideo(obj: SuiObjectData): VideoData {
  const f = moveFields(obj.content);
  return {
    id: obj.objectId,
    creator: str(f["creator"]),
    // >>> WALRUS ↔ SUI BRIDGE: the on-chain blob ids ARE the link to the
    //     video / poster bytes stored on Walrus. <<<
    blobId: str(f["blob_id"] ?? f["blobId"]),
    posterBlob: str(f["poster_blob"] ?? f["posterBlob"]),
    caption: str(f["caption"]),
    durationMs: num(f["duration_ms"] ?? f["durationMs"]),
    width: num(f["width"]),
    height: num(f["height"]),
    likeCount: num(f["like_count"] ?? f["likeCount"]),
    viewCount: num(f["view_count"] ?? f["viewCount"]),
    tipTotal: str(f["tip_total"] ?? f["tipTotal"] ?? "0") || "0",
    createdAtMs: num(f["created_at_ms"] ?? f["createdAtMs"]),
  };
}

/* -------------------------------------------------------------------------- */
/* getOwnedGiftReceipts                                                       */
/* -------------------------------------------------------------------------- */

/**
 * All `GiftReceipt` objects owned by `owner`. Returns `[]` when the package
 * isn't configured.
 */
export async function getOwnedGiftReceipts(
  client: SuiClient,
  args: GetOwnedArgs,
): Promise<GiftReceiptData[]> {
  if (!args.packageId) return [];

  const page = await client.getOwnedObjects({
    owner: args.owner,
    filter: { StructType: `${args.packageId}::${MOVE_MODULE}::GiftReceipt` },
    options: { showContent: true, showType: true },
  });

  const out: GiftReceiptData[] = [];
  for (const resp of page.data) {
    if (resp.data) out.push(parseGiftReceipt(resp.data));
  }
  return out;
}

function parseGiftReceipt(obj: SuiObjectData): GiftReceiptData {
  const f = moveFields(obj.content);
  return {
    id: obj.objectId,
    videoId: str(f["video_id"] ?? f["videoId"]),
    from: str(f["from"] ?? f["sender"]),
    to: str(f["to"] ?? f["recipient"]),
    amountMist: str(f["amount_mist"] ?? f["amount"] ?? "0") || "0",
    tier: asTierId(f["tier"]),
    sentAtMs: num(f["sent_at_ms"] ?? f["sentAtMs"] ?? f["created_at_ms"]),
  };
}
