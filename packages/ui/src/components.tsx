/**
 * @suinami/ui — components.tsx
 *
 * Tiny, tree-shakeable presentational primitives (React + clsx only). JSX lives
 * here in a .tsx module; the public barrel (./index) re-exports these so that
 * index.ts stays JSX-free (its filename is fixed by package.json#exports).
 *
 * Components reference the canonical design tokens from ./tokens.css
 * (the @theme mapping is mirrored in apps/web/src/index.css).
 */
import type { CSSProperties, HTMLAttributes, ReactNode, SVGProps } from "react";
import { cn } from "./cn";

/* ------------------------------------------------------------------------- */
/* WaveGlyph — minimal inline SVG wave mark, inherits currentColor.          */
/* ------------------------------------------------------------------------- */

export interface WaveGlyphProps extends SVGProps<SVGSVGElement> {
  /** Square edge length in px (sets both width & height). Defaults to 24. */
  size?: number;
}

/**
 * WaveGlyph — the Suinami wave icon. Stroke uses `currentColor`, so tint it by
 * setting `color` (e.g. `style={{ color: "var(--c-sui)" }}` or a text-color
 * utility class). Fully presentational and tree-shakeable.
 */
export function WaveGlyph({
  size = 24,
  className,
  "aria-label": ariaLabel,
  ...rest
}: WaveGlyphProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn("suinami-wave-glyph", className)}
      {...rest}
    >
      <path d="M2 8c2.5 0 2.5 3 5 3s2.5-3 5-3 2.5 3 5 3 2.5-3 5-3" />
      <path d="M2 16c2.5 0 2.5 3 5 3s2.5-3 5-3 2.5 3 5 3 2.5-3 5-3" />
    </svg>
  );
}

/* ------------------------------------------------------------------------- */
/* FrostedPanel — translucent, blurred surface using the water palette.      */
/* ------------------------------------------------------------------------- */

export interface FrostedPanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "color"> {
  /** Panel contents. */
  children?: ReactNode;
}

/**
 * FrostedPanel — a div with a backdrop-blur "frosted glass" surface. Relies on
 * the `--surface-blur` token (mirrored in apps/web theme). Includes Tailwind
 * utility classes AND inline fallbacks so it renders on-palette even without
 * Tailwind present in the consuming app.
 */
export function FrostedPanel({
  className,
  style,
  children,
  ...rest
}: FrostedPanelProps): ReactNode {
  const baseStyle: CSSProperties = {
    background: "var(--surface-blur)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius: "var(--radius-lg, 16px)",
    border: "1px solid rgba(234, 246, 255, 0.08)",
    color: "var(--c-text)",
    ...style,
  };

  return (
    <div
      className={cn(
        "suinami-frosted-panel rounded-2xl border backdrop-blur-md",
        className,
      )}
      style={baseStyle}
      {...rest}
    >
      {children}
    </div>
  );
}
