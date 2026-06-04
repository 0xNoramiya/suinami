/**
 * Suinami — REAL on-chain seed (idempotent).
 *
 * Brings the on-chain `suinami::feed` graph up to match the live Walrus feed:
 *   - reuses (or creates) the deployer's Profile,
 *   - posts every SAMPLE_FEED video NOT already on-chain, batched into ONE PTB
 *     (dedupe is by Walrus blob_id, read from existing VideoPosted events), and
 *   - ensures at least one like + one gift exist (so leaderboards aren't empty).
 * Each Video carries its REAL Walrus blob_id on-chain — the WALRUS↔SUI BRIDGE.
 *
 *   >>> TATUM <<< every RPC routes through getSuiClient (x-api-key). Gas is set
 *   EXPLICITLY (Tatum doesn't proxy suix_getLatestSuiSystemState); the @suinami/sui
 *   transport throttles to <3 req/s + retries 429s, so this stays under quota.
 *
 * Run: `pnpm --filter @suinami/contracts run seed`
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

import type { SuiNetwork } from "@suinami/shared";
import { buildCreateProfileTx, buildLikeTx, buildGiftTx, getSuiClient } from "@suinami/sui";
import { SAMPLE_FEED } from "../../../apps/web/src/feed/sampleFeed";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
loadEnv({ path: resolve(REPO_ROOT, ".env") });

const CLOCK = "0x6";
type GasRef = { objectId: string; version: string; digest: string };

function fail(msg: string): never {
  console.error(`\n[suinami:seed] ${msg}\n`);
  process.exit(1);
}
function blobIdFromUrl(url: string | null): string {
  if (!url) return "";
  const i = url.indexOf("/v1/blobs/");
  return i >= 0 ? url.slice(i + "/v1/blobs/".length) : "";
}
function f(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
function createdId(changes: ReadonlyArray<unknown>, suffix: string): string | undefined {
  for (const c of changes) {
    const o = c as { type?: string; objectType?: string; objectId?: string };
    if (o?.type === "created" && typeof o.objectType === "string" && o.objectType.endsWith(suffix)) {
      return o.objectId;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const apiKey = process.env.TATUM_API_KEY?.trim();
  const network = (process.env.SUI_NETWORK?.trim() ?? "testnet") as SuiNetwork;
  const packageId = process.env.SUINAMI_PACKAGE_ID?.trim();
  const feedId = process.env.SUINAMI_FEED_OBJECT_ID?.trim();
  const deployerKey = (
    network === "mainnet"
      ? process.env.SUINAMI_MAINNET_DEPLOYER_KEY
      : process.env.SUINAMI_DEPLOYER_KEY
  )?.trim();
  if (!apiKey || !packageId || !feedId || !deployerKey) {
    fail("Missing env (TATUM_API_KEY / SUINAMI_PACKAGE_ID / SUINAMI_FEED_OBJECT_ID / SUINAMI_DEPLOYER_KEY).");
  }

  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(deployerKey!).secretKey);
  const sender = keypair.getPublicKey().toSuiAddress();
  const client = getSuiClient({ network, apiKey: apiKey! });
  console.log(`[suinami:seed] network=${network} sender=${sender}`);

  const gasPrice = await client.getReferenceGasPrice();
  const coins = await client.getCoins({ owner: sender });
  if (coins.data.length === 0) fail(`Deployer ${sender} has no SUI coins.`);
  const biggest = coins.data.reduce((m, c) => (BigInt(c.balance) > BigInt(m.balance) ? c : m));
  let gasRef: GasRef = { objectId: biggest.coinObjectId, version: biggest.version, digest: biggest.digest };

  async function exec(label: string, tx: Transaction, budget: bigint) {
    tx.setSender(sender);
    tx.setGasOwner(sender);
    tx.setGasPrice(gasPrice);
    tx.setGasBudget(budget);
    tx.setGasPayment([gasRef]);
    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showObjectChanges: true, showEffects: true },
    });
    if (res.effects?.status?.status !== "success") {
      fail(`${label} failed: ${res.effects?.status?.error ?? "unknown"} (digest ${res.digest})`);
    }
    const g = res.effects!.gasObject.reference;
    gasRef = { objectId: g.objectId, version: g.version, digest: g.digest };
    console.log(`  ✓ ${label} — ${res.digest}`);
    return res;
  }

  // --- Read current on-chain state (dedupe + reuse) ------------------------
  const ev = (name: string) => `${packageId}::feed::${name}`;
  const [postedEv, profileEv, giftEv] = [
    await client.queryEvents({ query: { MoveEventType: ev("VideoPosted") }, limit: 50, order: "descending" }),
    await client.queryEvents({ query: { MoveEventType: ev("ProfileCreated") }, limit: 50, order: "descending" }),
    await client.queryEvents({ query: { MoveEventType: ev("GiftSent") }, limit: 1, order: "descending" }),
  ];
  const onChainByBlob = new Map<string, string>();
  for (const e of postedEv.data) {
    const j = f(e.parsedJson);
    if (j.blob_id) onChainByBlob.set(String(j.blob_id), String(j.video_id));
  }
  console.log(`[suinami:seed] ${onChainByBlob.size} video(s) already on-chain.`);

  // --- Profile: reuse the deployer's, else create -------------------------
  let profileId = profileEv.data
    .map((e) => f(e.parsedJson))
    .find((j) => String(j.owner) === sender)?.profile_id as string | undefined;
  if (!profileId) {
    const heroPoster = blobIdFromUrl(SAMPLE_FEED[0]?.posterUrl ?? null);
    const res = await exec(
      "create_profile",
      buildCreateProfileTx({
        packageId: packageId!,
        handle: "suinami",
        displayName: "Suinami",
        avatarBlob: heroPoster,
        bio: "Official Suinami harbour — videos on Walrus, social on Sui.",
      }),
      200_000_000n,
    );
    profileId = createdId(res.objectChanges ?? [], "::feed::Profile");
  }
  if (!profileId) fail("No Profile available.");
  console.log(`[suinami:seed] profileId=${profileId}`);

  // --- Batch-post every video NOT already on-chain (ONE PTB) --------------
  const missing = SAMPLE_FEED.filter((c) => {
    const b = blobIdFromUrl(c.videoUrl);
    return b && !onChainByBlob.has(b);
  });
  if (missing.length > 0) {
    console.log(`[suinami:seed] posting ${missing.length} new video(s) in one tx…`);
    const tx = new Transaction();
    for (const card of missing) {
      tx.moveCall({
        target: `${packageId}::feed::post_video`,
        arguments: [
          tx.object(feedId!),
          tx.pure.string(blobIdFromUrl(card.videoUrl)), // >>> Walrus blob id on-chain <<<
          tx.pure.string(blobIdFromUrl(card.posterUrl)),
          tx.pure.string(card.caption),
          tx.pure.u64(BigInt(card.durationMs)),
          tx.pure.u16(card.width),
          tx.pure.u16(card.height),
          tx.object(CLOCK),
        ],
      });
    }
    const res = await exec(`post_video x${missing.length}`, tx, 900_000_000n);
    for (const c of res.objectChanges ?? []) {
      const o = c as { type?: string; objectType?: string; objectId?: string };
      if (o?.type === "created" && o.objectType?.endsWith("::feed::Video") && o.objectId) {
        onChainByBlob.set("__new__" + o.objectId, o.objectId);
      }
    }
  } else {
    console.log("[suinami:seed] no new videos to post.");
  }

  // --- Ensure at least one like + gift exist ------------------------------
  if (giftEv.data.length === 0) {
    const target = [...onChainByBlob.values()][0];
    if (target) {
      await exec("like_video", buildLikeTx({ packageId: packageId!, videoId: target }), 200_000_000n);
      await exec(
        "send_gift (Ripple 0.01 SUI)",
        buildGiftTx({ packageId: packageId!, videoId: target, profileId, amountMist: 10_000_000n, tier: 0 }),
        200_000_000n,
      );
    }
  } else {
    console.log("[suinami:seed] gift already present — skipping like/gift.");
  }

  console.log("\n[suinami:seed] DONE — on-chain feed is in sync with the Walrus feed.");
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
