/**
 * Avatar — one creator-identity element used across the feed, leaderboard and
 * profile. Renders the REAL Walrus avatar image when `avatarUrl` is present
 * (square, lazy, alt'd, object-cover), and gracefully falls back to a
 * deterministic per-handle gradient + initial when there's no avatar OR the image
 * fails to load (e.g. a pruned blob). Keeping this in one place means every
 * surface shows the same identity, and wiring real avatars is a one-line change.
 *
 * Ring options: `true` → aqua glow (own/hero), a color string → a tinted glow
 * ring (e.g. a leaderboard medal), falsy → a hairline.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Deterministic per-handle hue so each fallback gradient is its own identity. */
function handleHue(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i += 1) h = (h * 31 + handle.charCodeAt(i)) % 360;
  return h;
}

export interface AvatarProps {
  handle: string;
  /** Pixel diameter. */
  size: number;
  /** Real avatar image URL (Walrus aggregator); null/undefined → gradient. */
  avatarUrl?: string | null;
  /** true → aqua glow ring; a CSS color → tinted ring; falsy → hairline. */
  ring?: boolean | string;
  /** Override the fallback gradient (e.g. the feed rail's fixed sui→aqua). */
  gradient?: string;
  className?: string;
}

export function Avatar({ handle, size, avatarUrl, ring = false, gradient, className }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(avatarUrl) && !imgFailed;
  const letter = (handle[0] ?? "?").toUpperCase();
  const fallbackBg =
    gradient ?? `linear-gradient(140deg, hsl(${handleHue(handle)} 80% 66%), var(--c-sui))`;

  const ringColor = typeof ring === "string" ? ring : ring ? "var(--c-aqua)" : null;
  const border = ringColor
    ? `1px solid ${typeof ring === "string" ? ring : "rgba(234,246,255,0.28)"}`
    : "var(--hairline)";
  const boxShadow = ringColor
    ? typeof ring === "string"
      ? `0 0 0 2px ${ring}, 0 0 18px -2px ${ring}`
      : "var(--glow-aqua)"
    : undefined;

  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: showImg ? "var(--c-deep)" : fallbackBg,
        border,
        boxShadow,
      }}
    >
      {showImg ? (
        <img
          src={avatarUrl as string}
          alt={`@${handle} avatar`}
          loading="lazy"
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span
          className="font-display font-extrabold text-abyss"
          style={{ fontSize: size * 0.42, lineHeight: 1 }}
          aria-hidden
        >
          {letter}
        </span>
      )}
    </span>
  );
}
