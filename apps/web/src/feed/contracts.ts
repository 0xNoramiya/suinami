/**
 * Fixed prop/type contract for the feed UI. Authored centrally so the feed
 * engine, the card, the water-FX library, and the wallet/gift modules can be
 * built in parallel and still line up. Components live in:
 *   src/feed/FeedScreen.tsx, VideoCard.tsx, RightRail.tsx, GiftSheet.tsx
 *   src/fx/*            (LikeSplash, DepthGauge, SoundDisc, TideBuffer, PullWave)
 *   src/wallet/*        (ConnectControl, useWalletGate)
 */
import type { FeedCard } from "@suinami/shared";

/** A like-splash droplet burst, positioned within a card (px). */
export interface SplashBurst {
  id: number;
  x: number;
  y: number;
}

/** One full-bleed feed card. */
export interface VideoCardProps {
  card: FeedCard;
  /** True when focused → autoplay; all others pause. */
  active: boolean;
  /** Global muted state (muted autoplay by browser policy until first tap). */
  muted: boolean;
  onToggleMute: () => void;
  /** Optimistic like (double-tap anywhere or the rail heart). */
  onLike: (videoId: string) => void;
  liked: boolean;
  onOpenGift: (card: FeedCard) => void;
  onOpenComments: (card: FeedCard) => void;
  onOpenProfile: (creator: string) => void;
  /** Known comment count (from the API once loaded); falls back to a stub. */
  commentCount?: number;
}

/** Right action rail (avatar / like / gift / comment / share / sound disc). */
export interface RightRailProps {
  card: FeedCard;
  liked: boolean;
  likeCount: number;
  playing: boolean;
  onLike: () => void;
  onOpenGift: () => void;
  onOpenComments: () => void;
  onOpenProfile: () => void;
  onShare: () => void;
  /** Comment count to display; when undefined the rail shows a derived stub. */
  commentCount?: number;
}

/**
 * Frosted bottom-sheet comment thread. Comments are off-chain (API + SQLite);
 * text is sanitized on write and rendered as plain text (never innerHTML).
 */
export interface CommentSheetProps {
  open: boolean;
  card: FeedCard | null;
  /** Connected wallet address (author), or null for anonymous "guest" posts. */
  address: string | null;
  onClose: () => void;
  /** Report the live comment total up so the rail count stays in sync. */
  onCount?: (videoId: string, total: number) => void;
}

/** Frosted bottom-sheet gift picker. onConfirm carries the tier + MIST amount to FeedScreen, which fires the real on-chain send_gift via useOnChainWrite. */
export interface GiftSheetProps {
  open: boolean;
  card: FeedCard | null;
  connected: boolean;
  onClose: () => void;
  /** Optimistic confirm (tier id 0..3 + chosen amount in MIST). */
  onConfirm: (args: { tier: number; amountMist: bigint }) => void;
  /** Fired when the user tries to gift while disconnected. */
  onRequireConnect: () => void;
}

// --- water FX (src/fx) — declarative + GPU-cheap + prefers-reduced-motion aware ---
export interface LikeSplashProps {
  bursts: SplashBurst[];
}
export interface DepthGaugeProps {
  /** 0..1 progress through the feed. */
  progress: number;
}
export interface SoundDiscProps {
  playing: boolean;
  className?: string;
}
export interface TideBufferProps {
  /** Show the rising-tide shimmer while the video buffers. */
  active: boolean;
}
export interface PullWaveProps {
  /** Overscroll pull amount, 0..1+ (1 = release threshold). */
  pull: number;
  refreshing: boolean;
}

/** Minimal wallet state surfaced app-wide (src/wallet/useWalletGate.ts). */
export interface WalletGate {
  address: string | null;
  isConnected: boolean;
}
