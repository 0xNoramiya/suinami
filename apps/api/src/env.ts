/**
 * Typed environment for the Suinami API.
 *
 * Loads the monorepo-root `.env` (single source of truth shared by every app)
 * and exposes a strongly-typed `env` object plus `packageConfigured`.
 *
 * BOOT-SAFETY: nothing here touches the network. The server must be able to
 * start with an EMPTY `SUINAMI_PACKAGE_ID` (the Move package is published at a
 * later build step), so every value has a sensible default and the indexer is
 * gated behind `packageConfigured`.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { SuiNetwork } from "@suinami/shared";
import { WALRUS_DEFAULT_EPOCHS } from "@suinami/shared";

// Load the monorepo-root .env. Absolute path so it resolves no matter the cwd.
config({ path: "/home/kuda/hackathon/suinami/.env" });

/** Directory of this module (ESM has no __dirname). */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** apps/api root — DATABASE_URL is resolved relative to this when it's a relative path. */
const API_DIR = path.resolve(HERE, "..");

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function optionalStr(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseNetwork(raw: string): SuiNetwork {
  return raw === "mainnet" || raw === "devnet" ? raw : "testnet";
}

const SUI_NETWORK = parseNetwork(str("SUI_NETWORK", "testnet"));

const rawDatabaseUrl = str("DATABASE_URL", "./suinami.db");
// Resolve a relative DATABASE_URL against the apps/api directory so the sqlite
// file lands in a predictable place regardless of the process cwd.
const DATABASE_URL = path.isAbsolute(rawDatabaseUrl)
  ? rawDatabaseUrl
  : path.resolve(API_DIR, rawDatabaseUrl);

export interface Env {
  TATUM_API_KEY: string;
  SUI_NETWORK: SuiNetwork;
  SUI_RPC_URL?: string;
  WALRUS_PUBLISHER_URL: string;
  WALRUS_AGGREGATOR_URL: string;
  WALRUS_DEFAULT_EPOCHS: number;
  SUINAMI_PACKAGE_ID: string;
  SUINAMI_FEED_OBJECT_ID: string;
  API_PORT: number;
  DATABASE_URL: string;
  /** Allowed CORS origin for the web client (Vite dev server by default). */
  WEB_ORIGIN: string;
}

export const env: Env = {
  TATUM_API_KEY: str("TATUM_API_KEY", ""),
  SUI_NETWORK,
  SUI_RPC_URL: optionalStr("SUI_RPC_URL"),
  WALRUS_PUBLISHER_URL: str(
    "WALRUS_PUBLISHER_URL",
    "https://publisher.walrus-testnet.walrus.space",
  ),
  WALRUS_AGGREGATOR_URL: str(
    "WALRUS_AGGREGATOR_URL",
    "https://aggregator.walrus-testnet.walrus.space",
  ),
  WALRUS_DEFAULT_EPOCHS: num("WALRUS_DEFAULT_EPOCHS", WALRUS_DEFAULT_EPOCHS),
  SUINAMI_PACKAGE_ID: str("SUINAMI_PACKAGE_ID", ""),
  SUINAMI_FEED_OBJECT_ID: str("SUINAMI_FEED_OBJECT_ID", ""),
  API_PORT: num("API_PORT", 8787),
  DATABASE_URL,
  WEB_ORIGIN: str("WEB_ORIGIN", "http://localhost:5173"),
};

/**
 * Whether the Sui Move package has been published & wired into .env yet.
 * Until this is true the indexer stays dormant and the API serves only its
 * local SQLite rollups — so the whole server boots with zero network calls.
 */
export const packageConfigured: boolean = !!env.SUINAMI_PACKAGE_ID;
