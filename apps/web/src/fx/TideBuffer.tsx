/**
 * TideBuffer — a rising water-line shimmer shown over the poster WHILE the
 * video buffers. An aqua gradient band sweeps upward (translateY animation) plus
 * a soft horizontal sheen, evoking the tide rising to "fill" the frame.
 *
 * Renders nothing when !active. absolute inset-0, pointer-events-none. Under
 * reduced-motion we drop the sweep and show a single static tide line so the
 * buffering state is still legible without decorative movement.
 */
import { useReducedMotion } from "motion/react";
import type { TideBufferProps } from "@/feed/contracts";

export function TideBuffer({ active }: TideBufferProps) {
  const reduce = useReducedMotion();
  if (!active) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{tideKeyframes}</style>

      {/* Dim wash so the poster reads as "loading" rather than final. */}
      <div className="absolute inset-0 bg-abyss/30" />

      {reduce ? (
        // Static fallback: one calm tide line near the lower third.
        <div
          className="absolute inset-x-0 bottom-[34%] h-px"
          style={{
            background:
              "linear-gradient(to right, transparent, var(--c-aqua), transparent)",
            opacity: 0.7,
          }}
        />
      ) : (
        <>
          {/* Rising tide band: a soft aqua glow that travels bottom→top, loops. */}
          <div
            className="absolute inset-x-0 bottom-0 h-2/3"
            style={{
              background:
                "linear-gradient(to top," +
                " rgba(111,230,225,0.32) 0%," +
                " rgba(77,162,255,0.16) 40%," +
                " transparent 100%)",
              animation: "suinami-tide-rise 1.9s cubic-bezier(0.4,0,0.2,1) infinite",
              willChange: "transform, opacity",
            }}
          />
          {/* Crest line riding the top of the band for a defined "water line". */}
          <div
            className="absolute inset-x-0 bottom-0 h-px"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--c-aqua), transparent)",
              animation: "suinami-tide-line 1.9s cubic-bezier(0.4,0,0.2,1) infinite",
              willChange: "transform, opacity",
            }}
          />
          {/* Horizontal sheen sweeping across, adds shimmer to the surface. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(234,246,255,0.14) 50%, transparent 70%)",
              backgroundSize: "220% 100%",
              animation: "suinami-tide-sheen 2.2s linear infinite",
              willChange: "background-position",
            }}
          />
        </>
      )}
    </div>
  );
}

const tideKeyframes = `
@keyframes suinami-tide-rise {
  0%   { transform: translateY(40%); opacity: 0.25; }
  55%  { opacity: 0.85; }
  100% { transform: translateY(-12%); opacity: 0; }
}
@keyframes suinami-tide-line {
  0%   { transform: translateY(0%); opacity: 0; }
  20%  { opacity: 0.9; }
  100% { transform: translateY(-360%); opacity: 0; }
}
@keyframes suinami-tide-sheen {
  from { background-position: 120% 0; }
  to   { background-position: -120% 0; }
}
`;
