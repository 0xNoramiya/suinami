/**
 * TopBar — the app's frosted header: lowercase "suinami" wordmark (sui→aqua
 * gradient text + a small wave glyph) on the left, the wallet connect control
 * on the right. Floats over the full-bleed feed with a top scrim so the text
 * never sits on raw video, and respects the notch via `safe-top` / `safe-x`.
 */
import { ConnectControl } from "@/wallet";
import { cn } from "@/lib/cn";

interface TopBarProps {
  className?: string;
}

export function TopBar({ className }: TopBarProps) {
  return (
    <header
      className={cn(
        "safe-top safe-x fixed inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-3 pb-2",
        className,
      )}
      style={{
        // Top-down scrim keeps the wordmark legible over any frame underneath.
        backgroundImage:
          "linear-gradient(to bottom, rgba(10,20,40,0.7), rgba(10,20,40,0.25) 60%, transparent)",
      }}
    >
      <div className="flex items-center gap-2">
        {/* Wave glyph, tinted sui. */}
        <svg
          className="h-6 w-6 text-sui drop-shadow-[0_1px_4px_rgba(77,162,255,0.5)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2 12c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
          <path
            d="M2 17c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3"
            opacity={0.5}
          />
        </svg>

        {/* Wordmark: gradient sui→aqua clipped text, display face, lowercase. */}
        <span
          className="bg-gradient-to-r from-[var(--c-sui)] to-[var(--c-aqua)] bg-clip-text font-display text-xl font-bold lowercase tracking-tight text-transparent"
        >
          suinami
        </span>
      </div>

      <ConnectControl />
    </header>
  );
}
