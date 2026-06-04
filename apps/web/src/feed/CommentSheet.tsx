/**
 * CommentSheet — frosted bottom-sheet comment thread.
 *
 * Slides up over a tap-to-dismiss scrim (mirrors GiftSheet). Reads + writes the
 * off-chain comments API via TanStack Query, with an optimistic prepend on post.
 *
 * SECURITY: every user field (body, handle) is rendered as a plain React text
 * node — NEVER via dangerouslySetInnerHTML — so React auto-escapes it and stored
 * markup such as `<script>` or `<img onerror=…>` shows as literal text, not DOM.
 * Bodies use `white-space: pre-wrap` + `break-words` to keep newlines and wrap
 * long unbroken strings (no layout-breaking overflow). Input is sanitized with
 * the same shared `sanitizeCommentText` the server enforces.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  MAX_COMMENT_LENGTH,
  sanitizeCommentText,
  shortAddress,
  type Comment,
  type CommentsPage,
} from "@suinami/shared";
import { fetchComments, postComment } from "@/lib/api";
import type { CommentSheetProps } from "@/feed/contracts";
import { cn } from "@/lib/cn";

/** Compact relative time: "now", "3m", "2h", "5d", or a date. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 45_000) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CommentSheet({
  open,
  card,
  address,
  onClose,
  onCount,
}: CommentSheetProps) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const videoId = card?.videoId ?? "";
  const [text, setText] = useState("");
  const tmpSeq = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const queryKey = ["comments", videoId] as const;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchComments(videoId),
    enabled: open && videoId.length > 0,
    staleTime: 10_000,
  });

  // Keep the rail's count in sync with the live total.
  useEffect(() => {
    if (data && videoId) onCount?.(videoId, data.total);
  }, [data, videoId, onCount]);

  // Reset the draft whenever the sheet target changes / closes.
  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: (clean: string) =>
      postComment(videoId, {
        body: clean,
        author: address ?? undefined,
        handle: address ? shortAddress(address) : undefined,
      }),
    onMutate: async (clean: string) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CommentsPage>(queryKey);
      const optimistic: Comment = {
        id: `tmp-${Date.now()}-${tmpSeq.current++}`,
        videoId,
        author: address ?? "",
        handle: address ? shortAddress(address) : "guest",
        body: clean,
        createdAt: Date.now(),
      };
      qc.setQueryData<CommentsPage>(queryKey, (old) => ({
        comments: [optimistic, ...(old?.comments ?? [])],
        total: (old?.total ?? 0) + 1,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });

  function submit() {
    const clean = sanitizeCommentText(text);
    if (!clean || mutation.isPending) return;
    setText("");
    mutation.mutate(clean);
    // Jump to the newest (top) after an optimistic prepend.
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
  }

  const comments = data?.comments ?? [];
  const total = data?.total ?? comments.length;
  const remaining = MAX_COMMENT_LENGTH - text.length;
  const handle = card?.handle ?? "creator";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          {/* Scrim — tap to dismiss. */}
          <button
            type="button"
            aria-label="Close comments"
            onClick={onClose}
            className="absolute inset-0 bg-abyss/70"
          />

          {/* Sheet. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Comments on @${handle}'s video`}
            className="safe-bottom safe-x relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border-t border-white/15"
            style={{
              maxHeight: "82dvh",
              background: "var(--surface-blur)",
              backdropFilter: "blur(24px) saturate(150%)",
              WebkitBackdropFilter: "blur(24px) saturate(150%)",
            }}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={
              reduce ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 34 }
            }
          >
            {/* Grab handle. */}
            <div className="flex shrink-0 justify-center pt-3">
              <span className="h-1 w-10 rounded-full bg-foam/25" aria-hidden />
            </div>

            {/* Header. */}
            <div className="flex shrink-0 items-baseline justify-between px-5 pb-2 pt-3">
              <p className="font-display text-lg font-bold text-foam">Comments</p>
              <p className="tabular font-mono text-xs text-foam/50">
                {total} {total === 1 ? "wave" : "waves"}
              </p>
            </div>

            {/* List. */}
            <div
              ref={listRef}
              className="no-scrollbar min-h-[120px] flex-1 overflow-y-auto px-5 py-2"
              style={{ overscrollBehavior: "contain" }}
            >
              {isLoading ? (
                <p className="py-8 text-center text-sm text-foam/40">loading the tide…</p>
              ) : isError ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-foam/60">couldn&apos;t load comments</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-2 text-xs font-semibold text-aqua"
                  >
                    retry
                  </button>
                </div>
              ) : comments.length === 0 ? (
                <p className="py-10 text-center text-sm text-foam/40">
                  no waves yet — be the first to comment
                </p>
              ) : (
                <ul className="flex flex-col gap-4 py-1">
                  {comments.map((c) => (
                    <CommentRow key={c.id} comment={c} />
                  ))}
                </ul>
              )}
            </div>

            {/* Composer. */}
            <div className="shrink-0 border-t border-white/10 px-4 pb-4 pt-3">
              <div
                className="flex items-end gap-2 rounded-2xl border border-white/10 px-3 py-2"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-foam/40 font-display text-xs font-bold uppercase text-foam">
                  {(address ? shortAddress(address)[2] : "G")?.toUpperCase() ?? "G"}
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={1}
                  maxLength={MAX_COMMENT_LENGTH}
                  placeholder={address ? "add a comment…" : "comment as guest…"}
                  aria-label="Write a comment"
                  className="max-h-24 min-h-[24px] w-full resize-none bg-transparent text-sm leading-snug text-foam outline-none placeholder:text-foam/35"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={sanitizeCommentText(text).length === 0 || mutation.isPending}
                  aria-label="Post comment"
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-abyss transition-transform active:scale-90",
                    "disabled:opacity-40",
                  )}
                  style={{ backgroundImage: "linear-gradient(135deg, var(--c-sui), var(--c-aqua))" }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M3 11l18-8-8 18-2-7-8-3z" />
                  </svg>
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between px-1">
                <p className="text-[11px] text-foam/40">
                  {address ? `commenting as ${shortAddress(address)}` : "connect a wallet to sign your comment"}
                </p>
                {remaining <= 80 ? (
                  <p className={cn("tabular font-mono text-[11px]", remaining < 0 ? "text-coral" : "text-foam/40")}>
                    {remaining}
                  </p>
                ) : null}
              </div>
              {mutation.isError ? (
                <p className="mt-1 px-1 text-[11px] text-coral">
                  {(mutation.error as Error)?.message ?? "couldn't post — try again"}
                </p>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** A single comment row. All user fields are plain text nodes (auto-escaped). */
function CommentRow({ comment }: { comment: Comment }) {
  const letter = (comment.handle[0] ?? "?").toUpperCase();
  const pending = comment.id.startsWith("tmp-");
  return (
    <li className={cn("flex gap-3", pending && "opacity-60")}>
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold text-abyss"
        style={{ backgroundImage: "linear-gradient(150deg, var(--c-sui), var(--c-aqua))" }}
        aria-hidden
      >
        {letter}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* Plain text — React escapes; never innerHTML. */}
          <span className="truncate font-semibold text-foam">{comment.handle}</span>
          <span className="tabular shrink-0 font-mono text-[11px] text-foam/40">
            {pending ? "sending…" : relativeTime(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug text-foam/90">
          {comment.body}
        </p>
      </div>
    </li>
  );
}
