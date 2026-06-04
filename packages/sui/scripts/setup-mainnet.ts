/**
 * Mainnet deployer setup.
 *
 * Generates (once) a DEDICATED mainnet deployer keypair — separate from the
 * testnet one, since this signs real-value transactions — writes the secret to
 * the gitignored .env as `SUINAMI_MAINNET_DEPLOYER_KEY` (NEVER printed), and
 * prints only the public ADDRESS for you to fund with mainnet SUI.
 *
 * Re-run after funding to confirm the balance landed (read THROUGH TATUM mainnet).
 * There is no faucet on mainnet — fund the printed address from an exchange/wallet.
 *
 * Run from repo root:  pnpm setup:mainnet
 */
import { config as loadEnv } from "dotenv";
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(here, "../../../.env");
loadEnv({ path: ENV_PATH });

const apiKey = process.env.TATUM_API_KEY ?? "";

function ensureKey(): { address: string; created: boolean } {
  const existing = process.env.SUINAMI_MAINNET_DEPLOYER_KEY;
  if (existing && existing.startsWith("suiprivkey")) {
    const kp = Ed25519Keypair.fromSecretKey(existing);
    return { address: kp.getPublicKey().toSuiAddress(), created: false };
  }
  const kp = Ed25519Keypair.generate();
  const secret = kp.getSecretKey(); // bech32 suiprivkey…
  const address = kp.getPublicKey().toSuiAddress();
  appendFileSync(
    ENV_PATH,
    `\n# MAINNET deployer for the on-chain mainnet deploy. Secret — keep private.\nSUINAMI_MAINNET_DEPLOYER_KEY=${secret}\n`,
  );
  return { address, created: true };
}

async function main(): Promise<void> {
  if (!apiKey) {
    console.error("✗ TATUM_API_KEY missing in .env");
    process.exit(1);
  }

  const { address, created } = ensureKey();
  console.log("");
  console.log("  ════════════════════════════════════════════════════════════════════");
  console.log("   SUINAMI — MAINNET DEPLOYER");
  console.log("  ════════════════════════════════════════════════════════════════════");
  console.log(`   key      : ${created ? "GENERATED → saved to .env (SUINAMI_MAINNET_DEPLOYER_KEY)" : "reused from .env"}`);
  console.log("");
  console.log(`   FUND THIS ADDRESS with mainnet SUI:`);
  console.log("");
  console.log(`       ${address}`);
  console.log("");
  console.log("   Suggested: ~1 SUI (publish ≈ 0.03, seed gas ≈ 0.05, gifts as desired).");
  console.log("  ════════════════════════════════════════════════════════════════════");
  console.log("");

  // Confirm the Tatum key reaches mainnet + report the current balance.
  const client = getSuiClient({ network: "mainnet", apiKey });
  try {
    const bal = BigInt((await client.getBalance({ owner: address })).totalBalance);
    console.log(`   mainnet balance (via Tatum): ${Number(bal) / 1e9} SUI`);
    if (bal > 0n) {
      console.log("   ✓ funded — ready for the mainnet publish. Tell me to proceed.");
    } else {
      console.log("   ⏳ not funded yet — send SUI to the address above, then re-run `pnpm setup:mainnet`.");
    }
  } catch (e) {
    console.log(`   ⚠ couldn't read mainnet balance via Tatum: ${(e as Error).message}`);
    console.log("     If this is a 401/Method-not-allowed, the Tatum key may be testnet-only —");
    console.log("     a mainnet-enabled Tatum key is needed for the mainnet deploy.");
  }
}

main().catch((err: unknown) => {
  console.error("✗ setup-mainnet failed:", err);
  process.exit(1);
});
