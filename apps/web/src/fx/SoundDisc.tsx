/**
 * SoundDisc — a small spinning record/disc that turns while a card is playing.
 *
 * Pure presentational; the rail/card passes `playing`. We spin a vinyl-style
 * disc with a CSS keyframe animation and toggle `animation-play-state` so the
 * disc freezes (instead of resetting) when paused. Under reduced-motion we keep
 * the disc static and simply swap the centre glyph to convey state.
 *
 * GPU-cheap: a single `transform: rotate()` animation on one element.
 */
import { useReducedMotion } from "motion/react";
import type { SoundDiscProps } from "@/feed/contracts";
import { cn } from "@/lib/cn";

export function SoundDisc({ playing, className }: SoundDiscProps) {
  const reduce = useReducedMotion();
  const spin = playing && !reduce;

  return (
    <div
      aria-hidden
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-full",
        className,
      )}
    >
      {/* Inline keyframes scoped to this component (idempotent if mounted N times). */}
      <style>{discKeyframes}</style>

      {/* The vinyl disc: dark body with concentric aqua grooves + a centre label. */}
      <div
        className="relative h-9 w-9 rounded-full border border-foam/20 shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%," +
            " var(--c-sui) 0 18%," +
            " var(--c-abyss) 19% 30%," +
            " var(--c-deep) 31% 46%," +
            " var(--c-abyss) 47% 62%," +
            " var(--c-deep) 63% 100%)",
          // Animation always declared; play-state gates motion so it freezes in place.
          animation: "suinami-disc-spin 6s linear infinite",
          animationPlayState: spin ? "running" : "paused",
          willChange: spin ? "transform" : undefined,
        }}
      >
        {/* Spindle hole. */}
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foam/80" />
      </div>

      {/* Tiny musical-note badge so the control reads as "sound" at a glance. */}
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 text-aqua drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
        fill="currentColor"
      >
        <path d="M9 17a3 3 0 1 1-2-2.83V5l11-2v9.17A3 3 0 1 1 16 12V7L9 8.4Z" />
      </svg>
    </div>
  );
}

const discKeyframes = `
@keyframes suinami-disc-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;
