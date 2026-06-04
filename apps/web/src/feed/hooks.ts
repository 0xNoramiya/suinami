/**
 * Feed engine hooks.
 *
 * Two concerns, kept tiny and dependency-free so the pager (FeedScreen) stays
 * declarative:
 *   - useGlobalMute(): app-wide mute, persisted; first tap unmutes everywhere.
 *   - useActiveIndex(): a SINGLE IntersectionObserver rooted on the scroll
 *     column picks the most-visible card as "active" (the one that autoplays).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MUTE_KEY = "suinami:muted";

/** Read the persisted mute preference; default muted (browser autoplay policy). */
function readPersistedMute(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(MUTE_KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

/**
 * Global muted state, persisted to localStorage. Starts muted so muted-autoplay
 * works; the first user tap (toggle) unmutes the whole feed.
 */
export function useGlobalMute(): [boolean, () => void] {
  const [muted, setMuted] = useState<boolean>(readPersistedMute);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // Private mode / storage disabled — keep working in-memory.
      }
      return next;
    });
  }, []);

  return [muted, toggle];
}

interface ActiveIndex {
  /** Index of the most-visible card (0 when nothing has intersected yet). */
  activeIndex: number;
  /** Returns a ref callback to attach to the card wrapper at `index`. */
  registerRef: (index: number) => (el: HTMLElement | null) => void;
  /** Attach to the scroll column; used as the IntersectionObserver root. */
  setRoot: (el: HTMLElement | null) => void;
}

/**
 * Tracks which card is on-screen via ONE IntersectionObserver. The root is the
 * snap scroll container; the card with the greatest intersection ratio (>=
 * threshold) wins. Cheap: a single observer, a Map of element→index.
 */
export function useActiveIndex(count: number): ActiveIndex {
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  // element -> card index, and the inverse for ratio bookkeeping.
  const indexByEl = useRef<Map<Element, number>>(new Map());
  const elByIndex = useRef<Map<number, HTMLElement>>(new Map());
  const ratios = useRef<Map<number, number>>(new Map());

  // Recreate the observer whenever the root element changes.
  const buildObserver = useCallback(() => {
    observerRef.current?.disconnect();
    const root = rootRef.current;
    if (!root) {
      observerRef.current = null;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = indexByEl.current.get(entry.target);
          if (idx === undefined) continue;
          ratios.current.set(idx, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        // Pick the most-visible card; ties resolve to the lower index.
        let best = -1;
        let bestRatio = 0;
        for (const [idx, ratio] of ratios.current) {
          if (ratio > bestRatio + 0.001) {
            bestRatio = ratio;
            best = idx;
          }
        }
        if (best !== -1 && bestRatio >= 0.5) {
          setActiveIndex((prev) => (prev === best ? prev : best));
        }
      },
      { root, threshold: [0.5, 0.6, 0.75, 0.9] },
    );
    observerRef.current = observer;
    // Re-observe everything already registered.
    for (const el of elByIndex.current.values()) observer.observe(el);
  }, []);

  const setRoot = useCallback(
    (el: HTMLElement | null) => {
      rootRef.current = el;
      buildObserver();
    },
    [buildObserver],
  );

  const registerRef = useCallback(
    (index: number) =>
      (el: HTMLElement | null) => {
        // Tear down the previous element registered at this index.
        const prev = elByIndex.current.get(index);
        if (prev && prev !== el) {
          observerRef.current?.unobserve(prev);
          indexByEl.current.delete(prev);
          elByIndex.current.delete(index);
        }
        if (el) {
          elByIndex.current.set(index, el);
          indexByEl.current.set(el, index);
          observerRef.current?.observe(el);
        } else {
          ratios.current.delete(index);
        }
      },
    [],
  );

  // Drop bookkeeping for indices beyond the current count (feed shrank).
  useEffect(() => {
    for (const idx of Array.from(elByIndex.current.keys())) {
      if (idx >= count) {
        const el = elByIndex.current.get(idx);
        if (el) {
          observerRef.current?.unobserve(el);
          indexByEl.current.delete(el);
        }
        elByIndex.current.delete(idx);
        ratios.current.delete(idx);
      }
    }
    if (activeIndex >= count) setActiveIndex(count > 0 ? count - 1 : 0);
  }, [count, activeIndex]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  return useMemo(
    () => ({ activeIndex, registerRef, setRoot }),
    [activeIndex, registerRef, setRoot],
  );
}
