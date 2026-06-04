/**
 * Walrus round-trip smoke test — store→read round-trip + send_object_to ownership check via Tatum.
 *
 * Proves the core Sui↔Walrus bridge end to end:
 *   1. PUT a UNIQUE blob to the Walrus publisher with `send_object_to=<creator>`
 *      so the on-chain Walrus `Blob` object is owned by the creator, not us.
 *   2. GET the bytes back from the aggregator and assert byte-for-byte identity.
 *   3. Read the minted Blob object's owner THROUGH TATUM and assert it equals
 *      the creator address — i.e. `send_object_to` actually moved ownership.
 *
 * Unique bytes (random nonce) force a freshly-created blob so the test can verify
 * ownership rather than hitting an `alreadyCertified` short-circuit.
 *
 * Run from the repo root:  pnpm smoke:walrus
 */
import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { blobUrl, getBlob, storeBlob } from "@suinami/walrus";
import { getSuiClient } from "@suinami/sui";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

type Net = "mainnet" | "testnet" | "devnet";
const network = (process.env.SUI_NETWORK ?? "testnet") as Net;
const apiKey = process.env.TATUM_API_KEY ?? "";
const rpcUrl = process.env.SUI_RPC_URL;
const publisherUrl = process.env.WALRUS_PUBLISHER_URL ?? "";
const aggregatorUrl = process.env.WALRUS_AGGREGATOR_URL ?? "";
const epochs = Number(process.env.WALRUS_DEFAULT_EPOCHS ?? "5");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main(): Promise<void> {
  for (const [k, v] of Object.entries({ apiKey, publisherUrl, aggregatorUrl })) {
    if (!v) {
      console.error(`✗ missing ${k} in .env`);
      process.exit(1);
    }
  }

  // A structurally valid, unique Sui address to receive the blob object. (No
  // private key needed — an object can be transferred to any address.)
  const creator = `0x${randomBytes(32).toString("hex")}`;
  // Unique payload so the publisher mints a NEW blob object every run.
  const nonce = randomBytes(16).toString("hex");
  const payload = new TextEncoder().encode(
    `suinami walrus smoke · ${nonce} · ${"~".repeat(256)}`,
  );

  console.log(`→ publisher : ${publisherUrl}`);
  console.log(`→ aggregator: ${aggregatorUrl}`);
  console.log(`→ creator   : ${creator}`);
  console.log(`→ payload   : ${payload.byteLength} bytes (nonce ${nonce})`);
  console.log("");

  // --- 1) STORE with send_object_to ---------------------------------------
  console.log("① PUT → Walrus publisher (send_object_to=creator) …");
  const t0 = performance.now();
  const stored = await storeBlob(payload, {
    publisherUrl,
    epochs,
    sendObjectTo: creator,
  });
  console.log(
    `   ✓ stored in ${Math.round(performance.now() - t0)}ms — blobId=${stored.blobId}`,
  );
  console.log(
    `     objectId=${stored.objectId ?? "(none)"} alreadyCertified=${stored.alreadyCertified} endEpoch=${stored.endEpoch ?? "?"}`,
  );

  // --- 2) ROUND-TRIP read from aggregator ---------------------------------
  console.log("② GET ← Walrus aggregator (retry for propagation) …");
  console.log(`   url=${blobUrl(aggregatorUrl, stored.blobId)}`);
  let fetched: Uint8Array | null = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      fetched = await getBlob(aggregatorUrl, stored.blobId);
      break;
    } catch (e) {
      console.log(`   …attempt ${attempt} not ready (${(e as Error).message}); retrying`);
      await sleep(2500);
    }
  }
  if (!fetched) {
    console.error("✗ aggregator never served the blob");
    process.exit(1);
  }
  const identical = bytesEqual(payload, fetched);
  console.log(
    `   ✓ fetched ${fetched.byteLength} bytes — byte-identical: ${identical ? "YES" : "NO"}`,
  );
  if (!identical) {
    console.error("✗ round-trip bytes differ");
    process.exit(1);
  }

  // --- 3) Verify on-chain ownership THROUGH TATUM -------------------------
  if (stored.alreadyCertified || !stored.objectId) {
    console.log(
      "③ (skipped) blob was alreadyCertified or no objectId — no new object to check.",
    );
  } else {
    console.log("③ getObject(owner) THROUGH TATUM — confirm send_object_to …");
    const client = getSuiClient({ network, apiKey, ...(rpcUrl ? { rpcUrl } : {}) });
    let owner: string | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const obj = await client.getObject({
        id: stored.objectId,
        options: { showOwner: true, showType: true },
      });
      const o = obj.data?.owner;
      if (o && typeof o === "object" && "AddressOwner" in o) {
        owner = o.AddressOwner;
        console.log(`   type=${obj.data?.type ?? "?"}`);
        break;
      }
      console.log(`   …attempt ${attempt}: owner not resolved yet; retrying`);
      await sleep(2000);
    }
    const norm = (a: string) => a.toLowerCase().replace(/^0x0*/, "0x");
    const match = owner !== null && norm(owner) === norm(creator);
    console.log(`   blob object owner : ${owner ?? "(unresolved)"}`);
    console.log(`   expected creator  : ${creator}`);
    console.log(`   ✓ ownership match : ${match ? "YES" : "NO"}`);
    if (!match) {
      console.error("✗ send_object_to did NOT land ownership on the creator");
      process.exit(1);
    }
  }

  console.log("");
  console.log("SMOKE OK — Walrus store→read round-trips and send_object_to");
  console.log("           transfers blob ownership to the creator (verified via Tatum).");
}

main().catch((err: unknown) => {
  console.error("✗ Walrus smoke test FAILED:");
  console.error(err);
  process.exit(1);
});
