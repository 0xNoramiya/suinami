/**
 * LikeSplash — heart-burst feedback for likes (double-tap / rail heart).
 *
 * The PARENT owns the `bursts[]` array: it pushes a {id,x,y} on like and removes
 * it after the burst self-fades (~700ms). For each burst we render, anchored at
 * (x, y):
 *   • a coral heart that springs 0 → 1.2 → 1, then fades + drifts up, and
 *   • 6–10 aqua/foam droplet particles flung on DETERMINISTIC arcs.
 *
 * Determinism: angle + distance + size per particle are derived from the burst
 * id and the particle index (a cheap hash), so there is NO Math.random in
 * render — the same burst always animates identically (important for an exit
 * animation that may re-run, and for predictable, jitter-free visuals).
 *
 * position:absolute, pointer-events-none. Under reduced-motion we skip the
 * particle spray and show a brief static heart so the like still registers.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { LikeSplashProps, SplashBurst } from "@/feed/contracts";

/** Number of droplets in a burst — varied per-burst but bounded to 6..10. */
function dropletCount(id: number): number {
  return 6 + (Math.abs(id) % 5); // 6..10
}

/**
 * Deterministic pseudo-random in [0,1) from two integer seeds. A small integer
 * hash (xorshift-ish) — stable, no allocations, no Math.random.
 */
function rand(seed: number, salt: number): number {
  let h = (seed * 374761393 + salt * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

interface Droplet {
  dx: number;
  dy: number;
  size: number;
  delay: number;
  coral: boolean;
}

/** Compute the fling vector + look for every droplet of a burst, deterministically. */
function dropletsFor(id: number): Droplet[] {
  const n = dropletCount(id);
  const out: Droplet[] = [];
  for (let i = 0; i < n; i++) {
    // Spread evenly around the circle, nudged by a stable jitter, biased upward.
    const base = (i / n) * Math.PI * 2;
    const jitter = (rand(id, i) - 0.5) * 0.8;
    const angle = base + jitter - Math.PI / 2; // -90° bias → favours upward fling
    const distance = 34 + rand(id, i + 101) * 30; // 34..64px
    out.push({
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      size: 4 + rand(id, i + 202) * 4, // 4..8px
      delay: rand(id, i + 303) * 0.05, // up to 50ms stagger
      coral: i % 3 === 0,
    });
  }
  return out;
}

export function LikeSplash({ bursts }: LikeSplashProps) {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      <AnimatePresence>
        {bursts.map((b) => (
          <Burst key={b.id} burst={b} reduce={reduce ?? false} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Burst({ burst, reduce }: { burst: SplashBurst; reduce: boolean }) {
  const droplets = reduce ? [] : dropletsFor(burst.id);

  return (
    <div
      className="absolute"
      style={{ left: burst.x, top: burst.y, transform: "translate(-50%, -50%)" }}
    >
      {/* Droplet particles flung on their deterministic arcs. */}
      {droplets.map((d, i) => (
        <motion.span
          key={i}
          className="absolute left-0 top-0 rounded-full"
          style={{
            width: d.size,
            height: d.size,
            marginLeft: -d.size / 2,
            marginTop: -d.size / 2,
            background: d.coral ? "var(--c-coral)" : "var(--c-aqua)",
            boxShadow: "0 0 6px rgba(111,230,225,0.6)",
            willChange: "transform, opacity",
          }}
          initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
          animate={{
            x: d.dx,
            y: d.dy,
            scale: [0.4, 1, 0.2],
            opacity: [0, 1, 0],
          }}
          transition={{ duration: 0.7, delay: d.delay, ease: "easeOut" }}
        />
      ))}

      {/* The heart: springs in, then drifts up and fades. */}
      <motion.span
        className="absolute left-0 top-0 block text-coral drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
        style={{ marginLeft: -22, marginTop: -22, willChange: "transform, opacity" }}
        initial={reduce ? { scale: 1, opacity: 1, y: 0 } : { scale: 0, opacity: 0, y: 0 }}
        animate={
          reduce
            ? { scale: 1, opacity: [1, 1, 0], y: 0 }
            : { scale: [0, 1.2, 1, 1], opacity: [0, 1, 1, 0], y: [0, 0, -8, -26] }
        }
        transition={
          reduce
            ? { duration: 0.5 }
            : { duration: 0.7, times: [0, 0.28, 0.55, 1], ease: "easeOut" }
        }
      >
        <svg viewBox="0 0 24 24" width={44} height={44} fill="currentColor" aria-hidden>
          <path d="M19 14c1.5-1.5 3-3.2 3-5.5A3.5 3.5 0 0 0 12 6 3.5 3.5 0 0 0 2 8.5C2 10.8 3.5 12.5 5 14l7 7Z" />
        </svg>
      </motion.span>
    </div>
  );
}
