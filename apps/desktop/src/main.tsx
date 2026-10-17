import "@fontsource-variable/inter";
import "./styles.css";
import "./lib/i18n";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { Providers } from "./app/providers";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
