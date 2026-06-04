/**
 * PullWave — a cresting SVG wave pinned to the top of the feed for
 * pull-to-refresh. The crest height + curl are driven by `pull` (0..1+, where
 * 1 = release threshold): we morph the wave path via a sine-based control point
 * so the swell grows and the lip curls as the user drags down. When `refreshing`
 * the wave gently crashes/bobs in a loop until the refresh resolves.
 *
 * pointer-events-none. transform/opacity-friendly: the path `d` is recomputed in
 * JS (cheap, single element) and the bob is a `translateY` keyframe. Under
 * reduced-motion we drop the bob loop and show the static swell + a calm label.
 */
import { useReducedMotion } from "motion/react";
import type { PullWaveProps } from "@/feed/contracts";

const W = 100; // viewBox width (percentage-like units, preserveAspectRatio=none)
const MAX_H = 64; // px the band can occupy at full pull

/**
 * Build a smooth wave path filling the band from the top down to a crest whose
 * amplitude grows with `pull`. `phase` shifts the sine so the crest can travel
 * during the refreshing bob. The lip "curls" by easing the control points as
 * pull passes the release threshold.
 */
function wavePath(pull: number, phase: number): string {
  const p = Math.max(0, Math.min(1.4, pull));
  const amp = 6 + p * 16; // crest amplitude 6..~28
  const mid = MAX_H * 0.55 * Math.min(1, p); // baseline of the crest
  const curl = Math.max(0, p - 1) * 10; // extra lip past threshold

  // Three control points across the width, each offset by a sine of the phase.
  const y0 = mid - Math.sin(phase) * amp;
  const y1 = mid - Math.sin(phase + Math.PI) * (amp + curl);
  const y2 = mid - Math.sin(phase + Math.PI * 2) * amp;

  // A filled shape: start top-left, ride the crest via two quadratic curves,
  // then close down the right edge and back along the top.
  return [
    `M 0 ${y0.toFixed(2)}`,
    `Q ${W * 0.25} ${(y0 - amp).toFixed(2)} ${W * 0.5} ${y1.toFixed(2)}`,
    `Q ${W * 0.75} ${(y2 + amp).toFixed(2)} ${W} ${y2.toFixed(2)}`,
    `L ${W} 0 L 0 0 Z`,
  ].join(" ");
}

export function PullWave({ pull, refreshing }: PullWaveProps) {
  const reduce = useReducedMotion();
  const p = Math.max(0, pull);

  // Hidden entirely when idle (no pull, not refreshing) to avoid any overhead.
  if (p <= 0 && !refreshing) return null;

  const armed = p >= 1 || refreshing;
  // While refreshing we settle to a steady swell; otherwise track the live pull.
  const effective = refreshing ? Math.max(1, Math.min(p, 1.1)) : p;
  const path = wavePath(effective, 0);
  const opacity = Math.min(1, 0.35 + effective * 0.65);

  return (
    <div
      aria-hidden
      className="safe-top pointer-events-none fixed inset-x-0 top-0 z-40 overflow-hidden"
      style={{ height: MAX_H }}
    >
      <style>{pullKeyframes}</style>

      <div
        style={{
          // The whole band bobs while refreshing (translateY only).
          animation:
            refreshing && !reduce ? "suinami-wave-bob 1.6s ease-in-out infinite" : undefined,
          willChange: refreshing && !reduce ? "transform" : undefined,
          opacity,
          transition: reduce ? "none" : "opacity 160ms linear",
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${MAX_H}`}
          preserveAspectRatio="none"
          width="100%"
          height={MAX_H}
          className="block"
        >
          <defs>
            <linearGradient id="suinami-pullwave" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-sui)" />
              <stop offset="100%" stopColor="var(--c-aqua)" />
            </linearGradient>
          </defs>
          <path d={path} fill="url(#suinami-pullwave)" opacity={0.92} />
        </svg>
      </div>

      {/* Centered status pip: a droplet that fills as you approach release, then
          spins while refreshing. Sits just under the crest. */}
      <div className="absolute inset-x-0 top-2 flex justify-center">
        <div
          className="grid h-7 w-7 place-items-center rounded-full"
          style={{
            background: "var(--surface-blur)",
            boxShadow: armed ? "0 0 12px rgba(111,230,225,0.7)" : "none",
            transition: reduce ? "none" : "box-shadow 200ms ease",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width={16}
            height={16}
            className="text-foam"
            fill="currentColor"
            style={{
              animation:
                refreshing && !reduce
                  ? "suinami-wave-spin 1s linear infinite"
                  : undefined,
              transform: refreshing ? undefined : `scale(${0.6 + Math.min(1, p) * 0.4})`,
              opacity: 0.7 + Math.min(1, p) * 0.3,
            }}
          >
            <path d="M12 2.5C8 8 5.5 11.2 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 11.2 16 8 12 2.5Z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

const pullKeyframes = `
@keyframes suinami-wave-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(5px); }
}
@keyframes suinami-wave-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;
