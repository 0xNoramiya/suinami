/**
 * Connection config for the Suinami Sui layer.
 *
 * Every Sui RPC in Suinami is reached through the Tatum gateway, authenticated
 * with an `x-api-key` header. This module only resolves *which URL* to talk to;
 * the header injection itself lives in `./client` (the single Tatum integration
 * point). See {@link resolveRpcUrl}.
 */
import { TATUM_RPC_URLS, type SuiNetwork } from "@suinami/shared";

/**
 * Everything `getTatumTransport` / `getSuiClient` need to reach a Sui RPC.
 *
 * - `network`  picks the default Tatum gateway from `TATUM_RPC_URLS`.
 * - `apiKey`   is sent as the Tatum `x-api-key` header on every request.
 * - `rpcUrl`   optional override (e.g. a local fullnode in tests). When set it
 *              takes precedence over the network default.
 */
export interface SuiClientConfig {
  network: SuiNetwork;
  apiKey: string;
  rpcUrl?: string;
}

/**
 * Resolve the JSON-RPC endpoint URL for a config.
 *
 * Precedence: explicit `cfg.rpcUrl` first, otherwise the Tatum gateway for the
 * requested network. This never touches the network — it is pure string logic.
 */
export function resolveRpcUrl(cfg: SuiClientConfig): string {
  return cfg.rpcUrl ?? TATUM_RPC_URLS[cfg.network];
}
