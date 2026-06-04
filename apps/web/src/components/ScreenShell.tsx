/**
 * Shared shell for the non-feed screens (Tide Charts / Upload / Profile). Gives
 * every screen the same abyssal atmosphere, a staggered editorial header, and
 * consistent spacing that clears the fixed TopBar and BottomNav. This is the
 * cohesion anchor — screens drop their content in and inherit the design language.
 */
import type { CSSProperties, ReactNode } from "react";
import { Abyss } from "@/components/Abyss";

interface ScreenShellProps {
  /** Big editorial title (font-display). */
  title: string;
  /** Mono eyebrow above the title (uppercase, tracked). */
  kicker?: string;
  subtitle?: string;
  /** Optional element rendered at the top-right of the header (e.g. a toggle). */
  action?: ReactNode;
  children: ReactNode;
}

const delay = (ms: number): CSSProperties => ({ "--d": `${ms}ms` }) as CSSProperties;

export function ScreenShell({ title, kicker, subtitle, action, children }: ScreenShellProps) {
  return (
    <section className="relative h-full w-full overflow-y-auto no-scrollbar">
      <Abyss />
      <div className="safe-x relative z-10 mx-auto w-full max-w-md px-5 pb-28 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))]">
        <header className="mb-7 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {kicker && (
              <p
                className="rise mb-1 font-mono text-[11px] uppercase tracking-[0.3em] text-aqua/75"
                style={delay(40)}
              >
                {kicker}
              </p>
            )}
            <h1
              className="rise font-display text-[2.6rem] font-extrabold leading-[0.92] tracking-tight text-foam"
              style={delay(90)}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="rise mt-2 text-sm leading-snug text-foam/60" style={delay(150)}>
                {subtitle}
              </p>
            )}
          </div>
          {action && (
            <div className="rise shrink-0" style={delay(150)}>
              {action}
            </div>
          )}
        </header>
        <div className="rise" style={delay(220)}>
          {children}
        </div>
      </div>
    </section>
  );
}
