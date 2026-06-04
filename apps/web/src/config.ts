/**
 * Typed runtime config, read once from Vite's `import.meta.env`.
 *
 * The monorepo root `.env` holds the VITE_* values (see vite.config.ts envDir).
 * `src/vite-env.d.ts` declares the exact shape of `ImportMetaEnv`, so these
 * reads are fully typed — no `any`.
 */
import type { SuiNetwork } from "@suinami/shared";

const env = import.meta.env;

export interface AppConfig {
  network: SuiNetwork;
  /** Tatum gateway RPC URL (overrides the per-network default in @suinami/sui). */
  rpcUrl: string;
  /** Tatum API key, sent as the `x-api-key` header on every Sui RPC call. */
  tatumApiKey: string;
  /** Walrus aggregator base URL — media blobs are streamed from here. */
  walrusAggregatorUrl: string;
  /** Deployed Suinami Move package object ID. */
  packageId: string;
  /** Shared `Feed` object ID that videos are posted into. */
  feedObjectId: string;
  /** Base URL for the Hono API (empty string => same-origin "/api/..."). */
  apiBaseUrl: string;
}

export const config: AppConfig = {
  network: env.VITE_SUI_NETWORK,
  rpcUrl: env.VITE_SUI_RPC_URL,
  tatumApiKey: env.VITE_TATUM_API_KEY,
  walrusAggregatorUrl: env.VITE_WALRUS_AGGREGATOR_URL,
  packageId: env.VITE_SUINAMI_PACKAGE_ID,
  feedObjectId: env.VITE_SUINAMI_FEED_OBJECT_ID,
  apiBaseUrl: env.VITE_API_BASE_URL ?? "",
};

/**
 * True only when the on-chain package + feed object are wired. Screens that
 * need real chain state (Upload, Profile, write paths) gate on this; the
 * placeholder shell ignores it.
 */
export const packageConfigured: boolean =
  config.packageId.length > 0 && config.feedObjectId.length > 0;
