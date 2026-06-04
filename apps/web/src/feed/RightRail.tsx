/**
 * Right action rail for a feed card — TikTok/Reels-style vertical stack pinned
 * bottom-right: avatar, like, gift, comment, share, and the spinning sound disc.
 *
 * Counts use `.tabular` (tabular-nums) so they don't jitter as they change.
 * Every tappable element clears the 44px minimum hit target. Decorative
 * tap-scale is disabled under `prefers-reduced-motion`.
 */
import { motion, useReducedMotion } from "motion/react";
import { mistToSui } from "@suinami/shared";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/Avatar";
import { SoundDisc } from "@/fx";
import type { RightRailProps } from "@/feed/contracts";

/** Compact a count: 20431 -> "20.4K", 1_284_000 -> "1.3M". */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Stub comment count derived deterministically from likes (no chain read yet). */
function stubComments(likeCount: number): number {
  return Math.max(1, Math.round(likeCount * 0.18));
}

export function RightRail({
  card,
  liked,
  likeCount,
  playing,
  onLike,
  onOpenGift,
  onOpenComments,
  onOpenProfile,
  onShare,
  commentCount,
}: RightRailProps) {
  const reduce = useReducedMotion() ?? false;
  const tipSui = mistToSui(card.tipTotal).toFixed(2);

  return (
    <div className="pointer-events-none absolute bottom-0 right-0 z-20 flex flex-col items-center gap-5 px-2 pb-[calc(env(safe-area-inset-bottom,0px)+6.5rem)]">
      {/* Avatar — real Walrus image when present, else gradient + initial. */}
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={`Open @${card.handle}'s profile`}
        className="pointer-events-auto grid min-h-[44px] min-w-[44px] place-items-center"
      >
        <motion.span
          whileTap={reduce ? undefined : { scale: 0.9 }}
          transition={{ type: "spring", stiffness: 600, damping: 20 }}
          className="grid place-items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
        >
          <Avatar
            handle={card.handle}
            size={44}
            avatarUrl={card.avatarUrl}
            gradient="linear-gradient(150deg, var(--c-sui), var(--c-aqua))"
            ring="rgba(234,246,255,0.85)"
          />
        </motion.span>
      </button>

      {/* Like — filled coral heart when liked, outline foam otherwise. */}
      <RailAction
        label={compact(likeCount)}
        onPress={onLike}
        reduce={reduce}
        ariaLabel={liked ? "Unlike" : "Like"}
        ariaPressed={liked}
        glyph={
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "h-8 w-8 transition-colors",
              liked ? "text-coral" : "text-foam",
            )}
            fill={liked ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M19 14c1.5-1.5 3-3.2 3-5.5A3.5 3.5 0 0 0 12 6 3.5 3.5 0 0 0 2 8.5C2 10.8 3.5 12.5 5 14l7 7Z" />
          </svg>
        }
      />

      {/* Gift — 🎁 + lifetime tip total in SUI. */}
      <RailAction
        label={tipSui}
        onPress={onOpenGift}
        reduce={reduce}
        ariaLabel="Send a gift"
        glyph={<span className="text-[26px] leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">🎁</span>}
      />

      {/* Comment — opens the thread; count is real once loaded, else a stub. */}
      <RailAction
        label={compact(commentCount ?? stubComments(card.likeCount))}
        onPress={onOpenComments}
        reduce={reduce}
        ariaLabel="Comments"
        glyph={<span className="text-[24px] leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">💬</span>}
      />

      {/* Share. */}
      <RailAction
        label="Share"
        onPress={onShare}
        reduce={reduce}
        ariaLabel="Share"
        glyph={
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7 text-foam"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
            <path d="M16 6l-4-4-4 4" />
            <path d="M12 2v13" />
          </svg>
        }
      />

      {/* Spinning sound disc — visualizes playing state. */}
      <div className="pointer-events-auto mt-1">
        <SoundDisc playing={playing} />
      </div>
    </div>
  );
}

interface RailActionProps {
  glyph: React.ReactNode;
  label: string;
  reduce: boolean;
  ariaLabel: string;
  ariaPressed?: boolean;
  onPress?: () => void;
}

function RailAction({ glyph, label, reduce, ariaLabel, ariaPressed, onPress }: RailActionProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className="pointer-events-auto flex min-h-[44px] min-w-[44px] flex-col items-center gap-1"
    >
      <motion.span
        whileTap={reduce ? undefined : { scale: 1.22 }}
        transition={{ type: "spring", stiffness: 600, damping: 16 }}
        className="grid h-9 w-9 place-items-center"
      >
        {glyph}
      </motion.span>
      <span className="tabular text-[11px] font-semibold leading-none text-foam drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
        {label}
      </span>
    </button>
  );
}
