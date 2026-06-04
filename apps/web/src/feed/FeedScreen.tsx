/**
 * Vertical feed pager — the product centerpiece.
 *
 * A scroll-snap column where one VideoCard fills the viewport (TikTok/Reels
 * style). This module OWNS feed state:
 *   - which card is active (autoplays) via a single IntersectionObserver
 *   - global mute (first tap unmutes everywhere)
 *   - optimistic likes (a liked Set + derived count, so VideoCard stays honest)
 *   - the gift bottom-sheet (open + which card) and its optimistic tip bump
 *   - pull-to-refresh overscroll → PullWave
 *   - desktop/judge keyboard nav (↑/↓ paging, Space play/pause, L like)
 *   - loading skeleton / empty / end-of-feed states (see FeedStates)
 *
 * Data comes from GET /api/feed (indexer-projected on-chain Videos, every RPC via
 * Tatum). The first fetch shows a branded skeleton; a genuinely empty real feed
 * shows an upload invite; if the API is unreachable we fall back to the static
 * SAMPLE_FEED of REAL Walrus videos so the demo always has content. Like/gift
 * fire real on-chain transactions (see useOnChainWrite).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import type { FeedCard } from "@suinami/shared";
import { SUIVISION_URLS } from "@suinami/shared";
import { config } from "@/config";
import { useToast } from "@/components/Toast";
import { VideoCard } from "@/feed/VideoCard";
import { GiftSheet } from "@/feed/GiftSheet";
import { CommentSheet } from "@/feed/CommentSheet";
import { FeedSkeleton, FeedEmpty, FeedEndCard } from "@/feed/FeedStates";
import { useActiveIndex, useGlobalMute } from "@/feed/hooks";
import { DepthGauge, PullWave } from "@/fx";
import { useWalletGate, useOnChainWrite, useConnectGate } from "@/wallet";
import { SAMPLE_FEED } from "@/feed/sampleFeed";
import { fetchFeed } from "@/lib/api";

/** Custom DOM event VideoCard can listen for to toggle play of the active card. */
const PLAY_TOGGLE_EVENT = "suinami:toggle-play";

/** A "View on SuiVision ↗" link for a transaction digest. */
function txLink(digest: string): { href: string; label: string } {
  return {
    href: `${SUIVISION_URLS[config.network]}/txblock/${digest}`,
    label: "View on SuiVision ↗",
  };
}

/** Human-friendly text for a failed/rejected on-chain transaction. */
function txError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel/i.test(m)) return "Transaction cancelled.";
  if (/already in progress/i.test(m)) return "Hold on — finishing the last transaction.";
  if (/insufficient|no SUI|gas/i.test(m)) return "Not enough SUI for gas.";
  return m.length > 90 ? `${m.slice(0, 88)}…` : m;
}

/** Fisher–Yates shuffle into a NEW array (runtime only — never in renders). */
function reshuffle(list: FeedCard[]): FeedCard[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** True when focus is in an editable field (don't hijack keys, e.g. gift amount). */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

interface FeedScreenProps {
  /** Open a creator's profile (tapping a card's @handle or avatar). */
  onOpenProfile: (creator: string) => void;
  /** Jump to the Upload tab (from the empty-feed call-to-action). */
  onOpenUpload?: () => void;
  /** Deep-link: jump to this video on mount (from a profile wave tap). */
  initialVideoId?: string | null;
}

export function FeedScreen({ onOpenProfile, onOpenUpload, initialVideoId }: FeedScreenProps) {
  const reduce = useReducedMotion();

  // Real feed from the API (indexer-projected on-chain Videos, every RPC via
  // Tatum). We distinguish four states so the pager never blanks or flashes
  // sample content:
  //   - first fetch in flight (no cached data)      → branded skeleton
  //   - success with ZERO on-chain videos           → empty / upload invite
  //   - error / API down                            → graceful SAMPLE_FEED
  //   - success with videos                         → the real feed (+ sentinel)
  const feedQuery = useQuery({
    queryKey: ["feed"],
    queryFn: () => fetchFeed(30),
    staleTime: 30_000,
    retry: 1,
  });
  const refetchFeed = feedQuery.refetch;
  const apiCards = feedQuery.data?.cards;
  // `isPending` (status 'pending') = no data yet, incl. during the retry — first
  // paint only; a later background refetch keeps data so no skeleton re-flash.
  const showSkeleton = feedQuery.isPending;
  const isEmptyReal = feedQuery.isSuccess && (apiCards?.length ?? 0) === 0;
  const source = useMemo<FeedCard[]>(() => {
    if (apiCards && apiCards.length > 0) return apiCards; // real on-chain videos
    if (feedQuery.isError) return SAMPLE_FEED; // API down → graceful demo content
    return []; // loading or genuinely empty → render skeleton / empty instead
  }, [apiCards, feedQuery.isError]);

  // The working list. Pull-to-refresh reshuffles it; it re-syncs to `source`
  // whenever fresh data arrives from the API.
  const [feed, setFeed] = useState<FeedCard[]>(source);
  useEffect(() => {
    setFeed(source);
  }, [source]);
  const count = feed.length;

  // The pager is shown for the real feed AND the SAMPLE_FEED fallback (not for the
  // skeleton/empty states). When shown with videos, an end-of-feed sentinel snaps
  // in after the last card — observed as index `count` so reaching it pauses every
  // video (no card has i === activeIndex once the seabed is active).
  const showPager = !showSkeleton && !isEmptyReal && count > 0;
  const observedCount = showPager ? count + 1 : count;

  const { activeIndex, registerRef, setRoot } = useActiveIndex(observedCount);
  const [muted, toggleMute] = useGlobalMute();
  const { isConnected, address } = useWalletGate();
  // On-chain write path (like / gift) — wallet-signed, executed via Tatum.
  const { likeVideo, sendGift, canWrite, isPending } = useOnChainWrite();
  // Wallet gate: like / gift / comment require a connected wallet; a disconnected
  // tap opens the wallet picker instead of doing nothing.
  const { requireWallet } = useConnectGate();
  const toast = useToast();

  // The scroll column (also the IntersectionObserver root).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Combined ref callback: feed both our local ref and the observer root.
  const attachScroll = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      setRoot(el);
    },
    [setRoot],
  );

  // --- Optimistic likes: a Set of liked videoIds; count = base ± membership.
  // Liking also fires an on-chain `like_video` (wallet-signed, via Tatum) when a
  // wallet is connected and the card is a real on-chain Video; the optimistic
  // toggle is reverted if that transaction fails/rejects.
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const toggleLike = useCallback(
    (videoId: string) => {
      // Disconnected → prompt connect (don't toggle / transact).
      requireWallet(() => {
        const wasLiked = liked.has(videoId);
        setLiked((prev) => {
          const next = new Set(prev);
          if (wasLiked) next.delete(videoId);
          else next.add(videoId);
          return next;
        });
        // Only transact on a NEW like (on-chain unlike isn't wired — it needs the
        // Like object id); likeVideo no-ops for non-on-chain cards.
        if (!wasLiked) {
          // Ignore a new like while another tx is in flight (avoid double-sign).
          if (isPending) {
            toast.show({ kind: "error", message: txError(new Error("already in progress")) });
            setLiked((prev) => {
              const next = new Set(prev);
              next.delete(videoId);
              return next;
            });
            return;
          }
          const tid = toast.show({ kind: "pending", message: "Liking — confirm in your wallet…" });
          void likeVideo(videoId)
            .then((res) => {
              if (res?.digest) {
                toast.update(tid, {
                  kind: "success",
                  message: "Liked on-chain",
                  link: txLink(res.digest),
                });
                void refetchFeed(); // pull the chain-updated count
              } else {
                toast.dismiss(tid); // off-chain card — no transaction fired
              }
            })
            .catch((err: unknown) => {
              toast.update(tid, { kind: "error", message: txError(err) });
              // Revert the optimistic like (e.g. the user rejected the wallet).
              setLiked((prev) => {
                const next = new Set(prev);
                next.delete(videoId);
                return next;
              });
            });
        }
      });
    },
    [requireWallet, liked, likeVideo, refetchFeed, toast, isPending],
  );

  // --- Optimistic tips: per-video MIST delta added on top of the card total.
  const [tipDelta, setTipDelta] = useState<Record<string, bigint>>({});

  // --- Gift sheet state.
  const [giftCard, setGiftCard] = useState<FeedCard | null>(null);
  const giftOpen = giftCard !== null;
  // Disconnected → prompt connect instead of opening the gift sheet.
  const openGift = useCallback(
    (card: FeedCard) => requireWallet(() => setGiftCard(card)),
    [requireWallet],
  );
  const closeGift = useCallback(() => setGiftCard(null), []);

  // --- Comment sheet state + live per-video counts (for the rail badge).
  const [commentCard, setCommentCard] = useState<FeedCard | null>(null);
  const commentOpen = commentCard !== null;
  // Disconnected → prompt connect instead of opening the comment sheet.
  const openComments = useCallback(
    (card: FeedCard) => requireWallet(() => setCommentCard(card)),
    [requireWallet],
  );
  const closeComments = useCallback(() => setCommentCard(null), []);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const onCommentCount = useCallback((videoId: string, total: number) => {
    setCommentCounts((prev) =>
      prev[videoId] === total ? prev : { ...prev, [videoId]: total },
    );
  }, []);
  const onRequireConnect = useCallback(() => {
    // Sheet's own connect affordance → open the wallet picker (a disconnected tap
    // normally can't open the sheet, but keep this honest if it ever does).
    requireWallet(() => {});
  }, [requireWallet]);
  const confirmGift = useCallback(
    ({ tier, amountMist }: { tier: number; amountMist: bigint }) => {
      const card = giftCard;
      setGiftCard(null);
      if (!card) return;
      if (canWrite && isPending) {
        toast.show({ kind: "error", message: txError(new Error("already in progress")) });
        return;
      }
      // Optimistic tip bump first (the sheet plays its flash immediately).
      setTipDelta((prev) => ({
        ...prev,
        [card.videoId]: (prev[card.videoId] ?? 0n) + amountMist,
      }));
      // Fire the real on-chain `send_gift` (wallet-signed, executed via Tatum)
      // when possible; revert the optimistic bump if it fails.
      if (canWrite) {
        const tid = toast.show({ kind: "pending", message: "Sending gift — confirm in your wallet…" });
        void sendGift({ videoId: card.videoId, creator: card.creator, amountMist, tier })
          .then((res) => {
            if (res?.digest) {
              toast.update(tid, {
                kind: "success",
                message: "Gift sent on-chain",
                link: txLink(res.digest),
              });
              void refetchFeed();
            } else {
              toast.dismiss(tid);
            }
          })
          .catch((err: unknown) => {
            toast.update(tid, { kind: "error", message: txError(err) });
            setTipDelta((prev) => ({
              ...prev,
              [card.videoId]: (prev[card.videoId] ?? 0n) - amountMist,
            }));
          });
      }
    },
    [giftCard, canWrite, sendGift, refetchFeed, toast, isPending],
  );

  // Present each card with optimistic like/tip applied so VideoCard stays accurate.
  const presented = useMemo(
    () =>
      feed.map((card) => {
        const isLiked = liked.has(card.videoId);
        const delta = tipDelta[card.videoId];
        const likeCount = card.likeCount + (isLiked ? 1 : 0);
        const tipTotal = delta
          ? (BigInt(card.tipTotal || "0") + delta).toString()
          : card.tipTotal;
        const adjusted: FeedCard =
          likeCount === card.likeCount && tipTotal === card.tipTotal
            ? card
            : { ...card, likeCount, tipTotal };
        return { card: adjusted, liked: isLiked };
      }),
    [feed, liked, tipDelta],
  );

  // (Profile navigation is provided by the parent via the onOpenProfile prop.)

  // --- Pull-to-refresh state (declared above the keyboard handler so the same
  //     refresh can also be fired by the "R" key for desktop / judges).
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const PULL_THRESHOLD = 90; // px to trigger a refresh

  // A real refresh: reshuffle the feed so different content surfaces, snap back
  // to the top, and let the PullWave "crash" play while it settles.
  const doRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setPull(1);
    void refetchFeed(); // pull fresh on-chain data…
    setFeed((prev) => reshuffle(prev)); // …and visibly reshuffle what's shown
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
    window.setTimeout(() => {
      setRefreshing(false);
      setPull(0);
    }, 800);
  }, [refreshing, refetchFeed]);

  // --- Keyboard navigation (desktop / judges).
  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const root = scrollRef.current;
    if (!root) return;
    const child = root.children.item(index);
    if (child instanceof HTMLElement) {
      child.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "start",
      });
    }
  }, []);

  // Deep-link: when arriving from a profile wave tap, jump to that video once the
  // feed has loaded it. Consumed once (a ref) so reshuffles/refetches don't re-jump;
  // if the id isn't in the current feed we simply stay at the top (graceful).
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (!initialVideoId || deepLinkDone.current) return;
    const idx = feed.findIndex((c) => c.videoId === initialVideoId);
    if (idx < 0) return; // not loaded yet (or not present) — wait / no-op
    deepLinkDone.current = true;
    // Two frames so the just-mounted pager has laid out before we jump.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToIndex(idx, false)));
  }, [initialVideoId, feed, scrollToIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (giftOpen || commentOpen) return; // don't page behind an open sheet
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          scrollToIndex(Math.min(activeIndex + 1, count - 1), !reduce);
          break;
        case "ArrowUp":
          e.preventDefault();
          scrollToIndex(Math.max(activeIndex - 1, 0), !reduce);
          break;
        case " ":
        case "Spacebar":
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent<{ index: number }>(PLAY_TOGGLE_EVENT, {
              detail: { index: activeIndex },
            }),
          );
          break;
        case "l":
        case "L": {
          const id = feed[activeIndex]?.videoId;
          if (id) toggleLike(id);
          break;
        }
        case "c":
        case "C": {
          const card = feed[activeIndex];
          if (card) openComments(card);
          break;
        }
        case "r":
        case "R":
          doRefresh();
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeIndex,
    count,
    feed,
    giftOpen,
    commentOpen,
    reduce,
    scrollToIndex,
    toggleLike,
    toggleMute,
    openComments,
    doRefresh,
  ]);

  // --- Pull-to-refresh gesture: track downward overscroll while at the top.
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const root = scrollRef.current;
    if (!root) return;
    if (root.scrollTop <= 0) {
      dragStartY.current = e.touches[0]?.clientY ?? null;
    } else {
      dragStartY.current = null;
    }
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (dragStartY.current === null || refreshing) return;
      const root = scrollRef.current;
      if (!root || root.scrollTop > 0) {
        dragStartY.current = null;
        setPull(0);
        return;
      }
      const dy = (e.touches[0]?.clientY ?? 0) - dragStartY.current;
      if (dy > 0) {
        // Rubber-band damping; normalize to 0..1+ against the threshold.
        const damped = Math.min(dy * 0.6, PULL_THRESHOLD * 1.4);
        setPull(damped / PULL_THRESHOLD);
      } else {
        setPull(0);
      }
    },
    [refreshing],
  );

  const onTouchEnd = useCallback(() => {
    dragStartY.current = null;
    if (pull >= 1 && !refreshing) {
      doRefresh();
    } else {
      setPull(0);
    }
  }, [pull, refreshing, doRefresh]);

  // Clamp: the sentinel (index === count) would push this past 1.
  const progress = count > 1 ? Math.min(1, activeIndex / (count - 1)) : 0;

  // First-load skeleton and empty-feed states stand in for the pager (no cards to
  // page through). The graceful SAMPLE_FEED fallback (API down) renders the pager.
  if (showSkeleton) {
    return (
      <div className="relative h-[100dvh] w-full overflow-hidden">
        <FeedSkeleton />
      </div>
    );
  }
  if (isEmptyReal) {
    return (
      <div className="relative h-[100dvh] w-full overflow-hidden">
        <FeedEmpty
          onOpenUpload={onOpenUpload}
          onRefresh={doRefresh}
          refreshing={refreshing}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      {/* Pull-to-refresh wave, pinned above the column. */}
      <PullWave pull={pull} refreshing={refreshing} />

      {/* Depth gauge: progress through the feed. Decorative; reduced-motion-safe. */}
      <DepthGauge progress={progress} />

      {/* The snap column. */}
      <div
        ref={attachScroll}
        className="no-scrollbar h-[100dvh] w-full snap-y snap-mandatory overflow-y-scroll"
        style={{
          touchAction: "pan-y",
          overscrollBehavior: "contain",
          // Reduced motion: keep snapping usable but let the browser jump.
          scrollBehavior: reduce ? "auto" : undefined,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {presented.map(({ card, liked: isLiked }, i) => (
          <div
            key={card.videoId}
            ref={registerRef(i)}
            data-video-id={card.videoId}
            className="h-[100dvh] w-full snap-start"
          >
            <VideoCard
              card={card}
              active={i === activeIndex}
              muted={muted}
              onToggleMute={toggleMute}
              onLike={toggleLike}
              liked={isLiked}
              onOpenGift={openGift}
              onOpenComments={openComments}
              onOpenProfile={onOpenProfile}
              commentCount={commentCounts[card.videoId]}
            />
          </div>
        ))}

        {/* End-of-feed "seabed" sentinel — observed as index `count` so reaching
            it pauses every video. Refresh reshuffles + snaps back to the top. */}
        {count > 0 ? (
          <div ref={registerRef(count)} className="h-[100dvh] w-full snap-start">
            <FeedEndCard count={count} onRefresh={doRefresh} refreshing={refreshing} />
          </div>
        ) : null}
      </div>

      {/* Frosted gift bottom-sheet. */}
      <GiftSheet
        open={giftOpen}
        card={giftCard}
        connected={isConnected}
        onClose={closeGift}
        onConfirm={confirmGift}
        onRequireConnect={onRequireConnect}
      />

      {/* Frosted comment thread bottom-sheet. */}
      <CommentSheet
        open={commentOpen}
        card={commentCard}
        address={address}
        onClose={closeComments}
        onCount={onCommentCount}
      />
    </div>
  );
}
