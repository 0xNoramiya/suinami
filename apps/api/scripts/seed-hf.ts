/**
 * Upload the HyperFrames-rendered brand ads (motion/suinami-ads/renders/*.mp4) to
 * Walrus and FEATURE them in the feed. These are the premium, code-driven promos
 * (HTML source of truth, rendered via `npx hyperframes render`) — richer than the
 * ffmpeg `ad:*` cards. Each gets an extracted poster; both blobs go to Walrus
 * (send_object_to the brand address).
 *
 * Composes with seed-ads.ts / seed-walrus.ts: it preserves existing ad + clip cards,
 * drops any prior "hf:*" cards, and weaves the new HyperFrames cards in — hero first
 * (so the app opens on the brand piece), the rest every couple of cards.
 *
 * Idempotent. Run from repo root:  pnpm seed:hf
 */
import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { promisify } from "node:util";

import { blobUrl, storeBlob } from "@suinami/walrus";
import { SAMPLE_FEED } from "../../web/src/feed/sampleFeed";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
loadEnv({ path: resolve(REPO, ".env") });

const publisherUrl = process.env.WALRUS_PUBLISHER_URL ?? "";
const aggregatorUrl = process.env.WALRUS_AGGREGATOR_URL ?? "";
const epochs = Number(process.env.WALRUS_DEFAULT_EPOCHS ?? "5");
const RENDERS = resolve(REPO, "motion/suinami-ads/renders");
const OUT = resolve(REPO, "apps/web/src/feed/sampleFeed.ts");
const MIST = 1_000_000_000;

// Same "suinami official" brand address as the ffmpeg ads — consistent ownership.
const BRAND = "0x5117a3d10e1b4f0a9c2d6e8f3b7a1c5d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9";

interface HfMeta {
  id: string;
  file: string;
  caption: string;
  likeCount: number;
  viewCount: number;
  tipSui: number;
}

const META: HfMeta[] = [
  { id: "hero", file: "suinami-hero.mp4", caption: "suinami — a wave of shorts 🌊 videos on Walrus, social on Sui", likeCount: 2140, viewCount: 31800, tipSui: 5.2 },
  { id: "own", file: "suinami-own.mp4", caption: "own every frame — your video lives on Walrus, you hold the blob 🔑", likeCount: 1560, viewCount: 22400, tipSui: 3.3 },
  { id: "tsunami", file: "suinami-tsunami.mp4", caption: "ripple → wave → tsunami 🌊 send real SUI on-chain", likeCount: 1880, viewCount: 26900, tipSui: 4.6 },
];

interface Card {
  videoId: string;
  creator: string;
  handle: string;
  avatarUrl: string | null;
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  likeCount: number;
  viewCount: number;
  tipTotal: string;
  durationMs: number;
  width: number;
  height: number;
  createdAt: number;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let a = 1; a <= tries; a++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`   ⟳ ${label} attempt ${a}/${tries}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2500 * a));
    }
  }
  throw last;
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

async function main(): Promise<void> {
  if (!publisherUrl || !aggregatorUrl) {
    console.error("✗ WALRUS_* missing in .env");
    process.exit(1);
  }
  const base = Date.now();
  const hfCards: Card[] = [];

  for (const m of META) {
    const mp4 = `${RENDERS}/${m.file}`;
    if (!existsSync(mp4)) {
      console.error(`✗ ${mp4} not found — run \`npx hyperframes render\` in motion/suinami-ads first.`);
      process.exit(1);
    }
    const poster = `${RENDERS}/${m.id}-poster.jpg`;
    await exec("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.6", "-i", mp4, "-frames:v", "1", "-q:v", "3", poster]);
    const durMs = Math.round((await probeDuration(mp4)) * 1000);
    const videoBytes = readFileSync(mp4);
    const posterBytes = readFileSync(poster);
    console.log(`↑ hf:${m.id} — ${Math.round(videoBytes.length / 1024)}KB video + ${Math.round(posterBytes.length / 1024)}KB poster …`);
    const v = await withRetry(`${m.id} video`, () => storeBlob(videoBytes, { publisherUrl, epochs, sendObjectTo: BRAND }));
    const p = await withRetry(`${m.id} poster`, () => storeBlob(posterBytes, { publisherUrl, epochs, sendObjectTo: BRAND }));
    console.log(`  ✓ hf:${m.id}: video=${v.blobId.slice(0, 10)}…`);
    hfCards.push({
      videoId: `hf:${m.id}`,
      creator: BRAND,
      handle: "suinami",
      avatarUrl: null,
      videoUrl: blobUrl(aggregatorUrl, v.blobId),
      posterUrl: blobUrl(aggregatorUrl, p.blobId),
      caption: m.caption,
      likeCount: m.likeCount,
      viewCount: m.viewCount,
      tipTotal: String(Math.round(m.tipSui * MIST)),
      durationMs: durMs,
      width: 1080,
      height: 1920,
      createdAt: base - META.indexOf(m) * 1200_000,
    });
  }

  // Preserve existing ad + clip cards (drop prior hf:*). Feature hero first, then
  // weave the remaining HyperFrames cards in every couple of cards.
  const rest = (SAMPLE_FEED as Card[]).filter((c) => !c.videoId.startsWith("hf:"));
  const merged: Card[] = [];
  let hi = 0;
  if (hfCards[0]) merged.push(hfCards[hi++]!); // hero opens the feed
  for (let ri = 0; ri < rest.length; ri++) {
    merged.push(rest[ri]!);
    if ((ri + 1) % 2 === 0 && hi < hfCards.length) merged.push(hfCards[hi++]!);
  }
  while (hi < hfCards.length) merged.push(hfCards[hi++]!);

  const body = `/**
 * AUTO-GENERATED — feed manifest. Every videoUrl/posterUrl is a live Walrus testnet blob.
 * Shape == GET /api/feed.
 *   "hf:*" = premium HyperFrames brand promos (motion/suinami-ads, code-driven, rendered).
 *   "ad:*" = ffmpeg AI promos (apps/api/scripts/build-ads.ts).
 *   rest   = creator clips (apps/api/scripts/seed-walrus.ts).
 * Rebuilt by seed-hf.ts (features hf:*) — preserves ad:* + clips.
 * The app reads GET /api/feed (real on-chain Videos); this manifest is the\n * graceful fallback used when the API is empty or unreachable.
 */
import type { FeedCard } from "@suinami/shared";

export const SAMPLE_FEED: FeedCard[] = ${JSON.stringify(merged, null, 2)};
`;
  writeFileSync(OUT, body);
  console.log(`\n✓ wrote ${merged.length} cards (${hfCards.length} HyperFrames + ${rest.length} existing) → ${OUT}`);
}

main().catch((e: unknown) => {
  console.error("✗ seed-hf failed:", e);
  process.exit(1);
});
