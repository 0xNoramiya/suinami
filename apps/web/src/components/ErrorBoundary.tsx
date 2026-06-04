/**
 * ErrorBoundary — keeps one crashing screen from white-screening the whole app.
 *
 * Wrap a routed screen in this; if its subtree throws during render, the boundary
 * catches it and shows a branded "the tide pulled out" fallback instead of a blank
 * page (the TopBar + BottomNav live OUTSIDE the boundary, so the chrome survives
 * and the user can still navigate away).
 *
 * `resetKey` is the recovery hook: pass something that changes when the user moves
 * to a different view (e.g. the route). When it changes after an error, the
 * boundary clears itself so the new screen renders fresh. The fallback's Retry
 * button clears it in place for transient failures.
 *
 * This only catches RENDER/lifecycle errors. Async failures (rejected promises,
 * event handlers) never reach a boundary — those are surfaced by the global
 * handler in lib/globalErrors.ts.
 */
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Change this (e.g. on route change) to auto-clear a caught error. */
  resetKey?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for debugging / future telemetry. The fallback UI is the
    // user-facing signal, so we don't also toast here (no double notice).
    console.error("[ErrorBoundary] caught:", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    // A view change (resetKey changed) clears a previously-caught error so the
    // freshly-navigated screen gets a clean mount instead of the fallback.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error) {
      return <TidePulledOut error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

/* ---- branded fallback --------------------------------------------------- */

function TidePulledOut({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="grid h-full w-full place-items-center px-6 pb-28 pt-24">
      <div
        className="glass rise w-full max-w-sm rounded-3xl px-6 py-8 text-center"
        style={{ boxShadow: "0 24px 60px -24px rgba(0,0,0,0.7)" }}
        role="alert"
        aria-live="assertive"
      >
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}>
          {/* Ebbing-wave glyph. */}
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-abyss" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 16c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2" />
            <path d="M2 11c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2" opacity="0.5" />
          </svg>
        </div>

        <h2 className="font-display text-xl font-bold text-foam">The tide pulled out</h2>
        <p className="mx-auto mt-2 max-w-[16rem] text-sm leading-relaxed text-foam/55">
          This view hit an unexpected swell and couldn&rsquo;t render. The rest of the
          app is fine — try again, or ride to another tab.
        </p>

        {/* Dev-only: the actual error message, to speed local debugging. */}
        {import.meta.env.DEV ? (
          <p className="mt-3 break-words font-mono text-[11px] leading-snug text-coral/80">
            {error.message || String(error)}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-abyss transition-transform active:scale-95"
            style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)", minHeight: 44 }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-foam/70 transition-colors hover:text-foam"
            style={{ border: "var(--hairline)", minHeight: 44 }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- dev crash probe ---------------------------------------------------- */

declare global {
  interface Window {
    /** Dev-only: force a render error inside the boundary (CDP/console testing). */
    __suinamiCrash?: () => void;
  }
}

/**
 * Dev-only probe: renders nothing until `window.__suinamiCrash()` is called, then
 * throws on the next render so we can verify the ErrorBoundary + Retry path without
 * shipping any crash surface to production. Mirrors the `window.__suinamiToast`
 * affordance; tree-shaken out of prod builds (guarded by import.meta.env.DEV at
 * the call site, and a no-op otherwise).
 */
export function CrashProbe() {
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    window.__suinamiCrash = () => setBoom(true);
    return () => {
      delete window.__suinamiCrash;
    };
  }, []);
  if (boom) throw new Error("CrashProbe: forced render error (dev test)");
  return null;
}
