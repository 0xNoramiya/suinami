/**
 * Entry point: mount React, then dismiss the pre-React boot splash.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "@/providers";
import { App } from "@/App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element not found — check index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);

/**
 * Fade out the static #boot-splash (defined in index.html) now that React has
 * mounted, then remove it. The 400ms matches its CSS opacity transition.
 */
function dismissBootSplash(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.style.opacity = "0";
  window.setTimeout(() => splash.remove(), 400);
}

// Defer one frame so the first React paint lands before we reveal it.
requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));
