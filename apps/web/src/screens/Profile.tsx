/**
 * Profile — a creator's on-chain harbour, rendered as an oceanographic instrument
 * readout. It shows the connected user's own profile (the Profile tab) or any
 * creator tapped in the feed/leaderboard. When you open your own harbour while
 * disconnected, it prompts you to connect a wallet rather than showing a
 * stranger's profile.
 *
 * Derived stats (videos / tips received / likes) count up on mount and honour
 * prefers-reduced-motion. The grid shows that creator's Walrus video posters.
 *
 * Videos come from GET /api/profile and the "Gifts in / Gifts out" tabs from GET
 * /api/gifts — both indexer-projected from on-chain state (every RPC via Tatum).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import type { FeedCard, GiftDirection } from "@suinami/shared";
import { mistToSui, SUIVISION_URLS, tierById } from "@suinami/shared";
import { ScreenShell } from "@/components/ScreenShell";
import { Avatar } from "@/components/Avatar";
import { fetchProfile, fetchGifts } from "@/lib/api";
import { config } from "@/config";
import { useWalletGate, useConnectGate } from "@/wallet";

/* ------------------------------------------------------------------ helpers */

const delay = (ms: number): CSSProperties => ({ "--d": `${ms}ms` }) as CSSProperties;

/** Walrus blob id → aggregator URL, or null when empty. */
function avatarUrlOf(blob: string | undefined | null): string | null {
  return blob ? `${config.walrusAggregatorUrl}/v1/blobs/${blob}` : null;
}

/** 0x1234…abcd */
function truncateAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * A deterministic, on-brand handle for a freshly connected wallet that has no
 * on-chain Profile/handle yet — so the profile reads as *their* harbour instead
 * of a stranger's. Stable per address; replaced by the real on-chain handle once
 * the Profile object is projected by the indexer into creator_stats.
 */
const HANDLE_ADJ = ["tidal", "coral", "deep", "azure", "reef", "drift", "lunar", "saline", "pelagic", "cobalt", "abyssal", "marine"];
const HANDLE_NOUN = ["swell", "current", "wake", "fathom", "harbor", "lagoon", "trench", "shoal", "crest", "mariner", "tide", "reef"];
function handleFromAddress(addr: string): string {
  const hex = addr.replace(/^0x/, "");
  let h = 0;
  for (let i = 0; i < hex.length; i += 1) h = (h * 33 + hex.charCodeAt(i)) >>> 0;
  const adj = HANDLE_ADJ[h % HANDLE_ADJ.length];
  const noun = HANDLE_NOUN[(h >>> 8) % HANDLE_NOUN.length];
  return `${adj}${noun}${(h % 90) + 10}`;
}

/** Compact mono count: 20431 → "20.4K", 1284 → "1,284". */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

/** A short nautical bio per handle (invented, on-theme). */
const BIOS: Record<string, string> = {
  deepcurrent: "Charting the cold deep where light forgets to follow.",
  aquaflow: "Liquid gradients, looped. Calm is a current you can ride.",
  signalsurf: "Tuning the static between waves into something watchable.",
  tidepool: "Small lives, large tides — macro studies from the shallows.",
  reefbits: "Cellular currents and coral arithmetic, one frame at a time.",
  sunsetswell: "Golden-hour swells, caught right before they break.",
};

/* ----------------------------------------------------------------- count-up */

/** Eases a number from 0 → target over ~900ms (instant under reduced motion). */
function useCountUp(target: number, animate: boolean, durationMs = 900): number {
  const [value, setValue] = useState<number>(animate ? 0 : target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
    let start: number | null = null;
    const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
    const tick = (now: number): void => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / durationMs);
      setValue(target * easeOut(p));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, animate, durationMs]);

  return value;
}

/* ------------------------------------------------------------------- atoms */

interface StatCardProps {
  label: string;
  value: number;
  /** Number of fixed decimals (SUI → 2; counts → 0). */
  decimals: number;
  suffix?: string;
  /** Render as the hero metric (larger, gradient). */
  hero?: boolean;
  accent: string;
  reveal: number;
}

function StatCard({ label, value, decimals, suffix, hero = false, accent, reveal }: StatCardProps) {
  const display =
    decimals > 0
      ? value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : compact(Math.round(value));

  return (
    <div
      className="rise glass relative overflow-hidden rounded-2xl px-3 py-3.5"
      style={delay(reveal)}
    >
      {/* instrument tick line at the card's foot */}
      <span
        className="pointer-events-none absolute inset-x-3 bottom-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: 0.5 }}
      />
      <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-foam/45">{label}</p>
      <p
        className={`tabular mt-1.5 ${hero ? "font-display text-tide text-[1.9rem] font-extrabold" : "font-mono text-[1.55rem] font-semibold text-foam"} leading-none`}
      >
        {display}
        {suffix && (
          <span className="ml-1 font-mono text-[0.6em] font-medium tracking-wide text-foam/45">
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- gift ledger */

/** Format a MIST amount as a trimmed SUI string (0.01 → "0.01"). */
function formatSui(mist: string): string {
  const s = mistToSui(mist);
  return s >= 1 ? s.toFixed(2) : String(Number(s.toFixed(4)));
}

/** Compact "time ago" from a unix-ms timestamp. */
function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/**
 * The on-chain gift ledger for a creator — REAL GiftSent events from GET
 * /api/gifts, newest first, each row linking to SuiVision /txblock. `direction`
 * picks received (gifts in) vs sent (gifts out). Graceful loading + empty states.
 */
function GiftLedger({ address, direction }: { address: string; direction: GiftDirection }) {
  const q = useQuery({
    queryKey: ["gifts", address, direction],
    queryFn: () => fetchGifts(address, direction, 50),
    enabled: Boolean(address),
    staleTime: 15_000,
    retry: 1,
  });
  const entries = q.data?.entries ?? [];

  if (q.isPending) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="shimmer glass h-[58px] rounded-xl"
            style={delay(40 + i * 60)}
          />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className="glass rise grid place-items-center rounded-2xl px-6 py-10 text-center"
        style={delay(60)}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foam/40">
          no tides {direction === "received" ? "received" : "sent"} yet
        </p>
        <p className="mt-2 max-w-[15rem] text-xs leading-relaxed text-foam/35">
          {direction === "received"
            ? "Gifts from fans surface here once they're on-chain."
            : "Gifts this creator sends surface here once they're on-chain."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-lg px-1 pb-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-foam/40">
        <span>{direction === "received" ? "from" : "to"}</span>
        <span>amount</span>
      </div>
      {entries.map((e, i) => {
        const tier = tierById(e.tier);
        const txUrl = `${SUIVISION_URLS[config.network]}/txblock/${e.digest}`;
        const when = relativeTime(e.sentAt);
        return (
          <div
            key={e.id}
            className="rise glass flex items-center gap-3 rounded-xl px-3 py-2.5"
            style={delay(50 + i * 60)}
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full text-[15px]"
              style={{ background: "rgba(111,230,225,0.08)", border: "var(--hairline)" }}
            >
              {tier?.glyph ?? "🌊"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-foam/85">
                {truncateAddress(e.counterparty)}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-aqua/65">
                {tier?.name ?? `Tier ${e.tier}`}
                {when ? <span className="ml-2 normal-case tracking-normal text-foam/35">· {when}</span> : null}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="tabular font-mono text-[13px] font-semibold text-foam">
                <span className={direction === "received" ? "text-aqua" : "text-foam/55"}>
                  {direction === "received" ? "+" : "−"}
                </span>
                {formatSui(e.amountMist)}
                <span className="ml-1 text-[10px] font-medium text-foam/40">SUI</span>
              </p>
              {e.digest ? (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-sui/80 transition-colors hover:text-sui"
                >
                  ↗ tx
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ waves */

function WaveTile({ card, reveal, onOpen }: { card: FeedCard; reveal: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-video-id={card.videoId}
      aria-label={`Open ${card.caption || "this wave"} in the feed`}
      className="rise group relative block aspect-[9/16] w-full overflow-hidden rounded-xl"
      style={{ ...delay(reveal), border: "var(--hairline)" }}
    >
      {card.posterUrl ? (
        <img
          src={card.posterUrl}
          alt={card.caption}
          loading="lazy"
          className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0" style={{ background: "var(--grad-tide)", opacity: 0.25 }} />
      )}
      {/* bottom scrim + readout */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-abyss/90 via-abyss/30 to-transparent px-2 pb-1.5 pt-6">
        <span className="tabular font-mono text-[10px] font-medium text-foam/90">
          ◷ {compact(card.viewCount)}
        </span>
      </div>
      {/* centred play glyph */}
      <span
        className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "rgba(10,20,40,0.55)", border: "var(--hairline)", backdropFilter: "blur(6px)" }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 2.2v7.6L9.5 6 3 2.2Z" fill="var(--c-aqua)" />
        </svg>
      </span>
    </button>
  );
}

function EmptyWaveTile({ reveal }: { reveal: number }) {
  return (
    <div
      className="rise grid aspect-[9/16] w-full place-items-center rounded-xl text-center"
      style={{
        ...delay(reveal),
        border: "1px dashed rgba(234,246,255,0.12)",
        background: "rgba(14,42,71,0.18)",
      }}
    >
      <span className="px-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.18em] text-foam/25">
        no more
        <br />
        waves yet
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

type TabId = "waves" | "in" | "out";
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "waves", label: "Waves" },
  { id: "in", label: "Gifts in" },
  { id: "out", label: "Gifts out" },
];

/* ================================================================= screen */

interface ProfileProps {
  /** A specific creator to show (from a feed/leaderboard tap). Null = the
   *  connected user's own profile (or a connect-wallet prompt when disconnected). */
  creatorAddress?: string | null;
  /** Open one of this creator's videos in the feed (a Waves-grid tap). */
  onOpenVideo?: (videoId: string) => void;
}

/** Shown on the Profile tab when no wallet is connected — your harbour is on-chain. */
function ConnectProfilePrompt({ onConnect, reduce }: { onConnect: () => void; reduce: boolean }) {
  return (
    <motion.div
      className="glass relative overflow-hidden rounded-3xl px-7 py-9 text-center"
      style={{ boxShadow: "var(--glow-sui)" }}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="mx-auto grid h-16 w-16 place-items-center rounded-2xl"
        style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8 text-abyss"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 8c2.4 0 2.4-2.4 4.8-2.4S9.2 8 11.6 8 14 5.6 16.4 5.6 18.8 8 21.2 8" />
          <path d="M2 13c2.4 0 2.4-2.4 4.8-2.4S9.2 13 11.6 13 14 10.6 16.4 10.6 18.8 13 21.2 13" />
          <path d="M2 18c2.4 0 2.4-2.4 4.8-2.4S9.2 18 11.6 18 14 15.6 16.4 15.6 18.8 18 21.2 18" />
        </svg>
      </div>

      <h2 className="mt-5 font-display text-2xl font-extrabold leading-tight tracking-tight text-foam">
        Connect your wallet
      </h2>
      <p className="mx-auto mt-2 max-w-[20rem] text-sm leading-relaxed text-foam/65">
        Your harbour is your on-chain profile — your waves, the tips you&rsquo;ve received, and the
        gifts you&rsquo;ve sent. Connect a wallet to see it.
      </p>

      <button
        type="button"
        onClick={onConnect}
        className="mx-auto mt-6 flex min-h-[48px] items-center justify-center gap-2 rounded-full px-7 font-display text-sm font-semibold text-abyss transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua/70"
        style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
      >
        Connect wallet
      </button>
    </motion.div>
  );
}

export function Profile({ creatorAddress, onOpenVideo }: ProfileProps) {
  const prefersReduced = useReducedMotion();
  const animate = !prefersReduced;
  const { address, isConnected } = useWalletGate();
  const { openConnect } = useConnectGate();
  const [tab, setTab] = useState<TabId>("waves");
  const [copied, setCopied] = useState(false);

  // Whose profile: a creator tapped in the feed/leaderboard, else the connected
  // user, else null (the disconnected demo). Real data comes from /api/profile
  // (indexer-projected on-chain Videos, resolved through Tatum); SAMPLE_FEED is
  // only the fallback when nothing is connected/tapped.
  const target = creatorAddress ?? (isConnected ? address : null);
  const profileQuery = useQuery({
    queryKey: ["profile", target],
    queryFn: () => fetchProfile(target as string),
    enabled: Boolean(target),
    staleTime: 15_000,
    retry: 1,
  });

  const view = useMemo(() => {
    // 1. Real on-chain profile for the resolved target.
    if (target && profileQuery.data) {
      const d = profileQuery.data;
      return {
        address: target,
        handle: d.handle || handleFromAddress(target),
        bioOverride: d.bio || undefined,
        avatarUrl: avatarUrlOf(d.avatarBlob) ?? d.videos[0]?.avatarUrl ?? null,
        posts: d.videos,
        totals: {
          videos: d.videoCount || d.videos.length,
          tips: mistToSui(d.totalTipsReceived),
          likes: d.totalLikesReceived,
        },
        isOwn: Boolean(address) && target === address,
      };
    }

    // 2. Target known but data not ready → minimal identity (no blank flash).
    if (target) {
      return {
        address: target,
        handle: handleFromAddress(target),
        bioOverride: undefined,
        avatarUrl: null,
        posts: [] as FeedCard[],
        totals: { videos: 0, tips: 0, likes: 0 },
        isOwn: Boolean(address) && target === address,
      };
    }

    // 3. No target (disconnected + no creator tapped) → there is no profile to
    //    show; the screen renders a connect-wallet prompt instead.
    return null;
  }, [target, profileQuery.data, address]);

  const totals = view?.totals ?? { videos: 0, tips: 0, likes: 0 };
  const tipsValue = useCountUp(totals.tips, animate);
  const likesValue = useCountUp(totals.likes, animate);
  const videosValue = useCountUp(totals.videos, animate);

  // Disconnected and opening your own harbour (no creator tapped) → prompt connect.
  if (!view) {
    return (
      <ScreenShell kicker="YOUR HARBOUR" title="Profile" subtitle="ride your own Suinami">
        <ConnectProfilePrompt onConnect={openConnect} reduce={prefersReduced ?? false} />
      </ScreenShell>
    );
  }

  const { handle, posts, isOwn } = view;
  const profileAddress = view.address;
  const bio = view.bioOverride
    ? view.bioOverride
    : isOwn
      ? posts.length === 0
        ? "Your harbour on the Suinami — upload your first wave."
        : BIOS[handle] ?? "Your harbour on the Suinami."
      : BIOS[handle] ?? "Riding the Suinami.";
  const suiVisionUrl = `${SUIVISION_URLS[config.network]}/account/${profileAddress}`;

  const onCopy = (): void => {
    void navigator.clipboard?.writeText(profileAddress).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  // Build the waves grid: posts + faint fillers so the 3-col grid always reads
  // as a deliberate composition rather than a lonely single tile.
  const minCells = 3;
  const fillerCount = Math.max(0, minCells - posts.length);

  return (
    <ScreenShell kicker="CREATOR" title={`@${handle}`} subtitle={bio}>
      {/* "this is you" chip — only on the connected user's own profile. */}
      {isOwn && address && (
        <div
          className="rise mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
          style={{ ...delay(40), border: "var(--hairline)", background: "rgba(111,230,225,0.06)" }}
        >
          <span className="size-1.5 rounded-full bg-aqua glow-aqua" />
          <span className="font-mono text-[11px] text-foam/70">
            this is you{" "}
            <span className="text-aqua">{truncateAddress(address)}</span>
          </span>
        </div>
      )}

      {/* HERO ----------------------------------------------------------- */}
      <div className="rise flex items-center gap-4" style={delay(60)}>
        <Avatar handle={handle} size={84} avatarUrl={view.avatarUrl} ring />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-extrabold leading-none text-foam">@{handle}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex min-h-[28px] items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors hover:bg-foam/5"
              style={{ border: "var(--hairline)" }}
              aria-label="Copy creator address"
            >
              <span className="tabular font-mono text-[11px] text-foam/75">
                {truncateAddress(profileAddress)}
              </span>
              <span className="font-mono text-[10px] text-aqua/80">{copied ? "copied" : "copy"}</span>
            </button>
            <a
              href={suiVisionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[28px] items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] text-sui transition-colors hover:bg-sui/10"
              style={{ border: "1px solid rgba(77,162,255,0.3)" }}
            >
              ↗ SuiVision
            </a>
          </div>
        </div>
      </div>

      {/* STAT TRIO ------------------------------------------------------ */}
      <div className="mt-6 grid grid-cols-3 gap-2.5">
        <StatCard
          label="Waves"
          value={videosValue}
          decimals={0}
          accent="var(--c-aqua)"
          reveal={120}
        />
        <StatCard
          label="Tips in"
          value={tipsValue}
          decimals={2}
          suffix="SUI"
          hero
          accent="var(--c-sui)"
          reveal={170}
        />
        <StatCard
          label="Likes"
          value={likesValue}
          decimals={0}
          accent="var(--c-coral)"
          reveal={220}
        />
      </div>

      {/* TABS ----------------------------------------------------------- */}
      <div
        className="rise mt-7 grid grid-cols-3 gap-1 rounded-full p-1"
        style={{ ...delay(280), border: "var(--hairline)", background: "rgba(10,20,40,0.4)" }}
        role="tablist"
        aria-label="Profile sections"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="relative min-h-[36px] rounded-full px-2 text-[12.5px] font-medium transition-colors"
              style={{ color: active ? "var(--c-abyss)" : "rgba(234,246,255,0.6)" }}
            >
              {active && (
                <motion.span
                  layoutId="profile-tab"
                  className="absolute inset-0 -z-10 rounded-full"
                  style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-sui)" }}
                  transition={
                    animate
                      ? { type: "spring", stiffness: 420, damping: 34 }
                      : { duration: 0 }
                  }
                />
              )}
              <span className="relative font-mono tracking-wide">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* PANELS --------------------------------------------------------- */}
      <div className="mt-5">
        {tab === "waves" && (
          <div className="grid grid-cols-3 gap-2.5">
            {posts.map((card, i) => (
              <WaveTile
                key={card.videoId}
                card={card}
                reveal={40 + i * 60}
                onOpen={() => onOpenVideo?.(card.videoId)}
              />
            ))}
            {Array.from({ length: fillerCount }).map((_, i) => (
              <EmptyWaveTile key={`filler-${i}`} reveal={40 + (posts.length + i) * 60} />
            ))}
          </div>
        )}
        {tab === "in" && <GiftLedger address={profileAddress} direction="received" />}
        {tab === "out" && <GiftLedger address={profileAddress} direction="sent" />}
      </div>
    </ScreenShell>
  );
}
