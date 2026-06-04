import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/** Resolve a path relative to this config file. */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  // The monorepo root holds the single `.env`; expose VITE_* from there.
  envDir: r("../../"),
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // We ship our own static manifest at public/manifest.webmanifest.
      manifest: false,
      includeAssets: ["favicon.svg", "icon.svg"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Walrus media is streamed live from the aggregator — never precache it,
        // and never let the SW intercept API calls.
        navigateFallbackDenylist: [/^\/api/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      // Keep the dev server clean: no service worker while developing.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    // Regex-anchored so subpath imports like "@suinami/ui/styles.css" still
    // resolve through package `exports` instead of being clobbered.
    alias: [
      { find: /^@suinami\/shared$/, replacement: r("../../packages/shared/src/index.ts") },
      { find: /^@suinami\/sui$/, replacement: r("../../packages/sui/src/index.ts") },
      { find: /^@suinami\/walrus$/, replacement: r("../../packages/walrus/src/index.ts") },
      { find: /^@suinami\/ui$/, replacement: r("../../packages/ui/src/index.ts") },
      { find: /^@\//, replacement: r("./src/") },
    ],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Forward API calls to the Hono server in dev so the client can use
      // same-origin "/api/..." paths.
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  preview: { port: 4173, host: true },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
