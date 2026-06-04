/**
 * Abyssal atmosphere — layered, slowly-drifting bioluminescent caustics + a film
 * grain overlay. Sits BEHIND screen content (-z-10), pointer-events-none, and is
 * GPU-cheap (transform/opacity only). Reduced-motion freezes the drift.
 *
 * This is what keeps the non-feed screens from reading as flat "AI dark mode":
 * there is always depth, light, and a little texture moving under the glass.
 */
import type { CSSProperties } from "react";
import { useReducedMotion } from "motion/react";

const blob = (
  color: string,
  dx: string,
  dy: string,
  dur: string,
): CSSProperties =>
  ({
    background: `radial-gradient(circle, ${color}, transparent 66%)`,
    "--dx": dx,
    "--dy": dy,
    "--dur": dur,
  }) as CSSProperties;

export function Abyss({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const drift = reduce ? "" : "drift";
  return (
    <div
      aria-hidden
      className={`grain pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className ?? ""}`}
    >
      {/* Deep vertical base — abyss fading to black at the seabed. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(135% 95% at 50% -12%, #103154 0%, #0a1428 52%, #060d1b 100%)",
        }}
      />
      <div
        className={`absolute -left-1/4 -top-[12%] h-[62vh] w-[62vh] rounded-full blur-[90px] ${drift}`}
        style={blob("rgba(77,162,255,0.30)", "8%", "6%", "28s")}
      />
      <div
        className={`absolute -right-[18%] top-[18%] h-[58vh] w-[58vh] rounded-full blur-[90px] ${drift}`}
        style={blob("rgba(111,230,225,0.22)", "-7%", "9%", "34s")}
      />
      <div
        className={`absolute -bottom-[16%] left-[18%] h-[52vh] w-[52vh] rounded-full blur-[100px] ${drift}`}
        style={blob("rgba(77,162,255,0.16)", "6%", "-8%", "42s")}
      />
    </div>
  );
}
