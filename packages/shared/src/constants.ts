/**
 * Suinami shared constants — the single source of truth for network config,
 * gift economics, and Move call targets. Imported by every other package so
 * the on-chain model, the API, and the UI never drift apart.
 */

/** 1 SUI = 1e9 MIST. */
export const MIST_PER_SUI = 1_000_000_000n;

export type SuiNetwork = "mainnet" | "testnet" | "devnet";

/**
 * Tatum Sui RPC gateways. EVERY Sui JSON-RPC call in Suinami goes through one
 * of these — never a public fullnode. Auth is the `x-api-key` request header.
 */
export const TATUM_RPC_URLS: Record<SuiNetwork, string> = {
  mainnet: "https://sui-mainnet.gateway.tatum.io",
  testnet: "https://sui-testnet.gateway.tatum.io",
  devnet: "https://sui-devnet.gateway.tatum.io",
};

/** SuiVision explorer base, per network — used for "verified on Sui" links. */
export const SUIVISION_URLS: Record<SuiNetwork, string> = {
  mainnet: "https://suivision.xyz",
  testnet: "https://testnet.suivision.xyz",
  devnet: "https://devnet.suivision.xyz",
};

/** Default Walrus storage duration (epochs) when a caller doesn't specify. */
export const WALRUS_DEFAULT_EPOCHS = 5;

/** Default feed page size. */
export const FEED_PAGE_SIZE = 10;

/**
 * Upload limits — shared so the web client can pre-check a file before POSTing
 * (and the server can reject before paying to store on Walrus). Sizes in bytes.
 */
export const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_POSTER_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
export const ALLOWED_VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const ALLOWED_POSTER_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** Human "100 MB"/"8 MB" style label for a byte count (for UI + error copy). */
export function formatMaxBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export type GiftTierId = 0 | 1 | 2 | 3;
export type GiftTierKey = "ripple" | "splash" | "wave" | "tsunami";

export interface GiftTier {
  id: GiftTierId;
  key: GiftTierKey;
  name: string;
  /** Minimum SUI required to send this tier (human units). */
  floorSui: number;
  /** Minimum amount in MIST. Tiers are cosmetic; a fan may always send more. */
  floorMist: bigint;
  /** CSS custom-property reference for this tier's accent colour. */
  accent: string;
  /** Emoji glyph shown on the gift sheet. */
  glyph: string;
  /** Short description shown on the gift sheet. */
  blurb: string;
}

/**
 * Gift tiers. The MIST floor is asserted on-chain in `send_gift`; the rest is
 * cosmetic (drives the splash → tsunami water animation on the client).
 */
export const GIFT_TIERS: readonly GiftTier[] = [
  {
    id: 0,
    key: "ripple",
    name: "Ripple",
    floorSui: 0.01,
    floorMist: 10_000_000n,
    accent: "var(--c-aqua)",
    glyph: "💧",
    blurb: "A gentle nod.",
  },
  {
    id: 1,
    key: "splash",
    name: "Splash",
    floorSui: 0.1,
    floorMist: 100_000_000n,
    accent: "var(--c-sui)",
    glyph: "🌊",
    blurb: "Make a splash.",
  },
  {
    id: 2,
    key: "wave",
    name: "Wave",
    floorSui: 0.5,
    floorMist: 500_000_000n,
    accent: "var(--c-sui)",
    glyph: "🌊",
    blurb: "Ride the wave.",
  },
  {
    id: 3,
    key: "tsunami",
    name: "Tsunami",
    floorSui: 1.0,
    floorMist: 1_000_000_000n,
    accent: "var(--c-coral)",
    glyph: "🌊",
    blurb: "Unleash a tsunami.",
  },
] as const;

export function tierById(id: number): GiftTier | undefined {
  return GIFT_TIERS.find((t) => t.id === id);
}

/** Move module name inside the Suinami package. */
export const MOVE_MODULE = "feed";

/** Entry-function names in `suinami::feed`. The package ID is injected at call time. */
export const MOVE = {
  createProfile: "create_profile",
  postVideo: "post_video",
  likeVideo: "like_video",
  unlikeVideo: "unlike_video",
  recordView: "record_view",
  updateProfile: "update_profile",
  sendGift: "send_gift",
} as const;

/** Event type short names emitted by the Move module (indexer subscribes to these). */
export const MOVE_EVENTS = {
  videoPosted: "VideoPosted",
  videoLiked: "VideoLiked",
  videoUnliked: "VideoUnliked",
  videoViewed: "VideoViewed",
  profileCreated: "ProfileCreated",
  giftSent: "GiftSent",
} as const;

/** Convert a MIST amount (bigint or string) to a human SUI number. */
export function mistToSui(mist: bigint | string): number {
  const v = typeof mist === "string" ? BigInt(mist || "0") : mist;
  return Number(v) / Number(MIST_PER_SUI);
}

/** Convert a SUI human amount to MIST (floored to integer MIST). */
export function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * Number(MIST_PER_SUI)));
}
