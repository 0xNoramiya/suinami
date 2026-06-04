/**
 * DepthGauge — a thin vertical "depth gauge" pinned to the right screen edge.
 *
 * Fills top→bottom with an aqua→sui gradient as the viewer dives deeper through
 * the feed (`progress` 0..1). Purely decorative + non-interactive. We scale a
 * gradient bar on the Y axis (transform-only) so the fill is GPU-cheap; under
 * reduced-motion the same bar is shown without the eased transition.
 */
import { useReducedMotion } from "motion/react";
import type { DepthGaugeProps } from "@/feed/contracts";

/** Clamp to the valid 0..1 range so a stray value never overflows the track. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function DepthGauge({ progress }: DepthGaugeProps) {
  const reduce = useReducedMotion();
  const p = clamp01(progress);

  return (
    <div
      aria-hidden
      className="safe-top safe-bottom pointer-events-none fixed right-0 top-0 z-30 flex h-[100dvh] w-[3px] items-stretch py-3"
    >
      {/* Track: faint channel the fill descends through. */}
      <div className="relative w-full overflow-hidden rounded-full bg-foam/10">
        {/* Fill: anchored to the top, scaled down toward 0 → "shallower". */}
        <div
          className="absolute inset-x-0 top-0 h-full origin-top rounded-full"
          style={{
            background:
              "linear-gradient(to bottom, var(--c-aqua), var(--c-sui))",
            transform: `scaleY(${p})`,
            transition: reduce ? "none" : "transform 320ms cubic-bezier(0.22,1,0.36,1)",
            willChange: "transform",
            boxShadow: "0 0 6px rgba(111,230,225,0.5)",
          }}
        />
      </div>
    </div>
  );
}
