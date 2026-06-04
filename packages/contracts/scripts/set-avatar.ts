/**
 * Suinami — set a creator's on-chain avatar (idempotent).
 *
 * Calls `update_profile(profile, display_name, avatar_blob, bio)` on the deployer's
 * Profile to store a Walrus blob id as the avatar — the WALRUS↔SUI BRIDGE for
 * identity. display_name + bio are READ from the current object and preserved, so
 * this only changes the avatar. The indexer then projects avatar_blob into
 * creator_stats (see indexer.ts), and /api/feed|leaderboard|profile serve the
 * aggregator URL.
 *
 *   >>> TATUM <<< every RPC routes through getSuiClient (x-api-key). Gas is set
 *   EXPLICITLY (Tatum doesn't proxy suix_getLatestSuiSystemState).
 *
 * Run: `pnpm --filter @suinami/contracts run set-avatar -- <walrusBlobId>`
 *   (or set SUINAMI_AVATAR_BLOB in the environment).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

import type { SuiNetwork } from "@suinami/shared";
import { buildUpdateProfileTx, getSuiClient } from "@suinami/sui";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
loadEnv({ path: resolve(REPO_ROOT, ".env") });

type GasRef = { objectId: string; version: string; digest: string };

function fail(msg: string): never {
  console.error(`\n[suinami:set-avatar] ${msg}\n`);
  process.exit(1);
}
function f(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  // Accept the blob id from `-- <blob>` or SUINAMI_AVATAR_BLOB. pnpm forwards the
  // literal `--` separator as an arg, so skip it (+ any other flag-like tokens).
  const argBlob = process.argv.slice(2).find((a) => a !== "--" && !a.startsWith("-"));
  const avatarBlob = (argBlob ?? process.env.SUINAMI_AVATAR_BLOB ?? "").trim();
  if (!avatarBlob) fail("Missing Walrus blob id. Pass it: run set-avatar -- <blobId>");

  const apiKey = process.env.TATUM_API_KEY?.trim();
  const network = (process.env.SUI_NETWORK?.trim() ?? "testnet") as SuiNetwork;
  const packageId = process.env.SUINAMI_PACKAGE_ID?.trim();
  const deployerKey = (
    network === "mainnet"
      ? process.env.SUINAMI_MAINNET_DEPLOYER_KEY
      : process.env.SUINAMI_DEPLOYER_KEY
  )?.trim();
  if (!apiKey || !packageId || !deployerKey) {
    fail("Missing env (TATUM_API_KEY / SUINAMI_PACKAGE_ID / deployer key).");
  }

  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(deployerKey!).secretKey);
  const sender = keypair.getPublicKey().toSuiAddress();
  const client = getSuiClient({ network, apiKey: apiKey! });
  console.log(`[suinami:set-avatar] network=${network} sender=${sender} blob=${avatarBlob}`);

  // Resolve the deployer's Profile object id from ProfileCreated.
  const ev = `${packageId}::feed::ProfileCreated`;
  const created = await client.queryEvents({
    query: { MoveEventType: ev },
    limit: 50,
    order: "descending",
  });
  let profileId: string | undefined;
  for (const e of created.data) {
    const j = f(e.parsedJson);
    if (String(j.owner) === sender && j.profile_id) {
      profileId = String(j.profile_id);
      break;
    }
  }
  if (!profileId) fail(`No Profile found on-chain for ${sender} (run the seed first).`);
  console.log(`[suinami:set-avatar] profile=${profileId}`);

  // Read current display_name + bio so update_profile only changes the avatar.
  const obj = await client.getObject({ id: profileId, options: { showContent: true } });
  const content = obj.data?.content;
  const fields =
    content && content.dataType === "moveObject"
      ? (content.fields as Record<string, unknown>)
      : {};
  const displayName = String(fields.display_name ?? fields.handle ?? "");
  const bio = String(fields.bio ?? "");
  const currentAvatar = String(fields.avatar_blob ?? "");
  if (currentAvatar === avatarBlob) {
    console.log(`[suinami:set-avatar] avatar already set to this blob — nothing to do.`);
    return;
  }
  console.log(`[suinami:set-avatar] display_name="${displayName}" bio="${bio}" (was avatar="${currentAvatar || "<empty>"}")`);

  // Explicit, Tatum-safe gas.
  const gasPrice = await client.getReferenceGasPrice();
  const coins = await client.getCoins({ owner: sender });
  if (coins.data.length === 0) fail(`Deployer ${sender} has no SUI coins for gas.`);
  const biggest = coins.data.reduce((m, c) => (BigInt(c.balance) > BigInt(m.balance) ? c : m));
  const gasRef: GasRef = {
    objectId: biggest.coinObjectId,
    version: biggest.version,
    digest: biggest.digest,
  };

  const tx = buildUpdateProfileTx({ packageId: packageId!, profileId, displayName, avatarBlob, bio });
  tx.setSender(sender);
  tx.setGasOwner(sender);
  tx.setGasPrice(gasPrice);
  tx.setGasBudget(100_000_000n);
  tx.setGasPayment([gasRef]);

  const res = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    fail(`update_profile failed: ${res.effects?.status?.error ?? "unknown"} (digest ${res.digest})`);
  }
  console.log(`  ✓ avatar set on-chain — digest ${res.digest}`);
  console.log(`[suinami:set-avatar] done. The indexer will project it into creator_stats within a tick.`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
