/**
 * Upload — the "post a wave" flow. WALLET-GATED.
 *
 * Disconnected → an on-brand glass prompt pointing at the TopBar's Connect
 * button (we never render a second ConnectButton). Connected → a four-stage
 * instrument flow:
 *   1. PICK     — a water-themed dashed drop-zone (input[type=file]).
 *   2. PREVIEW  — the clip in a 9:16 phone-frame; on loadeddata we paint the
 *                 first frame to a hidden <canvas> → JPEG poster Blob.
 *   3. CAPTION  — 150-char input with a mono char-count.
 *   4. RELEASE  — FormData (video File + poster Blob) → POST /api/upload?creator=
 *                 stores both blobs on Walrus, THEN `post_video` (wallet-signed,
 *                 broadcast via Tatum) appends a Sui Video object referencing
 *                 those blob ids — the full creator loop. An indeterminate
 *                 RISING-TIDE bar animates while in-flight; toasts track the
 *                 on-chain step. Success surfaces the Walrus blobs + the
 *                 SuiVision tx link; a failed on-chain post keeps the (already
 *                 stored) blobs so the user can retry posting without re-uploading.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import type { UploadResult } from "@suinami/shared";
import { SUIVISION_URLS, MAX_VIDEO_UPLOAD_BYTES, formatMaxBytes } from "@suinami/shared";
import { ScreenShell } from "@/components/ScreenShell";
import { config } from "@/config";
import { useWalletGate, useOnChainWrite } from "@/wallet";
import { useToast } from "@/components/Toast";

/** "View on SuiVision ↗" link for a tx digest. */
function txLink(digest: string): { href: string; label: string } {
  return {
    href: `${SUIVISION_URLS[config.network]}/txblock/${digest}`,
    label: "View on SuiVision ↗",
  };
}

/** Friendly text for a failed/rejected on-chain post_video. */
function txErr(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel/i.test(m)) return "On-chain post cancelled in your wallet.";
  if (/already in progress/i.test(m)) return "Hold on — finishing the last transaction.";
  if (/insufficient|no SUI|gas/i.test(m)) return "Not enough SUI for gas to post on-chain.";
  return m.length > 140 ? `${m.slice(0, 138)}…` : m;
}

const KICKER = "POST A WAVE";
const TITLE = "Upload";
const SUBTITLE = "ride your own short onto the Suinami";
const MAX_CAPTION = 150;

/** Compact 0x1234…cdef rendering for the owner readout. */
function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Human file size for the picked-clip readout. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** mm:ss from a duration in seconds (NaN → "—:—"). */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—:—";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Phase = "pick" | "compose" | "uploading" | "publishing" | "done" | "error";

/** The Walrus upload result, plus the on-chain post_video digest once posted. */
interface PublishResult extends UploadResult {
  digest?: string;
}

interface ClipState {
  file: File;
  /** Object URL for the chosen video (revoked on reset/unmount). */
  url: string;
  /** Captured first-frame poster Blob (null until canvas paint succeeds). */
  poster: Blob | null;
  /** Object URL for the poster preview thumbnail (null until captured). */
  posterUrl: string | null;
  durationSec: number;
  dimensions: { w: number; h: number } | null;
}

export function Upload() {
  const { address, isConnected } = useWalletGate();

  if (!isConnected || !address) {
    return (
      <ScreenShell kicker={KICKER} title={TITLE} subtitle={SUBTITLE}>
        <ConnectPrompt />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell kicker={KICKER} title={TITLE} subtitle={SUBTITLE}>
      <UploadFlow address={address} />
    </ScreenShell>
  );
}

/* ───────────────────────── disconnected ───────────────────────── */

function ConnectPrompt() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="glass relative overflow-hidden rounded-3xl p-7"
      style={{ boxShadow: "var(--glow-sui)" }}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* faint sonar etch in the corner — instrument texture */}
      <WaveGlyph className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 text-sui/15" />
      <div
        className="grid h-14 w-14 place-items-center rounded-2xl"
        style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
      >
        <LockGlyph className="h-7 w-7 text-abyss" />
      </div>

      <h2 className="mt-5 font-display text-2xl font-extrabold leading-tight tracking-tight text-foam">
        Connect your wallet to post
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-foam/65">
        Your video is stored on Walrus and transferred to{" "}
        <span className="text-aqua">you</span>{" "}
        <span className="font-mono text-[12px] text-foam/45">(send_object_to)</span>;
        your profile and the post live on Sui.
      </p>

      <div
        className="mt-6 flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{ border: "var(--hairline)", background: "rgba(77,162,255,0.06)" }}
      >
        <ArrowUpRight className="h-5 w-5 shrink-0 text-aqua" />
        <p className="text-[13px] leading-snug text-foam/70">
          Use the{" "}
          <span className="font-display font-semibold text-tide">Connect</span>{" "}
          button in the top bar to get started.
        </p>
      </div>
    </motion.div>
  );
}

/* ───────────────────────── connected flow ───────────────────────── */

function UploadFlow({ address }: { address: string }) {
  const reduce = useReducedMotion();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { postVideo } = useOnChainWrite();

  const [clip, setClip] = useState<ClipState | null>(null);
  const [caption, setCaption] = useState("");
  const [phase, setPhase] = useState<Phase>("pick");
  const [result, setResult] = useState<PublishResult | null>(null);
  // Walrus blobs survive a failed on-chain post, so the user can retry the
  // post_video step without re-uploading the (already stored) bytes.
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // Track object URLs so we always revoke the previous ones — no leaks.
  const clipRef = useRef<ClipState | null>(null);
  clipRef.current = clip;

  useEffect(() => {
    return () => {
      const c = clipRef.current;
      if (c) {
        URL.revokeObjectURL(c.url);
        if (c.posterUrl) URL.revokeObjectURL(c.posterUrl);
      }
    };
  }, []);

  const acceptFile = useCallback(
    (file: File | null | undefined) => {
    if (!file) return;
    // Client-side gate (the server re-checks size + magic bytes authoritatively).
    if (!file.type.startsWith("video/")) {
      toast.show({ kind: "error", message: "That's not a video — pick an MP4, WebM, or MOV." });
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      toast.show({
        kind: "error",
        message: `Video is too large (max ${formatMaxBytes(MAX_VIDEO_UPLOAD_BYTES)}).`,
      });
      return;
    }
    setClip((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.url);
        if (prev.posterUrl) URL.revokeObjectURL(prev.posterUrl);
      }
      return {
        file,
        url: URL.createObjectURL(file),
        poster: null,
        posterUrl: null,
        durationSec: Number.NaN,
        dimensions: null,
      };
    });
    setCaption("");
    setResult(null);
    setUploaded(null);
    setErrorMsg(null);
    setPhase("compose");
    },
    [toast],
  );

  const onFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => acceptFile(e.target.files?.[0]),
    [acceptFile],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setDragActive(false);
      acceptFile(e.dataTransfer.files?.[0]);
    },
    [acceptFile],
  );

  /** Patch the clip with the captured poster + measured metadata. */
  const onClipMeta = useCallback(
    (meta: { poster: Blob | null; posterUrl: string | null; durationSec: number; w: number; h: number }) => {
      setClip((prev) => {
        if (!prev) {
          if (meta.posterUrl) URL.revokeObjectURL(meta.posterUrl);
          return prev;
        }
        if (prev.posterUrl && prev.posterUrl !== meta.posterUrl) {
          URL.revokeObjectURL(prev.posterUrl);
        }
        return {
          ...prev,
          poster: meta.poster,
          posterUrl: meta.posterUrl,
          durationSec: meta.durationSec,
          dimensions: { w: meta.w, h: meta.h },
        };
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setClip((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.url);
        if (prev.posterUrl) URL.revokeObjectURL(prev.posterUrl);
      }
      return null;
    });
    setCaption("");
    setResult(null);
    setUploaded(null);
    setErrorMsg(null);
    setPhase("pick");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  // STEP 2 of the release: publish on-chain (post_video) using the stored Walrus
  // blob ids. Wallet-signed + broadcast via Tatum; the bytes are NOT re-uploaded.
  const doPublish = useCallback(
    async (blobs: UploadResult) => {
      setPhase("publishing");
      setErrorMsg(null);
      const tid = toast.show({
        kind: "pending",
        message: "Publishing on-chain — confirm in your wallet…",
      });
      try {
        const dims = clip?.dimensions;
        const durationMs =
          clip && Number.isFinite(clip.durationSec) ? Math.round(clip.durationSec * 1000) : 0;
        const res = await postVideo({
          blobId: blobs.videoBlobId,
          posterBlob: blobs.posterBlobId,
          caption: caption.trim(),
          durationMs,
          width: dims?.w ?? 720,
          height: dims?.h ?? 1280,
        });
        if (res?.digest) {
          toast.update(tid, {
            kind: "success",
            message: "Wave posted on-chain",
            link: txLink(res.digest),
          });
          setResult({ ...blobs, digest: res.digest });
          // The new Video lands in the feed within an indexer tick.
          void queryClient.invalidateQueries({ queryKey: ["feed"] });
        } else {
          // Package not configured (no on-chain target) — the Walrus upload still
          // succeeded, so show the blobs without a tx link rather than erroring.
          toast.dismiss(tid);
          setResult({ ...blobs });
        }
        setPhase("done");
      } catch (err) {
        toast.update(tid, { kind: "error", message: txErr(err) });
        setErrorMsg(txErr(err));
        setPhase("error");
      }
    },
    [caption, clip, postVideo, queryClient, toast],
  );

  // STEP 1: store the video + poster on Walrus, then chain into the on-chain post.
  const release = useCallback(async () => {
    if (!clip) return;
    setPhase("uploading");
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append("video", clip.file);
      if (clip.poster) {
        form.append("poster", clip.poster, "poster.jpg");
      }
      if (caption.trim()) form.append("caption", caption.trim());

      const endpoint = `${config.apiBaseUrl}/api/upload?creator=${encodeURIComponent(address)}`;
      const res = await fetch(endpoint, { method: "POST", body: form });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          detail.trim().slice(0, 160) || `Upload failed (HTTP ${res.status})`,
        );
      }

      const json = (await res.json()) as Partial<UploadResult>;
      if (!json.videoBlobId || !json.posterBlobId) {
        throw new Error("The aggregator returned an incomplete response.");
      }
      const blobs: UploadResult = {
        videoBlobId: json.videoBlobId,
        posterBlobId: json.posterBlobId,
      };
      setUploaded(blobs);
      await doPublish(blobs); // chain straight into the on-chain post_video
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Couldn't reach the Walrus uploader. Check your connection and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong releasing your wave.";
      setErrorMsg(message);
      setPhase("error");
    }
  }, [address, caption, clip, doPublish]);

  // The release button's action: retry just the on-chain post if the bytes are
  // already on Walrus (post failed/rejected), else run the full release.
  const onReleasePress = useCallback(() => {
    if (uploaded) void doPublish(uploaded);
    else void release();
  }, [uploaded, doPublish, release]);

  const busy = phase === "uploading" || phase === "publishing";
  const stepIndex =
    phase === "pick" ? 0 : phase === "done" ? 3 : busy || phase === "error" ? 2 : 1;

  return (
    <div className="space-y-5">
      <StepRail current={stepIndex} owner={address} />

      <AnimatePresence mode="wait" initial={false}>
        {phase === "pick" && (
          <PhaseShell key="pick" reduce={reduce}>
            <DropZone
              active={dragActive}
              onClick={() => inputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
            />
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={onFileInput}
            />
          </PhaseShell>
        )}

        {clip && (phase === "compose" || busy || phase === "error") && (
          <PhaseShell key="compose" reduce={reduce}>
            <ComposeStage
              clip={clip}
              caption={caption}
              onCaption={setCaption}
              onClipMeta={onClipMeta}
              onChangeClip={() => inputRef.current?.click()}
              onRelease={onReleasePress}
              busy={busy}
              busyKind={phase === "publishing" ? "chain" : "walrus"}
              releaseLabel={
                phase === "error"
                  ? uploaded
                    ? "Sign & post on-chain"
                    : "Try the release again"
                  : "Release the wave"
              }
              errorMsg={phase === "error" ? errorMsg : null}
              reduce={reduce}
            />
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={onFileInput}
            />
          </PhaseShell>
        )}

        {phase === "done" && result && (
          <PhaseShell key="done" reduce={reduce}>
            <SuccessStage result={result} onReset={reset} reduce={reduce} />
          </PhaseShell>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Shared enter/exit wrapper so phase swaps feel like one tide turning. */
function PhaseShell({ children, reduce }: { children: ReactNode; reduce: boolean | null }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── step rail (instrument) ───────────────────────── */

const STEPS = ["pick", "preview", "release", "live"] as const;

function StepRail({ current, owner }: { current: number; owner: string }) {
  return (
    <div className="glass rounded-2xl px-4 py-3" style={{ border: "var(--hairline)" }}>
      <div className="flex items-center justify-between gap-1">
        {STEPS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] transition-colors"
                style={{
                  background:
                    state === "active"
                      ? "var(--grad-tide)"
                      : state === "done"
                        ? "rgba(111,230,225,0.18)"
                        : "rgba(234,246,255,0.05)",
                  color:
                    state === "active"
                      ? "var(--c-abyss)"
                      : state === "done"
                        ? "var(--c-aqua)"
                        : "rgba(234,246,255,0.4)",
                  boxShadow: state === "active" ? "var(--glow-aqua)" : "none",
                  border: state === "todo" ? "var(--hairline)" : "none",
                }}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={
                  "truncate font-mono text-[10px] uppercase tracking-[0.18em] " +
                  (state === "active"
                    ? "text-foam"
                    : state === "done"
                      ? "text-aqua/70"
                      : "text-foam/30")
                }
              >
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className="ml-0.5 hidden h-px flex-1 sm:block"
                  style={{ background: "rgba(234,246,255,0.1)" }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        className="mt-2.5 flex items-center justify-between border-t pt-2"
        style={{ borderColor: "rgba(234,246,255,0.08)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foam/35">
          owner
        </span>
        <a
          href={`${SUIVISION_URLS[config.network]}/account/${owner}`}
          target="_blank"
          rel="noreferrer"
          className="tabular font-mono text-[11px] text-aqua/80 transition-colors hover:text-aqua"
        >
          {truncateAddress(owner)} ↗
        </a>
      </div>
    </div>
  );
}

/* ───────────────────────── stage 1 — drop zone ───────────────────────── */

interface DropZoneProps {
  active: boolean;
  onClick: () => void;
  onDrop: (e: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (e: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: () => void;
}

function DropZone({ active, onClick, onDrop, onDragOver, onDragLeave }: DropZoneProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className="group relative grid w-full place-items-center overflow-hidden rounded-3xl px-6 py-14 text-center transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua/60"
      style={{
        minHeight: "16rem",
        background: active
          ? "radial-gradient(120% 90% at 50% 0%, rgba(111,230,225,0.16), rgba(10,20,40,0.55) 70%)"
          : "var(--surface-blur)",
        backdropFilter: "blur(20px) saturate(135%)",
        WebkitBackdropFilter: "blur(20px) saturate(135%)",
        border: active
          ? "2px dashed rgba(111,230,225,0.8)"
          : "2px dashed rgba(77,162,255,0.35)",
        boxShadow: active ? "var(--glow-aqua)" : "none",
      }}
    >
      {/* concentric sonar rings behind the glyph */}
      <span aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ border: "1px solid rgba(77,162,255,0.14)" }}
        />
        <span
          className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ border: "1px solid rgba(77,162,255,0.08)" }}
        />
      </span>

      <span
        className="relative grid h-16 w-16 place-items-center rounded-2xl transition-transform duration-300 group-hover:-translate-y-1"
        style={{
          background: "var(--grad-tide)",
          boxShadow: active ? "var(--glow-aqua)" : "var(--glow-sui)",
        }}
      >
        <DownloadGlyph className="h-8 w-8 text-abyss" />
      </span>

      <span className="relative mt-5 font-display text-xl font-bold tracking-tight text-foam">
        {active ? "Release to drop in" : "Drop a vertical clip"}
      </span>
      <span className="relative mt-1.5 text-sm text-foam/55">
        Tap to browse, or drag a video here
      </span>
      <span className="relative mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-aqua/55">
        MP4 · MOV · WEBM · 9:16 looks best
      </span>
    </button>
  );
}

/* ───────────────────────── stage 2/3/4 — compose ───────────────────────── */

interface ComposeStageProps {
  clip: ClipState;
  caption: string;
  onCaption: (v: string) => void;
  onClipMeta: (meta: {
    poster: Blob | null;
    posterUrl: string | null;
    durationSec: number;
    w: number;
    h: number;
  }) => void;
  onChangeClip: () => void;
  onRelease: () => void;
  /** True while either the Walrus upload OR the on-chain post is in flight. */
  busy: boolean;
  /** Which busy step is running (drives the progress label). */
  busyKind: "walrus" | "chain";
  /** Text for the release/retry button. */
  releaseLabel: string;
  errorMsg: string | null;
  reduce: boolean | null;
}

function ComposeStage({
  clip,
  caption,
  onCaption,
  onClipMeta,
  onChangeClip,
  onRelease,
  busy,
  busyKind,
  releaseLabel,
  errorMsg,
  reduce,
}: ComposeStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Capture the poster at most once per clip URL.
  const capturedFor = useRef<string | null>(null);

  const handleLoadedData = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video) return;

    const w = video.videoWidth || clip.dimensions?.w || 720;
    const h = video.videoHeight || clip.dimensions?.h || 1280;
    const durationSec = video.duration;

    if (capturedFor.current === clip.url) {
      onClipMeta({ poster: clip.poster, posterUrl: clip.posterUrl, durationSec, w, h });
      return;
    }
    capturedFor.current = clip.url;

    // Paint the current frame → JPEG poster Blob. Guard the whole thing:
    // a tainted/again-decoding frame must never break the flow.
    try {
      if (!canvas) throw new Error("no canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            onClipMeta({ poster: null, posterUrl: null, durationSec, w, h });
            return;
          }
          onClipMeta({
            poster: blob,
            posterUrl: URL.createObjectURL(blob),
            durationSec,
            w,
            h,
          });
        },
        "image/jpeg",
        0.8,
      );
    } catch {
      onClipMeta({ poster: null, posterUrl: null, durationSec, w, h });
    }
  }, [clip.dimensions, clip.poster, clip.posterUrl, clip.url, onClipMeta]);

  const remaining = MAX_CAPTION - caption.length;
  const dims = clip.dimensions;
  const posterReady = clip.poster !== null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-5">
        {/* phone-frame preview */}
        <div className="mx-auto w-full max-w-[15rem]">
          <PhoneFrame>
            <video
              ref={videoRef}
              src={clip.url}
              muted
              loop
              playsInline
              autoPlay
              onLoadedData={handleLoadedData}
              className="h-full w-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" aria-hidden />

            {busy && <RisingTide reduce={reduce} busyKind={busyKind} />}

            {/* corner metric readouts — instrument chrome */}
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
              <div className="flex items-center justify-between">
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-aqua"
                  style={{ background: "rgba(10,20,40,0.6)", border: "var(--hairline)" }}
                >
                  preview
                </span>
                <span
                  className="tabular rounded-full px-2 py-0.5 font-mono text-[10px] text-foam/80"
                  style={{ background: "rgba(10,20,40,0.6)", border: "var(--hairline)" }}
                >
                  {formatDuration(clip.durationSec)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="tabular font-mono text-[10px] text-foam/60">
                  {dims ? `${dims.w}×${dims.h}` : "····×····"}
                </span>
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.15em]"
                  style={{ color: posterReady ? "var(--c-aqua)" : "rgba(234,246,255,0.4)" }}
                >
                  {posterReady ? "● poster" : "○ poster"}
                </span>
              </div>
            </div>
          </PhoneFrame>
        </div>

        {/* file meta strip */}
        <div
          className="glass flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{ border: "var(--hairline)" }}
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: "rgba(77,162,255,0.12)" }}
          >
            <FilmGlyph className="h-5 w-5 text-sui" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foam">{clip.file.name}</p>
            <p className="tabular mt-0.5 font-mono text-[11px] text-foam/45">
              {formatBytes(clip.file.size)}
            </p>
          </div>
          {!busy && (
            <button
              type="button"
              onClick={onChangeClip}
              className="min-h-[40px] shrink-0 rounded-full px-3 font-mono text-[11px] uppercase tracking-[0.15em] text-aqua/80 transition-colors hover:text-aqua focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua/60"
            >
              change
            </button>
          )}
        </div>

        {/* caption */}
        <div className="glass rounded-2xl p-4" style={{ border: "var(--hairline)" }}>
          <div className="mb-2 flex items-center justify-between">
            <label
              htmlFor="suinami-caption"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-foam/40"
            >
              caption
            </label>
            <span
              className={
                "tabular font-mono text-[11px] " +
                (remaining < 0
                  ? "text-coral"
                  : remaining <= 20
                    ? "text-aqua"
                    : "text-foam/40")
              }
            >
              {caption.length}/{MAX_CAPTION}
            </span>
          </div>
          <input
            id="suinami-caption"
            type="text"
            value={caption}
            maxLength={MAX_CAPTION}
            disabled={busy}
            onChange={(e) => onCaption(e.target.value)}
            placeholder="say something about this wave…"
            className="w-full bg-transparent text-base text-foam placeholder:text-foam/30 focus:outline-none disabled:opacity-50"
          />
          <div
            className="mt-2 h-px w-full"
            style={{
              background:
                caption.length > 0
                  ? "var(--grad-tide)"
                  : "rgba(234,246,255,0.12)",
            }}
          />
        </div>
      </div>

      {/* error message */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 rounded-2xl px-4 py-3"
            style={{ border: "1px solid rgba(255,107,107,0.4)", background: "rgba(255,107,107,0.08)" }}
            role="alert"
          >
            <AlertGlyph className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
            <p className="text-[13px] leading-snug text-foam/85">{errorMsg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* release */}
      {busy ? (
        <UploadProgress reduce={reduce} busyKind={busyKind} />
      ) : (
        <button
          type="button"
          onClick={onRelease}
          className="group relative flex min-h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-6 font-display text-base font-bold tracking-tight text-abyss transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua/70"
          style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
        >
          <WaveGlyph className="h-5 w-5" />
          {releaseLabel}
        </button>
      )}
    </div>
  );
}

/** 9:16 phone-frame with bezel + water chrome (notch + side glints). */
function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mx-auto aspect-[9/16] w-full overflow-hidden rounded-[1.8rem] p-[3px]"
      style={{
        background:
          "linear-gradient(160deg, rgba(111,230,225,0.5), rgba(77,162,255,0.18) 45%, rgba(10,20,40,0.9))",
        boxShadow: "var(--glow-sui), inset 0 0 0 1px rgba(234,246,255,0.06)",
      }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[1.6rem] bg-abyss">
        {children}
        {/* notch */}
        <span
          aria-hidden
          className="absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full"
          style={{ background: "rgba(10,20,40,0.7)", border: "var(--hairline)" }}
        />
        {/* surface glint */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[1.6rem]"
          style={{
            background:
              "linear-gradient(120deg, rgba(234,246,255,0.08) 0%, transparent 22%, transparent 80%, rgba(111,230,225,0.06) 100%)",
          }}
        />
      </div>
    </div>
  );
}

/** Indeterminate RISING-TIDE water fill drawn inside the phone frame. */
function RisingTide({ reduce, busyKind }: { reduce: boolean | null; busyKind: "walrus" | "chain" }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{tideFillKeyframes}</style>
      <div className="absolute inset-0" style={{ background: "rgba(10,20,40,0.55)" }} />
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: "120%",
          background:
            "linear-gradient(to top, rgba(77,162,255,0.55) 0%, rgba(111,230,225,0.35) 55%, rgba(111,230,225,0.12) 100%)",
          animation: reduce ? "none" : "suinami-tide-fill 2.6s cubic-bezier(0.45,0,0.2,1) infinite",
          transform: reduce ? "translateY(35%)" : undefined,
          willChange: "transform",
        }}
      />
      {/* wave crest line riding the surface */}
      <div
        className="absolute inset-x-0"
        style={{
          bottom: "0",
          height: "2px",
          background: "linear-gradient(to right, transparent, var(--c-aqua), transparent)",
          animation: reduce ? "none" : "suinami-tide-crest 2.6s cubic-bezier(0.45,0,0.2,1) infinite",
        }}
      />
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
        <Spinner />
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-foam">
          {busyKind === "chain" ? "posting on-chain" : "storing on walrus"}
        </span>
      </div>
    </div>
  );
}

/** Slim status line + label under the button while uploading or posting. */
function UploadProgress({ reduce, busyKind }: { reduce: boolean | null; busyKind: "walrus" | "chain" }) {
  const chain = busyKind === "chain";
  return (
    <div className="glass rounded-2xl px-4 py-4" style={{ border: "var(--hairline)" }}>
      <style>{barSweepKeyframes}</style>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-aqua">
          {chain ? "publishing…" : "releasing…"}
        </span>
        <span className="font-mono text-[11px] text-foam/45">
          {chain ? "post_video · suinami::feed" : "two blobs · video + poster"}
        </span>
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(234,246,255,0.08)" }}
      >
        <div
          className="absolute inset-y-0 w-2/5 rounded-full"
          style={{
            background: "var(--grad-tide)",
            boxShadow: "var(--glow-aqua)",
            animation: reduce ? "none" : "suinami-bar-sweep 1.6s ease-in-out infinite",
            left: reduce ? "0" : undefined,
            width: reduce ? "100%" : undefined,
          }}
        />
      </div>
      <p className="mt-2.5 text-[12px] leading-snug text-foam/50">
        {chain
          ? "Confirm in your wallet — minting a Sui Video object that links these Walrus blobs into the on-chain feed."
          : "Encrypting + erasure-coding across Walrus storage nodes, then transferring the blobs to you. This can take a moment."}
      </p>
    </div>
  );
}

/* ───────────────────────── stage 5 — success ───────────────────────── */

function SuccessStage({
  result,
  onReset,
  reduce,
}: {
  result: PublishResult;
  onReset: () => void;
  reduce: boolean | null;
}) {
  const videoUrl = `${config.walrusAggregatorUrl}/v1/blobs/${result.videoBlobId}`;
  return (
    <div className="space-y-4">
      <div
        className="glass relative overflow-hidden rounded-3xl p-6 text-center"
        style={{ boxShadow: "var(--glow-aqua)" }}
      >
        <motion.div
          className="mx-auto grid h-16 w-16 place-items-center rounded-full"
          style={{ background: "var(--grad-tide)", boxShadow: "var(--glow-aqua)" }}
          initial={reduce ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        >
          <CheckGlyph className="h-8 w-8 text-abyss" />
        </motion.div>
        <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-foam">
          Your wave is live
        </h2>
        <p className="mt-1.5 text-sm text-foam/60">
          Stored on Walrus, owned by you.
        </p>

        <div className="mt-5 space-y-2 text-left">
          <BlobRow label="video blob" value={result.videoBlobId} />
          <BlobRow label="poster blob" value={result.posterBlobId} />
        </div>

        <a
          href={videoUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 font-display text-sm font-semibold text-abyss transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua/70"
          style={{ background: "var(--grad-tide)" }}
        >
          view on Walrus ↗
        </a>
      </div>

      {result.digest ? (
        <a
          href={`${SUIVISION_URLS[config.network]}/txblock/${result.digest}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-sui/10"
          style={{ border: "1px solid rgba(77,162,255,0.32)", background: "rgba(77,162,255,0.06)" }}
        >
          <ChainGlyph className="h-5 w-5 shrink-0 text-sui" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-foam/85">
              Posted on-chain · <span className="font-mono">post_video</span>
            </p>
            <p className="tabular truncate font-mono text-[11px] text-foam/50">{result.digest}</p>
          </div>
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-aqua">
            SuiVision ↗
          </span>
        </a>
      ) : (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{ border: "var(--hairline)", background: "rgba(77,162,255,0.06)" }}
        >
          <ChainGlyph className="mt-0.5 h-5 w-5 shrink-0 text-sui" />
          <p className="text-[12px] leading-snug text-foam/65">
            Stored on Walrus and transferred to you. Your{" "}
            <span className="font-mono text-foam/80">post_video</span> object links these
            blobs into the on-chain feed.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 font-display text-sm font-semibold text-foam transition-colors hover:text-aqua focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua/60"
        style={{ border: "var(--hairline)", background: "var(--surface-blur)" }}
      >
        <PlusGlyph className="h-4 w-4" />
        post another wave
      </button>
    </div>
  );
}

/** A mono blob-ID readout with copy affordance via select-all on click. */
function BlobRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ border: "var(--hairline)", background: "rgba(10,20,40,0.4)" }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-aqua/60">
          {label}
        </span>
        <span aria-hidden className="font-mono text-[10px] text-foam/30">
          walrus
        </span>
      </div>
      <p className="tabular mt-1 break-all font-mono text-[11px] leading-snug text-foam/85">
        {value}
      </p>
    </div>
  );
}

/* ───────────────────────── tiny shared bits ───────────────────────── */

function Spinner() {
  // The global prefers-reduced-motion rule in index.css collapses this
  // animation to a near-instant duration, so no extra guard is needed.
  return (
    <span
      className="block h-6 w-6 rounded-full"
      style={{
        border: "2px solid rgba(234,246,255,0.2)",
        borderTopColor: "var(--c-aqua)",
        animation: "suinami-spin 0.9s linear infinite",
      }}
    >
      <style>{`@keyframes suinami-spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}

const tideFillKeyframes = `
@keyframes suinami-tide-fill {
  0%   { transform: translateY(95%); }
  85%  { transform: translateY(5%); }
  100% { transform: translateY(0%); }
}
@keyframes suinami-tide-crest {
  0%   { transform: translateY(-5px); opacity: 0.4; }
  85%  { transform: translateY(calc(-100% + 24px)); opacity: 0.9; }
  100% { transform: translateY(calc(-100% + 18px)); opacity: 1; }
}`;

const barSweepKeyframes = `
@keyframes suinami-bar-sweep {
  0%   { left: -40%; }
  100% { left: 100%; }
}`;

/* ───────────────────────── glyphs (inline SVG, no assets) ───────────────────────── */

interface GlyphProps {
  className?: string;
}

/** Shared stroke icon frame so every glyph stays visually consistent. */
function Glyph({
  className,
  strokeWidth = 2,
  children,
}: {
  className?: string;
  strokeWidth?: number;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

function WaveGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M2 8c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
      <path d="M2 13c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
      <path d="M2 18c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
    </Glyph>
  );
}

function DownloadGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Glyph>
  );
}

function FilmGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </Glyph>
  );
}

function LockGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Glyph>
  );
}

function ArrowUpRight({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </Glyph>
  );
}

function AlertGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    </Glyph>
  );
}

function CheckGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className} strokeWidth={2.6}>
      <path d="m5 13 4 4L19 7" />
    </Glyph>
  );
}

function ChainGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M9 12a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1.5" />
      <path d="M15 12a3 3 0 0 1-3 3H9a3 3 0 0 1 0-6h1.5" />
    </Glyph>
  );
}

function PlusGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}
