/**
 * The Tide Charts — a ranked leaderboard of creators, rendered as an
 * oceanographic instrument readout. Three boards (Most Tipped / Most Liked /
 * Most Posted) come live from GET /api/leaderboard, which the indexer rolls up
 * from on-chain activity (gift_events + creator_stats). The top 3 surface as
 * rising-water crest columns; the rest fall into ranked rows with a level bar.
 *
 * SAMPLE_FEED is the fallback only — used while the request is in flight or when
 * a board is empty/unreachable. Every metric stays verifiable on SuiVision via
 * the header pill, and row taps open the creator's real on-chain profile.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { mistToSui, SUIVISION_URLS } from "@suinami/shared";
import { ScreenShell } from "@/components/ScreenShell";
import { Avatar } from "@/components/Avatar";
import { SAMPLE_FEED } from "@/feed/sampleFeed";
import { fetchLeaderboard } from "@/lib/api";
import { config } from "@/config";

/* ---- model -------------------------------------------------------------- */

type BoardId = "tips" | "likes" | "videos";

interface BoardDef {
  id: BoardId;
  label: string;
  /** Short instrument label for the metric column. */
  unit: string;
}

const BOARDS = [
  { id: "tips", label: "Most Tipped", unit: "SUI" },
  { id: "likes", label: "Most Liked", unit: "LIKES" },
  { id: "videos", label: "Most Posted", unit: "WAVES" },
] as const satisfies readonly BoardDef[];

const DEFAULT_BOARD: BoardDef = BOARDS[0];

/** Medals read as sun-on-water — warm light glancing off the crest. */
const MEDALS: readonly string[] = ["#FFD66B", "#D9E6F2", "#E59B6B"];

/** One ranked creator, normalised from the API row or the sample fallback. */
interface LeaderRow {
  address: string;
  handle: string;
  /** Raw numeric metric for the active board (drives ranking + level bars). */
  metricRaw: number;
  /** Videos posted — the "N waves" sub-label, shown on every board. */
  videos: number;
  /** Real Walrus avatar URL (null → gradient fallback). */
  avatarUrl: string | null;
}

/** Format a board's raw metric into its display string (no unit suffix). */
function formatMetric(board: BoardId, raw: number): string {
  if (board === "tips") {
    // SUI: 2 decimals at/above 1, finer below, trailing zeros trimmed.
    return raw >= 1 ? raw.toFixed(2) : String(Number(raw.toFixed(4)));
  }
  return Math.round(raw).toLocaleString("en-US");
}

/* ---- sample fallback ---------------------------------------------------- */

/**
 * Client-side board derived from the static SAMPLE_FEED — used ONLY when the API
 * leaderboard is empty or unreachable (mirrors the FeedScreen fallback). Real
 * rankings come from GET /api/leaderboard (indexer-rolled on-chain activity).
 */
function sampleBoard(board: BoardId): LeaderRow[] {
  const byCreator = new Map<
    string,
    { address: string; handle: string; tipsMist: bigint; likes: number; videos: number }
  >();
  for (const card of SAMPLE_FEED) {
    const prev = byCreator.get(card.creator);
    if (prev) {
      prev.tipsMist += BigInt(card.tipTotal || "0");
      prev.likes += card.likeCount;
      prev.videos += 1;
    } else {
      byCreator.set(card.creator, {
        address: card.creator,
        handle: card.handle,
        tipsMist: BigInt(card.tipTotal || "0"),
        likes: card.likeCount,
        videos: 1,
      });
    }
  }
  const rows: LeaderRow[] = [...byCreator.values()].map((c) => ({
    address: c.address,
    handle: c.handle,
    videos: c.videos,
    avatarUrl: null, // sample creators have no real avatar
    metricRaw:
      board === "tips" ? mistToSui(c.tipsMist) : board === "likes" ? c.likes : c.videos,
  }));
  return rows.sort((a, b) => b.metricRaw - a.metricRaw);
}

/* ---- crest (podium column) ---------------------------------------------- */

interface CrestProps {
  stat: LeaderRow;
  rank: number; // 1..3
  label: string;
  unit: string;
  reduce: boolean;
  onOpenProfile: (address: string) => void;
}

/** A single rising-water column for the top-3 podium. */
function Crest({ stat, rank, label, unit, reduce, onOpenProfile }: CrestProps) {
  const medal = MEDALS[rank - 1];
  // Center #1 tallest, flanked by #2 and #3.
  const heights = ["10.5rem", "8rem", "6.75rem"];
  const height = heights[rank - 1];
  const isFirst = rank === 1;

  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      onClick={() => onOpenProfile(stat.address)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenProfile(stat.address);
        }
      }}
      aria-label={`Open @${stat.handle}'s profile`}
      className="flex min-w-0 flex-1 cursor-pointer flex-col items-center"
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
    >
      {/* Avatar + medal cap floating above the crest. */}
      <div className="relative mb-2">
        <Avatar handle={stat.handle} size={isFirst ? 58 : 46} avatarUrl={stat.avatarUrl} ring={medal} />
        <span
          className="absolute -bottom-1.5 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full font-mono text-[11px] font-bold text-abyss tabular"
          style={{ background: medal, boxShadow: `0 0 12px -2px ${medal}` }}
        >
          {rank}
        </span>
      </div>

      <p
        className={`max-w-full truncate font-medium ${isFirst ? "text-[15px] text-foam" : "text-[13px] text-foam/85"}`}
      >
        @{stat.handle}
      </p>

      {/* Metric readout. */}
      <p
        className={`mt-0.5 font-mono tabular leading-none ${isFirst ? "text-[1.35rem] font-extrabold text-tide" : "text-base font-bold text-aqua"}`}
      >
        {label}
        <span className="ml-1 align-baseline text-[9px] font-medium uppercase tracking-[0.15em] text-foam/40">
          {unit}
        </span>
      </p>

      {/* The rising-water crest column. */}
      <motion.div
        className="relative mt-3 w-full overflow-hidden rounded-t-xl"
        style={{
          height,
          border: "var(--hairline)",
          borderBottom: "none",
          boxShadow: isFirst
            ? "var(--glow-aqua), inset 0 1px 0 rgba(234,246,255,0.18)"
            : "inset 0 1px 0 rgba(234,246,255,0.1)",
        }}
        initial={reduce ? false : { clipPath: "inset(100% 0 0 0)" }}
        animate={{ clipPath: "inset(0% 0 0 0)" }}
        transition={
          reduce ? { duration: 0 } : { duration: 0.9, delay: 0.12 * (3 - rank), ease: [0.16, 1, 0.3, 1] }
        }
      >
        {/* Layered water body: foam crest at top fading down through aqua → sui → deep. */}
        <div
          className="absolute inset-0"
          style={{
            background: isFirst
              ? "linear-gradient(180deg, rgba(234,246,255,0.30) 0%, rgba(111,230,225,0.55) 22%, rgba(77,162,255,0.4) 60%, rgba(14,42,71,0.15) 100%)"
              : "linear-gradient(180deg, rgba(234,246,255,0.18) 0%, rgba(111,230,225,0.38) 26%, rgba(77,162,255,0.28) 64%, rgba(14,42,71,0.12) 100%)",
          }}
        />
        {/* Subtle wave top edge. */}
        <svg
          className="absolute left-0 top-0 w-full"
          height={12}
          viewBox="0 0 100 12"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M0 7 C 14 1, 28 1, 42 6 S 72 12, 86 6 100 4 100 4 L100 0 L0 0 Z"
            fill={isFirst ? "rgba(234,246,255,0.55)" : "rgba(234,246,255,0.32)"}
          />
        </svg>
        {/* Vertical caustic streaks for instrument texture. */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "repeating-linear-gradient(90deg, transparent 0 7px, rgba(234,246,255,0.06) 7px 8px)",
          }}
        />
        {/* Rank watermark inside the column. */}
        <span
          className="absolute bottom-1.5 left-1/2 -translate-x-1/2 font-display text-[2.4rem] font-extrabold leading-none text-foam/10"
          aria-hidden
        >
          {rank}
        </span>
      </motion.div>
    </motion.div>
  );
}

/* ---- ranked row (4..n) -------------------------------------------------- */

interface RowProps {
  stat: LeaderRow;
  rank: number;
  label: string;
  unit: string;
  fill: number; // 0..1
  reduce: boolean;
  onOpenProfile: (address: string) => void;
}

function Row({ stat, rank, label, unit, fill, reduce, onOpenProfile }: RowProps) {
  return (
    <motion.button
      type="button"
      layout
      onClick={() => onOpenProfile(stat.address)}
      className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-foam/[0.04]"
      style={{ minHeight: 44 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
    >
      <span className="w-6 shrink-0 text-center font-mono text-sm font-semibold tabular text-foam/35">
        {rank}
      </span>
      <Avatar handle={stat.handle} size={38} avatarUrl={stat.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foam/90">@{stat.handle}</p>
        {/* Rising-water level bar. */}
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-foam/[0.08]">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, var(--c-aqua), var(--c-sui))", transformOrigin: "left" }}
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: Math.max(0.04, fill) }}
            transition={reduce ? { duration: 0 } : { duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[15px] font-bold tabular text-foam">{label}</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-foam/35">
          {unit} · {stat.videos} {stat.videos === 1 ? "wave" : "waves"}
        </p>
      </div>
    </motion.button>
  );
}

/* ---- board toggle ------------------------------------------------------- */

function BoardToggle({
  active,
  onChange,
  reduce,
}: {
  active: BoardId;
  onChange: (id: BoardId) => void;
  reduce: boolean;
}) {
  return (
    <div className="glass inline-flex rounded-full p-1" role="tablist" aria-label="Leaderboard">
      {BOARDS.map((b) => {
        const isActive = b.id === active;
        return (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(b.id)}
            className={`relative rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
              isActive ? "text-abyss" : "text-foam/55 hover:text-foam/85"
            }`}
            style={{ minHeight: 32 }}
          >
            {isActive && (
              <motion.span
                layoutId="board-pill"
                className="absolute inset-0 rounded-full"
                style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            <span className="relative whitespace-nowrap">{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- screen ------------------------------------------------------------- */

interface TideChartsProps {
  /** Open a creator's profile (tapping a podium crest or ranked row). */
  onOpenProfile: (address: string) => void;
}

export function TideCharts({ onOpenProfile }: TideChartsProps) {
  const reduce = useReducedMotion() ?? false;
  const [board, setBoard] = useState<BoardId>("tips");

  // Real rankings from the indexer-rolled API; SAMPLE_FEED is the fallback only
  // when the board is empty or the request fails (same pattern as the feed).
  const query = useQuery({
    queryKey: ["leaderboard", board],
    queryFn: () => fetchLeaderboard(board, "all", 50),
    staleTime: 30_000,
  });

  const ranked = useMemo<LeaderRow[]>(() => {
    const apiRows = query.data?.rows;
    if (apiRows && apiRows.length > 0) {
      return apiRows.map((r) => ({
        address: r.address,
        handle: r.handle,
        metricRaw: r.metricRaw,
        videos: r.videoCount,
        avatarUrl: r.avatarUrl,
      }));
    }
    return sampleBoard(board);
  }, [query.data, board]);

  const usingFallback = !(query.data && query.data.rows.length > 0);

  const def: BoardDef = BOARDS.find((b) => b.id === board) ?? DEFAULT_BOARD;
  const leader = ranked[0];
  const maxMetric = leader ? leader.metricRaw : 1;

  // Podium order: #2, #1, #3 so the tallest sits in the center.
  const top3 = ranked.slice(0, 3);
  const podium: LeaderRow[] = [top3[1], top3[0], top3[2]].filter(
    (s): s is LeaderRow => s !== undefined,
  );
  const podiumRank = (s: LeaderRow): number => ranked.indexOf(s) + 1;
  const rest = ranked.slice(3);

  const verifyHref = `${SUIVISION_URLS[config.network]}/account/${leader?.address ?? ""}`;

  const verifyPill = (
    <a
      href={verifyHref}
      target="_blank"
      rel="noreferrer"
      className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-aqua/85 transition-colors hover:text-aqua"
      style={{ minHeight: 32 }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-aqua"
        style={{ boxShadow: "var(--glow-aqua)" }}
        aria-hidden
      />
      verified on Sui
      <span aria-hidden>↗</span>
    </a>
  );

  const delay = (ms: number): CSSProperties => ({ "--d": `${ms}ms` }) as CSSProperties;

  return (
    <ScreenShell
      kicker="THE TIDE CHARTS"
      title="Tide Charts"
      subtitle="who's making waves"
      action={verifyPill}
    >
      {/* Board selector. */}
      <div className="rise mb-6 flex justify-center" style={delay(0)}>
        <BoardToggle active={board} onChange={setBoard} reduce={reduce} />
      </div>

      {/* Podium — top 3 crests. */}
      <div
        className="glass rise relative mb-5 overflow-hidden rounded-3xl px-3 pb-0 pt-6"
        style={delay(60)}
      >
        {/* Instrument grid baseline under the crests. */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-px w-full"
          style={{ background: "linear-gradient(90deg, transparent, rgba(111,230,225,0.5), transparent)" }}
          aria-hidden
        />
        <div className="flex items-end justify-center gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {podium.map((s) => (
              <Crest
                key={s.address}
                stat={s}
                rank={podiumRank(s)}
                label={formatMetric(board, s.metricRaw)}
                unit={def.unit}
                reduce={reduce}
                onOpenProfile={onOpenProfile}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Ranked rows 4..n. */}
      <div className="glass rise overflow-hidden rounded-3xl p-2" style={delay(120)}>
        <div
          className="flex items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-foam/35"
          aria-hidden
        >
          <span>Rank · Creator</span>
          <span>{def.unit}</span>
        </div>
        {rest.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-foam/45">
            Only three crests are riding this tide. Post a wave to chart.
          </p>
        ) : (
          <motion.div layout className="flex flex-col">
            <AnimatePresence initial={false}>
              {rest.map((s) => (
                <Row
                  key={s.address}
                  stat={s}
                  rank={ranked.indexOf(s) + 1}
                  label={formatMetric(board, s.metricRaw)}
                  unit={def.unit}
                  fill={maxMetric > 0 ? s.metricRaw / maxMetric : 0}
                  reduce={reduce}
                  onOpenProfile={onOpenProfile}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Footnote — the instrument's provenance. */}
      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-foam/30">
        {ranked.length} {ranked.length === 1 ? "creator" : "creators"} charted ·{" "}
        {config.network} · {usingFallback ? "sample tide" : "live on-chain"}
      </p>
    </ScreenShell>
  );
}
