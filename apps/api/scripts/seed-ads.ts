/**
 * Upload the rendered ads (/tmp/suinami-ads/<id>/<id>.mp4) to Walrus and wire them
 * into the feed. Each ad gets an extracted poster frame; both blobs are stored on
 * Walrus (send_object_to the brand address). The feed manifest is rebuilt by
 * INTERLEAVING the ad cards with the existing creator clips, so the feed opens on
 * a polished ad while Tide Charts / Profile keep their creator variety.
 *
 * Idempotent: ad cards use videoId "ad:<id>"; existing ad cards are dropped + rebuilt.
 * Run from repo root:  pnpm seed:ads
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
const ADS_DIR = "/tmp/suinami-ads";
const OUT = resolve(REPO, "apps/web/src/feed/sampleFeed.ts");
const MIST = 1_000_000_000;

// Stable "suinami official" brand address (so re-runs don't churn the manifest).
const BRAND = "0x5117a3d10e1b4f0a9c2d6e8f3b7a1c5d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9";

interface AdMeta {
  id: string;
  handle: string;
  caption: string;
  likeCount: number;
  viewCount: number;
  tipSui: number;
}

const META: AdMeta[] = [
  { id: "a1", handle: "suinami", caption: "a wave of shorts 🌊 videos on Walrus, social on Sui", likeCount: 980, viewCount: 14200, tipSui: 2.0 },
  { id: "a2", handle: "suinami", caption: "your videos live on Walrus — you own the blob 🔑", likeCount: 742, viewCount: 9800, tipSui: 1.4 },
  { id: "a3", handle: "suinami", caption: "送る波 · ripple to tsunami, real SUI 🎁", likeCount: 1310, viewCount: 18700, tipSui: 3.6 },
  { id: "a4", handle: "suinami", caption: "climb the Tide Charts 📈 the biggest waves rise", likeCount: 660, viewCount: 8300, tipSui: 1.1 },
  { id: "a5", handle: "suinami", caption: "水の波に乗れ · ride the wave 🌙", likeCount: 1185, viewCount: 16050, tipSui: 2.8 },
  { id: "a6", handle: "suinami", caption: "dive in — your wallet is your key 🌊", likeCount: 845, viewCount: 11200, tipSui: 1.7 },
];

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

async function main(): Promise<void> {
  if (!publisherUrl || !aggregatorUrl) {
    console.error("✗ WALRUS_* missing in .env");
    process.exit(1);
  }
  const base = Date.now();
  const adCards: Card[] = [];

  for (const m of META) {
    const mp4 = `${ADS_DIR}/${m.id}/${m.id}.mp4`;
    if (!existsSync(mp4)) {
      console.error(`✗ ${mp4} not found — run \`pnpm ads ${m.id}\` first.`);
      process.exit(1);
    }
    const poster = `${ADS_DIR}/${m.id}/poster.jpg`;
    await exec("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "2.0", "-i", mp4, "-frames:v", "1", "-q:v", "3", poster]);
    const durMs = Math.round((await probeDuration(mp4)) * 1000);
    const videoBytes = readFileSync(mp4);
    const posterBytes = readFileSync(poster);
    console.log(`↑ ${m.id} — ${Math.round(videoBytes.length / 1024)}KB video + ${Math.round(posterBytes.length / 1024)}KB poster …`);
    const v = await withRetry(`${m.id} video`, () => storeBlob(videoBytes, { publisherUrl, epochs, sendObjectTo: BRAND }));
    const p = await withRetry(`${m.id} poster`, () => storeBlob(posterBytes, { publisherUrl, epochs, sendObjectTo: BRAND }));
    console.log(`  ✓ ${m.id}: video=${v.blobId.slice(0, 10)}…`);
    adCards.push({
      videoId: `ad:${m.id}`,
      creator: BRAND,
      handle: m.handle,
      avatarUrl: null,
      videoUrl: blobUrl(aggregatorUrl, v.blobId),
      posterUrl: blobUrl(aggregatorUrl, p.blobId),
      caption: m.caption,
      likeCount: m.likeCount,
      viewCount: m.viewCount,
      tipTotal: String(Math.round(m.tipSui * MIST)),
      durationMs: durMs,
      width: 720,
      height: 1280,
      createdAt: base - META.indexOf(m) * 1800_000,
    });
  }

  // Keep existing creator clips (drop any prior ad cards), then interleave.
  const clips = (SAMPLE_FEED as Card[]).filter((c) => !c.videoId.startsWith("ad:"));
  const merged: Card[] = [];
  const max = Math.max(adCards.length, clips.length);
  for (let i = 0; i < max; i++) {
    if (adCards[i]) merged.push(adCards[i]!);
    if (clips[i]) merged.push(clips[i]!);
  }

  const body = `/**
 * AUTO-GENERATED by apps/api/scripts/seed-ads.ts (ads) + seed-walrus.ts (clips).
 * Every videoUrl/posterUrl is a live Walrus testnet blob. Shape == GET /api/feed.
 * "ad:*" entries are AI-generated Suinami promos; the rest are creator clips.
 * The app reads GET /api/feed (real on-chain Videos); this manifest is the\n * graceful fallback used when the API is empty or unreachable.
 */
import type { FeedCard } from "@suinami/shared";

export const SAMPLE_FEED: FeedCard[] = ${JSON.stringify(merged, null, 2)};
`;
  writeFileSync(OUT, body);
  console.log(`\n✓ wrote ${merged.length} cards (${adCards.length} ads + ${clips.length} clips) → ${OUT}`);
}

main().catch((e: unknown) => {
  console.error("✗ seed-ads failed:", e);
  process.exit(1);
});
