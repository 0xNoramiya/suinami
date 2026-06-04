/**
 * ============================================================================
 * THE SINGLE TATUM INTEGRATION POINT.
 * ============================================================================
 *
 * EVERY Sui JSON-RPC call in the whole Suinami app flows through the transport
 * built here. We never hit a public fullnode — all traffic goes to the Tatum
 * gateway (`TATUM_RPC_URLS[network]`), authenticated with the Tatum
 *
 *                       >>>  x-api-key: <cfg.apiKey>  <<<
 *
 * request header. That header is attached below via the transport's
 * `rpc.headers` option, so it rides along with every POST the client makes
 * (queryEvents, getOwnedObjects, getReferenceGasPrice, dryRun, execute, ...).
 * If you ever add another way to reach Sui, route it through here so the Tatum
 * key is never dropped.
 *
 * Note on @mysten/sui v2.17: the classic `SuiClient` / `SuiHTTPTransport` were
 * renamed to `SuiJsonRpcClient` / `JsonRpcHTTPTransport` and moved under the
 * `@mysten/sui/jsonRpc` entrypoint. We re-export the historical `SuiClient`
 * name as a type alias so the rest of the monorepo's contract still holds.
 * ============================================================================
 */
import {
  JsonRpcHTTPTransport,
  SuiJsonRpcClient,
  type JsonRpcTransport,
} from "@mysten/sui/jsonRpc";

import { resolveRpcUrl, type SuiClientConfig } from "./config";

/**
 * Public alias preserving the cross-package contract name `SuiClient`.
 * In @mysten/sui v2.17 the concrete JSON-RPC client is `SuiJsonRpcClient`.
 */
export type SuiClient = SuiJsonRpcClient;

/** The Tatum auth header name. Centralised so it is impossible to misspell. */
const TATUM_API_KEY_HEADER = "x-api-key";

// --------------------------------------------------------------------------
// Rate-limit guard. Tatum's gateway caps at ~3 requests/second and returns 429
// on bursts (the SDK makes ~2 calls per executed tx, and the indexer polls).
// We funnel EVERY Sui RPC through one throttled, 429-retrying fetch so callers
// (indexer, publish/seed scripts, future web SSR) never have to think about it.
// --------------------------------------------------------------------------
const MIN_RPC_INTERVAL_MS = 360; // ~2.7 req/s — comfortably under the 3/s cap
const MAX_RPC_RETRIES = 6;
const rpcSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let rpcQueue: Promise<unknown> = Promise.resolve();
let lastRpcAt = 0;

/** Serialize a request behind the shared queue, spaced by MIN_RPC_INTERVAL_MS. */
function spacedRpc<T>(fn: () => Promise<T>): Promise<T> {
  const run = rpcQueue.then(async () => {
    const wait = MIN_RPC_INTERVAL_MS - (Date.now() - lastRpcAt);
    if (wait > 0) await rpcSleep(wait);
    lastRpcAt = Date.now();
    return fn();
  });
  // Keep the queue chain alive regardless of individual success/failure.
  rpcQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Throttled fetch with a linear-ramp 429 backoff, shared by all Tatum transports. */
const tatumFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const res = await spacedRpc(() => fetch(input, init));
    if (res.status === 429 && attempt < MAX_RPC_RETRIES) {
      await rpcSleep(700 * (attempt + 1));
      continue;
    }
    return res;
  }
};

/**
 * Build the JSON-RPC transport that points at the Tatum gateway and injects the
 * `x-api-key` header on every request.
 *
 * This is the ONE place the Tatum credential is wired in. The `rpc.headers`
 * option is merged into the headers of every outbound JSON-RPC POST, so there
 * is no per-call plumbing to forget.
 */
export function getTatumTransport(cfg: SuiClientConfig): JsonRpcHTTPTransport {
  const url = resolveRpcUrl(cfg);

  return new JsonRpcHTTPTransport({
    url,
    // Throttled + 429-retrying fetch so we never trip Tatum's 3 req/s cap.
    fetch: tatumFetch,
    rpc: {
      // >>> TATUM AUTH: this header authenticates EVERY Sui RPC POST. <<<
      headers: {
        [TATUM_API_KEY_HEADER]: cfg.apiKey,
      },
    },
  });
}

/**
 * Memoised clients, keyed by the serialised config. Identical configs share one
 * client (and its internal caches / connection); a different network, key, or
 * url override yields a distinct client.
 */
const clientCache = new Map<string, SuiJsonRpcClient>();

/**
 * Get a Sui JSON-RPC client wired to Tatum for the given config. Memoised per
 * config so repeated calls in the API/indexer reuse one client.
 *
 * Construction is lazy and offline — no network call happens here, so this is
 * safe to call at module scope.
 */
export function getSuiClient(cfg: SuiClientConfig): SuiClient {
  const cacheKey = JSON.stringify(cfg);
  const existing = clientCache.get(cacheKey);
  if (existing) return existing;

  const transport: JsonRpcTransport = getTatumTransport(cfg);
  // `network` is required by SuiJsonRpcClientOptions; it is metadata only —
  // the actual endpoint is fixed by the Tatum transport above.
  const client = new SuiJsonRpcClient({ network: cfg.network, transport });
  clientCache.set(cacheKey, client);
  return client;
}

/**
 * Reference gas price for the network, as a decimal string (MIST per gas unit).
 * The underlying RPC returns a bigint; we stringify so it survives JSON.
 */
export async function getReferenceGasPrice(client: SuiClient): Promise<string> {
  const price = await client.getReferenceGasPrice();
  return price.toString();
}
