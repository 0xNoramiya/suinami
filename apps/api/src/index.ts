/**
 * Suinami API — a thin, boot-safe Hono server.
 *
 * Startup contract: the process MUST come up with an empty SUINAMI_PACKAGE_ID
 * and make ZERO network calls. The only side effects on boot are:
 *   1. opening the local SQLite file (via ./db) and ensuring tables exist,
 *   2. starting the HTTP listener,
 *   3. starting the indexer — which, when unconfigured, simply logs and returns.
 *
 * Every Sui RPC the indexer eventually makes is routed through the Tatum
 * gateway (the @suinami/sui client attaches `x-api-key: TATUM_API_KEY`).
 */
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { SUINAMI_VERSION, type HealthStatus } from "@suinami/shared";
import { env, packageConfigured } from "./env";
import { feed } from "./routes/feed";
import { upload } from "./routes/upload";
import { leaderboard } from "./routes/leaderboard";
import { profile } from "./routes/profile";
import { gifts } from "./routes/gifts";
import { commentsRoute } from "./routes/comments";
import { getIndexerState, startIndexer } from "./indexer";

/** Process start time for the /health uptime field. */
const BOOT_MS = Date.now();

const app = new Hono();

// CORS for the Vite web client. Permissive on methods/headers since this is a
// hackathon API; origin is locked to the configured web origin.
app.use(
  "*",
  cors({
    origin: env.WEB_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

/** Liveness + config probe. Pure in-memory read — never hits the network. */
app.get("/health", (c) => {
  const status: HealthStatus = {
    ok: true,
    service: "suinami-api",
    network: env.SUI_NETWORK,
    packageConfigured,
    indexer: getIndexerState(),
    uptimeMs: Date.now() - BOOT_MS,
  };
  return c.json(status);
});

// Feature routes.
app.route("/api/feed", feed);
app.route("/api/upload", upload);
app.route("/api/leaderboard", leaderboard);
app.route("/api/profile", profile);
app.route("/api/gifts", gifts);
app.route("/api/comments", commentsRoute);

// Single-app deploy: when a built web SPA is present (copied to ./public in the
// container image), the API hosts it alongside /api so judges get ONE URL.
// Registered AFTER the /api routes so those win; the catch-all serves index.html
// for any other path (SPA fallback). Inert in dev — there is no ./public, where
// Vite serves the web on :5173 instead.
const servesWeb = existsSync("public/index.html");
if (servesWeb) {
  app.use("/*", serveStatic({ root: "./public" }));
  app.get("*", serveStatic({ path: "./public/index.html" }));
}

// --- Start the listener, then the (possibly dormant) indexer ----------------
// hostname 0.0.0.0 so the container is reachable from the platform router (fly).
serve({ fetch: app.fetch, port: env.API_PORT, hostname: "0.0.0.0" });

// Proves cross-package resolution works at boot (shared imported & evaluated).
console.log(
  [
    "",
    "  ~~~ Suinami API ~~~",
    `  version        : ${SUINAMI_VERSION}`,
    `  listening on   : http://localhost:${env.API_PORT}`,
    `  network        : ${env.SUI_NETWORK}`,
    `  package        : ${packageConfigured ? env.SUINAMI_PACKAGE_ID : "(unconfigured — indexer dormant)"}`,
    `  walrus aggr.   : ${env.WALRUS_AGGREGATOR_URL}`,
    `  web spa        : ${servesWeb ? "served from ./public (single-app)" : "(dev — served by Vite)"}`,
    "",
  ].join("\n"),
);

// Boot-safe: returns immediately (no network) when packageConfigured is false.
startIndexer();
