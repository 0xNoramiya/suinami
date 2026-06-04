/**
 * Deployer setup — prep the testnet deployer keypair before publishing the Move package.
 *
 * 1. Ensure a testnet deployer keypair exists in .env (SUINAMI_DEPLOYER_KEY,
 *    bech32 `suiprivkey…`). Generated locally; the secret is written to the
 *    gitignored .env and never printed.
 * 2. Request testnet SUI from the Sui faucet for that address.
 * 3. Confirm the balance landed by reading it THROUGH TATUM.
 *
 * Idempotent: reuses an existing key, and tops up via the faucet again if the
 * balance is still zero. Run from the repo root:  pnpm setup:deployer
 */
import { config as loadEnv } from "dotenv";
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  FaucetRateLimitError,
  getFaucetHost,
  requestSuiFromFaucetV2,
} from "@mysten/sui/faucet";

import { getSuiClient } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(here, "../../../.env");
loadEnv({ path: ENV_PATH });

type Net = "mainnet" | "testnet" | "devnet";
const network = (process.env.SUI_NETWORK ?? "testnet") as Net;
const apiKey = process.env.TATUM_API_KEY ?? "";
const rpcUrl = process.env.SUI_RPC_URL;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ensureKey(): { address: string; created: boolean } {
  const existing = process.env.SUINAMI_DEPLOYER_KEY;
  if (existing && existing.startsWith("suiprivkey")) {
    const kp = Ed25519Keypair.fromSecretKey(existing);
    return { address: kp.getPublicKey().toSuiAddress(), created: false };
  }
  const kp = Ed25519Keypair.generate();
  const secret = kp.getSecretKey(); // bech32 suiprivkey…
  const address = kp.getPublicKey().toSuiAddress();
  appendFileSync(
    ENV_PATH,
    `\n# Generated testnet deployer for Move publish. Funded via faucet.\nSUINAMI_DEPLOYER_KEY=${secret}\n`,
  );
  return { address, created: true };
}

async function main(): Promise<void> {
  if (!apiKey) {
    console.error("✗ TATUM_API_KEY missing in .env");
    process.exit(1);
  }
  if (network !== "testnet" && network !== "devnet") {
    console.error(`✗ refusing to faucet-fund on '${network}' — only testnet/devnet.`);
    process.exit(1);
  }

  const { address, created } = ensureKey();
  console.log(`network          : ${network}`);
  console.log(`deployer address : ${address}`);
  console.log(
    `deployer key     : ${created ? "GENERATED → written to .env (SUINAMI_DEPLOYER_KEY)" : "reused existing from .env"}`,
  );

  const client = getSuiClient({ network, apiKey, ...(rpcUrl ? { rpcUrl } : {}) });

  // Balance reads go through Tatum; tolerate transient gateway timeouts so a
  // single blip doesn't abort the whole funding flow.
  const balanceOf = async (): Promise<bigint | null> => {
    try {
      return BigInt((await client.getBalance({ owner: address })).totalBalance);
    } catch (e) {
      console.log(`   (RPC balance read failed: ${(e as Error).message})`);
      return null;
    }
  };

  const before = await balanceOf();
  console.log(
    `balance (before) : ${before === null ? "unknown (transient RPC error)" : `${Number(before) / 1e9} SUI`}`,
  );
  if (before !== null && before > 0n) {
    console.log("\n✓ already funded — ready for publish.");
    return;
  }

  console.log("requesting testnet SUI from the Sui faucet …");
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost(network), recipient: address });
    console.log("   faucet request accepted");
  } catch (e) {
    if (e instanceof FaucetRateLimitError) {
      console.error("   ⚠ faucet rate-limited for this IP.");
    } else {
      console.error(`   ⚠ faucet request failed: ${(e as Error).message}`);
    }
    console.error("   You can fund manually at https://faucet.sui.io (address above), then re-run.");
  }

  let bal: bigint | null = null;
  for (let i = 1; i <= 15; i++) {
    await sleep(3000);
    bal = await balanceOf();
    if (bal !== null) console.log(`   balance check ${i}: ${Number(bal) / 1e9} SUI`);
    if (bal !== null && bal > 0n) break;
  }

  if (bal === null || bal === 0n) {
    console.error("\n✗ balance still 0 / unverified. Address is saved in .env;");
    console.error("  fund it at https://faucet.sui.io and re-run `pnpm setup:deployer`.");
    process.exit(1);
  }

  console.log(`\n✓ deployer funded: ${Number(bal) / 1e9} SUI at ${address}`);
  console.log("  Ready for publish once the Sui CLI is on PATH.");
}

main().catch((err: unknown) => {
  console.error("✗ setup-deployer failed:");
  console.error(err);
  process.exit(1);
});
