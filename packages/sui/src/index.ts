/**
 * @suinami/sui — the Sui layer for Suinami.
 *
 * Two integration points run through this package and are LOUDLY commented at
 * their source:
 *   1. The Tatum gateway (`./client`) — every Sui RPC carries the Tatum
 *      `x-api-key` header; we never touch a public fullnode.
 *   2. The Walrus ↔ Sui bridge (`./tx`, `./queries`) — Walrus blob ids are the
 *      only on-chain link to the video/poster/avatar bytes stored off-chain.
 */

// Config
export { resolveRpcUrl, type SuiClientConfig } from "./config";

// Client (Tatum integration point)
export {
  getTatumTransport,
  getSuiClient,
  getReferenceGasPrice,
  type SuiClient,
} from "./client";

// Transaction builders (Walrus ↔ Sui bridge on the write side)
export {
  buildCreateProfileTx,
  buildPostVideoTx,
  buildLikeTx,
  buildUnlikeTx,
  buildRecordViewTx,
  buildUpdateProfileTx,
  buildGiftTx,
  type PackageArg,
  type CreateProfileArgs,
  type PostVideoArgs,
  type LikeArgs,
  type UnlikeArgs,
  type RecordViewArgs,
  type UpdateProfileArgs,
  type GiftArgs,
} from "./tx";

// Queries (Walrus ↔ Sui bridge on the read side)
export {
  queryFeedEvents,
  getProfile,
  getOwnedVideos,
  getOwnedGiftReceipts,
  type VideoPostedEvent,
  type FeedEventResult,
  type QueryFeedEventsResult,
  type QueryFeedEventsArgs,
  type GetProfileArgs,
  type GetOwnedArgs,
} from "./queries";
