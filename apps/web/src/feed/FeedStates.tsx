/**
 * Feed non-content states: loading skeleton, empty (no on-chain videos yet), and
 * the end-of-feed "seabed" sentinel. All full-bleed, all on-brand (glass + foam/
 * aqua + reduced-motion-safe), so the pager never shows a blank frame or a jarring
 * flash of sample data while the real ['feed'] query is in flight.
 */
import { motion, useReducedMotion } from "motion/react";

/* ---- loading skeleton --------------------------------------------------- */

/**
 * First-paint placeholder: a single full-viewport card that mimics the VideoCard
 * layout (stage + caption + right rail) with a shimmer sweep, shown while the
 * first feed fetch resolves — instead of a blank screen or sample content.
 */
export function FeedSkeleton() {
  return (
    <div
      data-feed-state="loading"
      className="relative grid h-[100dvh] w-full place-items-center overflow-hidden bg-abyss px-4"
      aria-busy="true"
      aria-label="Loading the tide"
    >
      {/* The 9:16 stage block. */}
      <div
        className="shimmer relative aspect-[9/16] w-full max-w-[min(100%,calc(100dvh*0.5625))] overflow-hidden rounded-3xl"
        style={{
          background:
            "linear-gradient(160deg, rgba(77,162,255,0.10), rgba(14,42,71,0.35) 60%, rgba(5,17,33,0.6))",
          border: "var(--hairline)",
        }}
      >
        {/* Caption skeleton lines, bottom-left. */}
        <div className="absolute bottom-6 left-5 right-20 flex flex-col gap-2.5">
          <div className="shimmer h-3.5 w-24 rounded-full bg-foam/10" />
          <div className="shimmer h-3 w-[80%] rounded-full bg-foam/10" />
          <div className="shimmer h-3 w-[55%] rounded-full bg-foam/10" />
        </div>
        {/* Right-rail action skeletons. */}
        <div className="absolute bottom-6 right-4 flex flex-col items-center gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="shimmer h-11 w-11 rounded-full bg-foam/10" />
              <div className="shimmer h-2 w-6 rounded-full bg-foam/10" />
            </div>
          ))}
        </div>
      </div>

      {/* A quiet "tuning in" line so the wait reads as intentional. */}
      <p className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-foam/35">
        reading the tide…
      </p>
    </div>
  );
}

/* ---- empty (no on-chain videos) ----------------------------------------- */

/**
 * Shown when the API responds successfully but there are NO on-chain videos yet
 * (a fresh deploy) — an invitation to post the first wave, not a broken pager.
 */
export function FeedEmpty({
  onOpenUpload,
  onRefresh,
  refreshing,
}: {
  onOpenUpload?: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div
      data-feed-state="empty"
      className="grid h-[100dvh] w-full place-items-center bg-abyss px-6"
    >
      <div className="glass rise w-full max-w-sm rounded-3xl px-6 py-9 text-center">
        <WaveBadge />
        <h2 className="mt-5 font-display text-xl font-bold text-foam">The tide is still</h2>
        <p className="mx-auto mt-2 max-w-[17rem] text-sm leading-relaxed text-foam/55">
          No waves on-chain yet. Be the first to post — your video lands on Walrus,
          your moment lives on Sui.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {onOpenUpload ? (
            <button
              type="button"
              onClick={onOpenUpload}
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-abyss transition-transform active:scale-95"
              style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)", minHeight: 44 }}
            >
              Post a wave
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-foam/70 transition-colors hover:text-foam disabled:opacity-50"
            style={{ border: "var(--hairline)", minHeight: 44 }}
          >
            {refreshing ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- end-of-feed sentinel ----------------------------------------------- */

/**
 * The seabed: a full-viewport snap section after the last video. Reaching it means
 * the user caught up with the tide; offers a refresh that reshuffles + snaps back
 * to the top (the same gesture as pull-to-refresh).
 */
export function FeedEndCard({
  count,
  onRefresh,
  refreshing,
}: {
  count: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      data-feed-state="end"
      className="grid h-[100dvh] w-full snap-start place-items-center bg-abyss px-6"
    >
      <motion.div
        className="glass w-full max-w-sm rounded-3xl px-6 py-9 text-center"
        initial={reduce ? false : { opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: false, amount: 0.4 }}
        transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <WaveBadge settled />
        <h2 className="mt-5 font-display text-xl font-bold text-foam">
          You&rsquo;ve reached the seabed
        </h2>
        <p className="mx-auto mt-2 max-w-[17rem] text-sm leading-relaxed text-foam/55">
          Caught up with the tide — {count} {count === 1 ? "wave" : "waves"} ridden.
          Pull a fresh set to ride again.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="mt-6 rounded-full px-6 py-2.5 text-sm font-semibold text-abyss transition-transform active:scale-95 disabled:opacity-50"
          style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)", minHeight: 44 }}
        >
          {refreshing ? "Pulling…" : "Ride again ↑"}
        </button>
      </motion.div>
    </div>
  );
}

/* ---- shared glyph ------------------------------------------------------- */

function WaveBadge({ settled }: { settled?: boolean }) {
  return (
    <div
      className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"
      style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-abyss" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 13c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2" />
        {settled ? null : (
          <path d="M2 8c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2" opacity="0.5" />
        )}
        {settled ? <path d="M2 18c2.2 0 2.2-1.4 4.4-1.4s2.2 1.4 4.4 1.4 2.2-1.4 4.4-1.4 2.2 1.4 4.4 1.4" opacity="0.45" /> : null}
      </svg>
    </div>
  );
}
