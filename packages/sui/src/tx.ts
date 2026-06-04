/**
 * Programmable-transaction builders for the `suinami::feed` Move module.
 *
 * Each builder returns an unsigned `Transaction`; signing + execution happens
 * in the web wallet (dapp-kit) or the API. The package ID is injected at call
 * time so these stay deployment-agnostic.
 *
 * THE WALRUS ↔ SUI BRIDGE LIVES HERE: `buildPostVideoTx` carries the Walrus
 * `blobId` (and poster blob) as on-chain `string` fields of the `Video` object.
 * That blob_id is the ONLY link between the bytes stored on Walrus and the
 * social/economic object graph on Sui — the video itself is never on-chain,
 * only its Walrus blob id is. Resolve it back to media via the Walrus
 * aggregator (`@suinami/walrus` `blobUrl`).
 *
 * Reconciled against the PUBLISHED `feed` module ABI (pkg 0x75a7…1814):
 * like_video/record_view take NO Clock; unlike_video is (video, like). post_video
 * and send_gift carry the &Clock; send_gift splits the tip off the gas coin.
 */
import { Transaction } from "@mysten/sui/transactions";
import { MOVE, MOVE_MODULE } from "@suinami/shared";

/** Sui system Clock object — always at this well-known address. */
const CLOCK_OBJECT_ID = "0x6";

/** Build a fully-qualified Move call target: `<pkg>::feed::<fn>`. */
function target(packageId: string, fn: string): `${string}::${string}::${string}` {
  return `${packageId}::${MOVE_MODULE}::${fn}`;
}

/** Shared base: every builder takes the deployed package id. */
export interface PackageArg {
  packageId: string;
}

/** `create_profile(handle, display_name, avatar_blob, bio, &Clock)` */
export interface CreateProfileArgs extends PackageArg {
  handle: string;
  displayName: string;
  /** Walrus blob id of the avatar image (empty string = none). */
  avatarBlob: string;
  bio: string;
}

export function buildCreateProfileTx(args: CreateProfileArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(args.packageId, MOVE.createProfile),
    arguments: [
      tx.pure.string(args.handle),
      tx.pure.string(args.displayName),
      tx.pure.string(args.avatarBlob),
      tx.pure.string(args.bio),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/**
 * `post_video(feed, blob_id, poster_blob, caption, duration_ms, width, height, &Clock)`
 *
 * >>> WALRUS ↔ SUI BRIDGE: `blobId` (video bytes on Walrus) and `posterBlob`
 *     (thumbnail bytes on Walrus) are persisted as Move `string` fields on the
 *     created `Video` object. This is the join key between Walrus storage and
 *     the Sui object graph. <<<
 */
export interface PostVideoArgs extends PackageArg {
  /** Shared `Feed` object id the video is appended to. */
  feedId: string;
  /** Walrus blob id of the uploaded video. */
  blobId: string;
  /** Walrus blob id of the poster/thumbnail frame. */
  posterBlob: string;
  caption: string;
  durationMs: number;
  width: number;
  height: number;
}

export function buildPostVideoTx(args: PostVideoArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(args.packageId, MOVE.postVideo),
    arguments: [
      tx.object(args.feedId),
      // >>> WALRUS ↔ SUI BRIDGE: blob ids stored on-chain as strings. <<<
      tx.pure.string(args.blobId),
      tx.pure.string(args.posterBlob),
      tx.pure.string(args.caption),
      tx.pure.u64(BigInt(args.durationMs)),
      tx.pure.u16(args.width),
      tx.pure.u16(args.height),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/** `like_video(video, ctx)` — no Clock in the published ABI. */
export interface LikeArgs extends PackageArg {
  videoId: string;
}

export function buildLikeTx(args: LikeArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(args.packageId, MOVE.likeVideo),
    arguments: [tx.object(args.videoId)],
  });
  return tx;
}

/** `unlike_video(like, video)` — consumes the caller's `Like` receipt. */
export interface UnlikeArgs extends PackageArg {
  /** The `Like` object id minted when the caller liked the video. */
  likeId: string;
  videoId: string;
}

export function buildUnlikeTx(args: UnlikeArgs): Transaction {
  const tx = new Transaction();
  // Published ABI order is `unlike_video(video, like, ctx)` — video FIRST.
  tx.moveCall({
    target: target(args.packageId, MOVE.unlikeVideo),
    arguments: [tx.object(args.videoId), tx.object(args.likeId)],
  });
  return tx;
}

/** `record_view(video)` — permissionless; no Clock/ctx in the published ABI. */
export interface RecordViewArgs extends PackageArg {
  videoId: string;
}

export function buildRecordViewTx(args: RecordViewArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(args.packageId, MOVE.recordView),
    arguments: [tx.object(args.videoId)],
  });
  return tx;
}

/**
 * `update_profile(profile, display_name, avatar_blob, bio)`
 *
 * >>> WALRUS ↔ SUI BRIDGE: `avatarBlob` is a Walrus blob id stored on the
 *     `Profile`. <<<
 */
export interface UpdateProfileArgs extends PackageArg {
  profileId: string;
  displayName: string;
  /** Walrus blob id of the new avatar. */
  avatarBlob: string;
  bio: string;
}

export function buildUpdateProfileTx(args: UpdateProfileArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(args.packageId, MOVE.updateProfile),
    arguments: [
      tx.object(args.profileId),
      tx.pure.string(args.displayName),
      // >>> WALRUS ↔ SUI BRIDGE: avatar blob id stored on-chain. <<<
      tx.pure.string(args.avatarBlob),
      tx.pure.string(args.bio),
    ],
  });
  return tx;
}

/**
 * `send_gift(video, profile, payment: Coin<SUI>, tier, &Clock)`
 *
 * Splits the gift amount off the gas coin and forwards it to the creator's
 * `Profile` while crediting the `Video`. `tier` is cosmetic (0..3) — the Move
 * side asserts the MIST floor for the tier.
 */
export interface GiftArgs extends PackageArg {
  videoId: string;
  /** Recipient creator's `Profile` object id. */
  profileId: string;
  /** Gift amount in MIST. */
  amountMist: bigint;
  /** Gift tier id (0=ripple .. 3=tsunami). */
  tier: number;
}

export function buildGiftTx(args: GiftArgs): Transaction {
  const tx = new Transaction();
  // Split the tip off the gas coin: yields a fresh Coin<SUI> for the amount.
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.amountMist)]);
  tx.moveCall({
    target: target(args.packageId, MOVE.sendGift),
    arguments: [
      tx.object(args.videoId),
      tx.object(args.profileId),
      coin,
      tx.pure.u8(args.tier),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}
