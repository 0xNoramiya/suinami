/**
 * A single full-bleed feed card — the heart of the Suinami feed.
 *
 * Layering (bottom → top):
 *   1. Poster <img>      — painted INSTANTLY so there is never a black flash.
 *   2. <video>           — Walrus-hosted MP4 via a *typed* <source> (the Walrus
 *                          aggregator serves blobs with no Content-Type, so a
 *                          bare src= can refuse to play). Muted autoplay when
 *                          `active`; paused otherwise.
 *   3. TideBuffer        — rising-tide shimmer until the video actually plays.
 *   4. "washed away" 🌊  — frosted graceful error state (never a broken player).
 *   5. Gradient scrims   — top + bottom, so meta text stays legible over video.
 *   6. Tap layer         — single tap toggles play/pause (frosted glyph fades);
 *                          double tap anywhere → like-splash burst + onLike.
 *   7. Meta + RightRail  — @handle, expandable caption, action rail.
 *   8. Progress bar      — thin aqua bar pinned to the very bottom edge.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { LikeSplash, TideBuffer } from "@/fx";
import { RightRail } from "@/feed/RightRail";
import type { SplashBurst, VideoCardProps } from "@/feed/contracts";

/** ms window inside which a second tap counts as a double-tap. */
const DOUBLE_TAP_MS = 260;
/** A burst lives this long before it self-prunes from state. */
const BURST_TTL_MS = 900;

export function VideoCard({
  card,
  active,
  muted,
  onToggleMute,
  onLike,
  liked,
  onOpenGift,
  onOpenComments,
  onOpenProfile,
  commentCount,
}: VideoCardProps) {
  const reduce = useReducedMotion() ?? false;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Readiness: until the video is truly `playing` we keep the poster on top
  // (with the TideBuffer shimmer). `errored` flips on the graceful fallback.
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [errored, setErrored] = useState(false);

  // Caption expand + scrubber progress (0..1).
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(0);

  // Caption shows in FULL by default; the "more"/"less" toggle only appears when
  // the collapsed caption is actually clipped, so typical short captions are
  // shown outright with no truncation and no dangling "more".
  const captionRef = useRef<HTMLParagraphElement | null>(null);
  const [captionOverflow, setCaptionOverflow] = useState(false);
  useEffect(() => {
    const el = captionRef.current;
    if (!el || expanded) return;
    setCaptionOverflow(el.scrollHeight - el.clientHeight > 1);
  }, [card.caption, expanded]);

  // Center play/pause glyph that briefly fades in on a single tap.
  const [pulse, setPulse] = useState<null | "play" | "pause">(null);

  // Double-tap like splashes.
  const [bursts, setBursts] = useState<SplashBurst[]>([]);
  const burstId = useRef(0);
  const tapTimer = useRef<number | null>(null);

  // --- drive playback from `active` + reflect `muted` ---
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (active && !errored) {
      const p = v.play();
      if (p && typeof p.catch === "function") {
        // Autoplay can be rejected (policy / not-yet-loaded); poster stays.
        p.catch(() => undefined);
      }
    } else {
      v.pause();
    }
  }, [active, muted, errored]);

  // When a card scrolls away, rewind so it restarts cleanly next focus.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || active) return;
    setPlaying(false);
    // Soft rewind without yanking the buffer indicator on.
    try {
      v.currentTime = 0;
    } catch {
      /* some browsers throw before metadata — ignore */
    }
  }, [active]);

  // Cleanup any pending single-tap timer on unmount.
  useEffect(() => {
    return () => {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    };
  }, []);

  // --- <video> event wiring ---
  const onWaiting = useCallback(() => setBuffering(true), []);
  const onCanPlay = useCallback(() => setBuffering(false), []);
  const onPlaying = useCallback(() => {
    setBuffering(false);
    setErrored(false);
    setPlaying(true);
  }, []);
  const onPause = useCallback(() => setPlaying(false), []);
  const onError = useCallback(() => {
    setErrored(true);
    setBuffering(false);
    setPlaying(false);
  }, []);
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration || !Number.isFinite(v.duration)) return;
    setProgress(Math.min(1, v.currentTime / v.duration));
  }, []);

  // --- togglePlay (single center tap) ---
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || errored) return;
    if (v.paused) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
      setPulse("play");
    } else {
      v.pause();
      setPulse("pause");
    }
    // The glyph fades itself via AnimatePresence keyed on a fresh value.
    window.setTimeout(() => setPulse(null), 520);
  }, [errored]);

  // --- like at coordinates (double tap) ---
  const likeAt = useCallback(
    (x: number, y: number) => {
      const id = burstId.current++;
      setBursts((prev) => [...prev, { id, x, y }]);
      window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, BURST_TTL_MS);
      onLike(card.videoId);
    },
    [onLike, card.videoId],
  );

  // --- tap dispatcher: distinguish single vs double via a short timer ---
  const onTap = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (tapTimer.current !== null) {
        // Second tap within the window → double-tap (like), cancel the single.
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
        likeAt(x, y);
        return;
      }
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = null;
        togglePlay();
      }, DOUBLE_TAP_MS);
    },
    [likeAt, togglePlay],
  );

  return (
    <section
      className="relative h-[100dvh] w-full overflow-hidden bg-abyss"
      style={{ scrollSnapAlign: "start", touchAction: "pan-y" }}
      aria-label={`Video by @${card.handle}`}
    >
      {/* Ambient backdrop — a blurred, dimmed copy of the poster fills the whole page so
          the 9:16 stage's margins read as out-of-focus depth, never hard letterbox bars. */}
      {card.posterUrl ? (
        <img
          src={card.posterUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-2xl"
          style={{ opacity: 0.4 }}
          draggable={false}
        />
      ) : null}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-abyss/55" />

      {/* Centered 9:16 stage — the largest 9:16 rectangle that fits the viewport. Every
          video is 9:16, so it fills this box exactly: never distorted, never over-cropped,
          on any device aspect ratio (tall phone, wide desktop, foldable). Leftover viewport
          space becomes the ambient backdrop above. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          height: "min(100dvh, calc(100vw * 16 / 9))",
          width: "min(100vw, calc(100dvh * 9 / 16))",
        }}
      >
        <div className="relative h-full w-full overflow-hidden bg-abyss shadow-[0_0_60px_rgba(0,0,0,0.55)]">
      {/* 1. Poster — instant paint, no flash. */}
      {card.posterUrl ? (
        <img
          src={card.posterUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(160deg, var(--c-deep), var(--c-abyss))" }}
        />
      )}

      {/* 2. Video — typed source so the headerless Walrus blob plays. */}
      <video
        ref={videoRef}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
          playing ? "opacity-100" : "opacity-0",
        )}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        poster={card.posterUrl ?? undefined}
        onWaiting={onWaiting}
        onCanPlay={onCanPlay}
        onPlaying={onPlaying}
        onPause={onPause}
        onError={onError}
        onTimeUpdate={onTimeUpdate}
      >
        <source src={card.videoUrl} type="video/mp4" />
      </video>

      {/* 3. Buffering shimmer (over the poster, only while focused + not errored). */}
      {active && !errored ? <TideBuffer active={buffering && !playing} /> : null}

      {/* 4. Graceful error state — frosted, never a broken player. */}
      {errored ? (
        <div
          className="absolute inset-0 z-30 grid place-items-center backdrop-blur-xl"
          style={{ background: "var(--surface-blur)" }}
        >
          <div className="flex flex-col items-center gap-2 px-8 text-center">
            <span className="text-4xl" aria-hidden>
              🌊
            </span>
            <p className="font-display text-base font-semibold text-foam">
              this wave washed away
            </p>
            <p className="text-xs text-foam/60">the blob couldn&apos;t be played</p>
          </div>
        </div>
      ) : null}

      {/* 5. Top + bottom gradient scrims for text legibility. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/55 to-black/0"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-black/60 to-black/0"
      />

      {/* 6. Tap layer — fills the card; single = play/pause, double = like. */}
      <div
        className="absolute inset-0 z-20"
        onPointerUp={onTap}
        role="presentation"
      />

      {/* Center play/pause pulse glyph (fades out). */}
      <AnimatePresence>
        {pulse ? (
          <motion.div
            key={`pulse-${burstId.current}-${pulse}`}
            className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
            initial={reduce ? { opacity: 0.9 } : { opacity: 0, scale: 0.7 }}
            animate={reduce ? { opacity: 0.9 } : { opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.25 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <span
              className="grid h-20 w-20 place-items-center rounded-full backdrop-blur-md"
              style={{ background: "var(--surface-blur)" }}
            >
              {pulse === "play" ? (
                <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9 text-foam" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-9 w-9 text-foam" fill="currentColor" aria-hidden>
                  <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                </svg>
              )}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Like splash bursts (double-tap droplets). */}
      <LikeSplash bursts={bursts} />

      {/* Mute toggle — top-right, frosted. */}
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="safe-top absolute right-3 top-3 z-30 grid h-11 w-11 place-items-center rounded-full text-foam backdrop-blur-md"
        style={{ background: "var(--surface-blur)" }}
      >
        {muted ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="m23 9-6 6M17 9l6 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        )}
      </button>

      {/* 7a. Bottom-left meta: @handle + caption. Padding clears the fixed bottom
          nav + safe area in ONE value (a separate `safe-bottom` would override the
          nav clearance, sinking the caption behind the nav on full-bleed screens). */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
        <div className="max-w-[74%]">
          <button
            type="button"
            onClick={() => onOpenProfile(card.creator)}
            className="font-display text-base font-semibold text-foam drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
          >
            @{card.handle}
          </button>
          <p
            ref={captionRef}
            className={cn(
              "mt-1 text-sm leading-snug text-foam/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]",
              !expanded && "line-clamp-4",
            )}
          >
            {card.caption}
          </p>
          {captionOverflow ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-xs font-medium text-foam/55"
            >
              {expanded ? "less" : "more"}
            </button>
          ) : null}
        </div>
      </div>

      {/* 7b. Right action rail. */}
      <RightRail
        card={card}
        liked={liked}
        likeCount={card.likeCount + (liked ? 1 : 0)}
        commentCount={commentCount}
        playing={playing}
        onLike={() => onLike(card.videoId)}
        onOpenGift={() => onOpenGift(card)}
        onOpenComments={() => onOpenComments(card)}
        onOpenProfile={() => onOpenProfile(card.creator)}
        onShare={() => {
          const url = window.location.href;
          const payload = {
            title: `@${card.handle} on Suinami`,
            text: card.caption,
            url,
          };
          if (typeof navigator.share === "function") {
            navigator.share(payload).catch(() => undefined);
          } else if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(url).catch(() => undefined);
          }
        }}
      />

      {/* 8. Progress bar pinned to the very bottom edge. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 z-30 h-[3px] bg-foam/10">
        <div
          className="h-full origin-left bg-aqua"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
        </div>
      </div>
    </section>
  );
}
