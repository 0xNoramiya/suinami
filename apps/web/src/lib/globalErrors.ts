/**
 * Global async-failure surfacing.
 *
 * React ErrorBoundaries only catch errors thrown during render/lifecycle. The
 * other half — rejected promises and errors in event handlers / timers — never
 * reach a boundary and would otherwise fail silently. `useGlobalErrorHandlers()`
 * attaches window `unhandledrejection` + `error` listeners and surfaces genuinely
 * unexpected failures through the existing Toast system, so the user gets a clear
 * signal instead of a dead button.
 *
 * It deliberately stays quiet for EXPECTED noise: wallet cancellations, our own
 * concurrency guard, connect-wallet prompts, and the benign ResizeObserver loop
 * warning. Handled flows (e.g. FeedScreen's like/gift try/catch) already toast
 * their own errors and never become "unhandled", so this won't double-notify.
 */
import { useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";

/** Substrings (lower-cased) we treat as expected/benign — never toasted. */
const IGNORE = [
  "resizeobserver", // benign layout-loop browser warning
  "user rejected", // wallet cancel
  "user denied",
  "rejected from user",
  "request rejected",
  "cancelled",
  "canceled",
  "already in progress", // our own write concurrency guard
  "connect a wallet", // expected gating prompt
  "script error", // opaque cross-origin error — no actionable detail
] as const;

const MAX_LEN = 140;
const DEDUPE_MS = 4000;

/** Pull a human string out of whatever was thrown/rejected. */
function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name;
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object") {
    const m = (reason as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Something went wrong.";
}

function isIgnorable(msg: string): boolean {
  const low = msg.toLowerCase();
  return msg.trim().length === 0 || IGNORE.some((s) => low.includes(s));
}

export function useGlobalErrorHandlers(): void {
  const toast = useToast();
  // Last-shown timestamp per message, to throttle duplicate bursts.
  const lastShown = useRef(new Map<string, number>());

  useEffect(() => {
    const surface = (raw: unknown): void => {
      const full = messageOf(raw);
      if (isIgnorable(full)) return;
      const now = Date.now();
      const prev = lastShown.current.get(full);
      if (prev && now - prev < DEDUPE_MS) return;
      lastShown.current.set(full, now);
      const message = full.length > MAX_LEN ? `${full.slice(0, MAX_LEN - 1)}…` : full;
      toast.show({ kind: "error", message });
    };

    const onRejection = (e: PromiseRejectionEvent): void => surface(e.reason);
    const onError = (e: ErrorEvent): void => surface(e.error ?? e.message);

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, [toast]);
}
