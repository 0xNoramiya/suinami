/**
 * Tatum smoke test — verifies the Tatum gateway is reachable via getSuiClient.
 *
 * Proves a real Sui JSON-RPC read works THROUGH THE TATUM GATEWAY using our own
 * getSuiClient — i.e. the `x-api-key` header wired in getTatumTransport actually
 * rides along on a live request. The reference gas price is the gating check;
 * the chain id / latest checkpoint are bonus reads to show richer RPC works too.
 *
 * Run from the repo root:  pnpm smoke
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { getReferenceGasPrice, getSuiClient } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

type Net = "mainnet" | "testnet" | "devnet";
const network = (process.env.SUI_NETWORK ?? "testnet") as Net;
const apiKey = process.env.TATUM_API_KEY ?? "";
const rpcUrl = process.env.SUI_RPC_URL;

async function main(): Promise<void> {
  if (!apiKey) {
    console.error("✗ TATUM_API_KEY is empty in .env — fill it before running this smoke test.");
    process.exit(1);
  }

  console.log(`→ network   : ${network}`);
  console.log(`→ endpoint  : ${rpcUrl ?? `(default Tatum URL for ${network})`}`);
  console.log(`→ x-api-key : ${apiKey.slice(0, 12)}… (${apiKey.length} chars)`);

  const client = getSuiClient({ network, apiKey, ...(rpcUrl ? { rpcUrl } : {}) });

  const t0 = performance.now();
  // GATING CALL — this is the suix_getReferenceGasPrice JSON-RPC through Tatum.
  const gas = await getReferenceGasPrice(client);
  const ms = Math.round(performance.now() - t0);

  let chainId = "(skipped)";
  let checkpoint = "(skipped)";
  try {
    chainId = await client.getChainIdentifier();
  } catch (e) {
    chainId = `(error: ${(e as Error).message})`;
  }
  try {
    checkpoint = await client.getLatestCheckpointSequenceNumber();
  } catch (e) {
    checkpoint = `(error: ${(e as Error).message})`;
  }

  console.log("");
  console.log("✓ Tatum gateway reachable via @suinami/sui getSuiClient");
  console.log(`  suix_getReferenceGasPrice : ${gas} MIST/gas   (${ms}ms)`);
  console.log(`  sui_getChainIdentifier    : ${chainId}`);
  console.log(`  latestCheckpoint          : ${checkpoint}`);
  console.log("");
  console.log("SMOKE OK — Sui reads route through Tatum with the x-api-key header.");
}

main().catch((err: unknown) => {
  console.error("✗ Tatum smoke test FAILED:");
  console.error(err);
  process.exit(1);
});
