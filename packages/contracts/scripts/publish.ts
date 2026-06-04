/**
 * Suinami — publish the `suinami::feed` Move package to Sui.
 *
 * Flow:
 *   1. Load env (.env at repo root): TATUM_API_KEY, SUI_NETWORK, SUINAMI_DEPLOYER_KEY.
 *   2. `sui move build --dump-bytecode-as-base64` -> { modules, dependencies }.
 *   3. Build a publish Transaction, transfer the returned UpgradeCap to the sender.
 *   4. Execute it.
 *
 *   >>> TATUM <<<
 *   The transaction is executed via getSuiClient({ network, apiKey }) from
 *   @suinami/sui. That client's transport attaches the `x-api-key` header to
 *   EVERY Sui JSON-RPC request, so this publish (and the gas/object reads it
 *   does) all route through the Tatum gateway — there is no public fullnode.
 *
 * Run: `pnpm --filter @suinami/contracts publish`
 * Requires the Sui CLI on PATH (only used locally to compile the bytecode).
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import type {
  SuiObjectChange,
  SuiObjectChangePublished,
} from "@mysten/sui/jsonRpc";

import { MOVE_MODULE } from "@suinami/shared";
import type { SuiNetwork } from "@suinami/shared";
import { getSuiClient } from "@suinami/sui";

// --- Paths -----------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CONTRACTS_DIR = resolve(__dirname, "..");
const ENV_PATH = resolve(REPO_ROOT, ".env");

loadEnv({ path: ENV_PATH });

/** Print guidance + exit(1). */
function fail(message: string): never {
  console.error(`\n[suinami:publish] ${message}\n`);
  process.exit(1);
}

const VALID_NETWORKS: readonly SuiNetwork[] = ["mainnet", "testnet", "devnet"];

function parseNetwork(raw: string | undefined): SuiNetwork {
  const value = (raw ?? "testnet").trim();
  if (!(VALID_NETWORKS as readonly string[]).includes(value)) {
    fail(
      `SUI_NETWORK="${value}" is invalid. Use one of: ${VALID_NETWORKS.join(", ")}.`,
    );
  }
  return value as SuiNetwork;
}

/** Bytecode produced by `sui move build --dump-bytecode-as-base64`. */
interface CompiledModules {
  modules: string[];
  dependencies: string[];
  digest?: number[];
}

function buildPackage(): CompiledModules {
  let stdout: string;
  try {
    // Compile locally; the Sui CLI is NOT involved in the on-chain submit.
    stdout = execSync(
      "sui move build --dump-bytecode-as-base64 --path .",
      { cwd: CONTRACTS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  } catch {
    fail(
      "`sui move build` failed. Is the Sui CLI installed and on PATH?\n" +
        "Install: https://docs.sui.io/guides/developer/getting-started/sui-install",
    );
  }

  // The CLI prints the JSON object on the last non-empty line.
  const jsonLine = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .at(-1);

  if (!jsonLine) {
    fail(`Could not find bytecode JSON in build output:\n${stdout}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    fail(`Failed to parse build JSON output:\n${jsonLine}`);
  }

  const obj = parsed as Partial<CompiledModules>;
  if (!Array.isArray(obj.modules) || !Array.isArray(obj.dependencies)) {
    fail(`Build JSON missing modules/dependencies:\n${jsonLine}`);
  }
  return { modules: obj.modules, dependencies: obj.dependencies };
}

async function main(): Promise<void> {
  const apiKey = process.env.TATUM_API_KEY?.trim();
  if (!apiKey) {
    fail("TATUM_API_KEY is not set in .env — required to reach the Tatum Sui gateway.");
  }

  const network = parseNetwork(process.env.SUI_NETWORK);

  // Use the dedicated mainnet deployer on mainnet, the testnet one otherwise.
  const deployerKey = (
    network === "mainnet"
      ? process.env.SUINAMI_MAINNET_DEPLOYER_KEY
      : process.env.SUINAMI_DEPLOYER_KEY
  )?.trim();
  if (!deployerKey) {
    fail(
      "SUINAMI_DEPLOYER_KEY is not set in .env.\n" +
        "Provide a funded deployer key in `suiprivkey...` format. Get one with:\n" +
        "  sui keytool export --key-identity <alias>\n" +
        `Fund it on ${network} via the faucet, then re-run.`,
    );
  }

  // Decode the suiprivkey... bech32 secret into an Ed25519 keypair.
  let keypair: Ed25519Keypair;
  try {
    const { secretKey } = decodeSuiPrivateKey(deployerKey);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    fail(
      "SUINAMI_DEPLOYER_KEY is not a valid `suiprivkey...` secret. " +
        "Export with `sui keytool export --key-identity <alias>`.",
    );
  }

  const sender = keypair.getPublicKey().toSuiAddress();
  console.log(`[suinami:publish] network=${network} sender=${sender}`);
  console.log(`[suinami:publish] all RPC routed through Tatum (x-api-key header).`);

  // Compile the Move package to base64 bytecode.
  console.log("[suinami:publish] building Move bytecode...");
  const { modules, dependencies } = buildPackage();
  console.log(
    `[suinami:publish] compiled ${modules.length} module(s), ${dependencies.length} dependency package(s).`,
  );

  // >>> TATUM <<< — this client carries the x-api-key header on every call.
  const client = getSuiClient({ network, apiKey });

  // Tatum's Sui gateway does NOT proxy `suix_getLatestSuiSystemState`, which the
  // SDK would otherwise call while AUTO-resolving gas during build(). So we
  // resolve gas EXPLICITLY using only Tatum-supported methods — reference gas
  // price + an owned coin for payment + a fixed budget — and set them on the tx,
  // leaving build() with nothing to look up.
  console.log("[suinami:publish] resolving gas (Tatum-safe: getReferenceGasPrice + getCoins)...");
  const gasPrice = await client.getReferenceGasPrice();
  const coins = await client.getCoins({ owner: sender });
  const gasCoin = coins.data[0];
  if (!gasCoin) {
    fail(`Deployer ${sender} has no SUI coins to pay for gas. Fund it on ${network}.`);
  }

  // Build the publish transaction.
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasOwner(sender);
  tx.setGasPrice(gasPrice);
  tx.setGasBudget(500_000_000n); // 0.5 SUI ceiling; only actual cost is charged.
  tx.setGasPayment([
    { objectId: gasCoin.coinObjectId, version: gasCoin.version, digest: gasCoin.digest },
  ]);
  // tx.publish returns the UpgradeCap result; it must be consumed/transferred.
  const upgradeCap = tx.publish({ modules, dependencies });
  tx.transferObjects([upgradeCap], tx.pure.address(sender));

  console.log("[suinami:publish] signing + executing publish transaction...");
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showObjectChanges: true, showEffects: true },
  });

  const status = result.effects?.status?.status;
  if (status !== "success") {
    fail(
      `Publish transaction failed (status=${status ?? "unknown"}): ` +
        `${result.effects?.status?.error ?? "no error detail"}\n` +
        `Digest: ${result.digest}`,
    );
  }

  const changes: SuiObjectChange[] = result.objectChanges ?? [];

  // packageId comes from the "published" object change.
  const published = changes.find(
    (c): c is SuiObjectChangePublished => c.type === "published",
  );
  if (!published) {
    fail(
      `No "published" object change found. Digest: ${result.digest}\n` +
        `Changes: ${JSON.stringify(changes, null, 2)}`,
    );
  }
  const packageId = published.packageId;

  // The shared Feed registry is a created object whose type ends in ::feed::Feed.
  const feedType = `${packageId}::${MOVE_MODULE}::Feed`;
  const feedChange = changes.find(
    (c) =>
      c.type === "created" &&
      "objectType" in c &&
      typeof c.objectType === "string" &&
      c.objectType === feedType,
  );
  const feedObjectId =
    feedChange && "objectId" in feedChange ? feedChange.objectId : undefined;

  if (!feedObjectId) {
    console.warn(
      `[suinami:publish] WARNING: could not locate the shared Feed object ` +
        `(${feedType}). Inspect object changes manually.`,
    );
  }

  // --- Copy-paste output ---------------------------------------------
  console.log("\n[suinami:publish] SUCCESS");
  console.log(`  digest:     ${result.digest}`);
  console.log(`  packageId:  ${packageId}`);
  console.log(`  feedObject: ${feedObjectId ?? "<unresolved>"}`);
  console.log("\n# ---- paste into .env -------------------------------------------");
  console.log(`SUINAMI_PACKAGE_ID=${packageId}`);
  console.log(`SUINAMI_FEED_OBJECT_ID=${feedObjectId ?? ""}`);
  console.log(`VITE_SUINAMI_PACKAGE_ID=${packageId}`);
  console.log(`VITE_SUINAMI_FEED_OBJECT_ID=${feedObjectId ?? ""}`);
  console.log("# ----------------------------------------------------------------\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Unexpected error: ${message}`);
});
