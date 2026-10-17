import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import "./lib/i18n";

import { isTauri } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { Providers } from "./app/providers";

async function start() {
  // Outside Tauri (plain browser during UI development) an in-memory backend stands in.
  if (import.meta.env.DEV && !isTauri()) {
    const { installMockBackend } = await import("./dev/mock-backend");
    installMockBackend();
  }

  const container = document.getElementById("root");
  if (!container) throw new Error("Root element #root is missing from index.html");
  createRoot(container).render(
    <StrictMode>
      <Providers>
        <App />
      </Providers>
    </StrictMode>,
  );
}

void start();
