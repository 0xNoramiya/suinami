/**
 * @suinami/ui — public barrel.
 *
 * Exposes the `cn` class-merge helper plus a couple of tiny, tree-shakeable
 * presentational primitives (React + clsx only). This file is intentionally
 * JSX-free: its `.ts` filename is fixed by package.json#exports, and JSX is
 * not permitted in `.ts` modules — so the components live in ./components
 * (a .tsx module) and are simply re-exported here.
 *
 * Design tokens: ./tokens.css (canonical) — the @theme mapping is mirrored in
 * apps/web/src/index.css.
 */
export { cn } from "./cn";
export type { ClassValue } from "./cn";

export { WaveGlyph, FrostedPanel } from "./components";
export type { WaveGlyphProps, FrostedPanelProps } from "./components";
