/**
 * Toast — app-wide transient feedback, tuned for on-chain transactions.
 *
 * `useToast().show()` returns an id you can `update()` (pending → success/error)
 * and `dismiss()`. Pending toasts persist (a tx is in flight); success/error
 * auto-dismiss. Success toasts carry an optional link (e.g. "View on SuiVision ↗"
 * built from the tx digest) so a judge can verify the transaction on-chain.
 *
 * Mounted once at the app root (see providers.tsx). Rendered top-center, clear of
 * the TopBar and the feed's bottom chrome.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";

export interface ToastLink {
  href: string;
  label: string;
}
export type ToastKind = "pending" | "success" | "error";
export interface ToastInput {
  kind: ToastKind;
  message: string;
  link?: ToastLink;
}
interface ToastItem extends ToastInput {
  id: number;
}

export interface ToastApi {
  /** Show a toast; returns its id. */
  show: (t: ToastInput) => number;
  /** Patch an existing toast (e.g. pending → success). */
  update: (id: number, patch: Partial<ToastInput>) => void;
  dismiss: (id: number) => void;
}

declare global {
  interface Window {
    /** Dev-only handle for manual/CDP testing of the toast UI. */
    __suinamiToast?: ToastApi;
  }
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 5200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const scheduleAutoDismiss = useCallback(
    (id: number, kind: ToastKind) => {
      clearTimer(id);
      // Pending stays put until it's updated to success/error or dismissed.
      if (kind === "pending") return;
      timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (t: ToastInput) => {
      const id = (idRef.current += 1);
      setToasts((prev) => [...prev, { ...t, id }]);
      scheduleAutoDismiss(id, t.kind);
      return id;
    },
    [scheduleAutoDismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<ToastInput>) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.kind) scheduleAutoDismiss(id, patch.kind);
    },
    [scheduleAutoDismiss],
  );

  const timersRef = timers;
  useEffect(
    () => () => {
      timersRef.current.forEach((t) => clearTimeout(t));
    },
    [timersRef],
  );

  const api = useMemo<ToastApi>(() => ({ show, update, dismiss }), [show, update, dismiss]);

  // Dev affordance: lets us drive the toast UI from CDP / the console without a
  // wallet, so the visual states are testable.
  useEffect(() => {
    if (import.meta.env.DEV) window.__suinamiToast = api;
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+4.25rem)] z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastPill key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

function ToastPill({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const accent = toast.kind === "error" ? "var(--c-coral)" : "var(--c-aqua)";
  return (
    <motion.div
      layout
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 440, damping: 34 }}
      className="glass pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-2xl px-3.5 py-2.5"
      style={{ border: "var(--hairline)", boxShadow: "0 12px 32px -12px rgba(0,0,0,0.65)" }}
    >
      <ToastIcon kind={toast.kind} accent={accent} />
      <span className="text-sm leading-snug text-foam">{toast.message}</span>
      {toast.link ? (
        <a
          href={toast.link.href}
          target="_blank"
          rel="noreferrer"
          className="ml-1 whitespace-nowrap font-mono text-xs font-semibold text-aqua hover:underline"
        >
          {toast.link.label}
        </a>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 shrink-0 text-foam/40 transition-colors hover:text-foam/80"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </motion.div>
  );
}

function ToastIcon({ kind, accent }: { kind: ToastKind; accent: string }) {
  if (kind === "pending") {
    return (
      <span
        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-aqua/30 border-t-aqua"
        aria-hidden
      />
    );
  }
  if (kind === "success") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" style={{ color: accent }} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" style={{ color: accent }} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </svg>
  );
}
