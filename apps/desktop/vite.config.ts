import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed port and must not have Vite clear its terminal output.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // The shell parser loads its worker via `new URL(..., import.meta.url)`, which pre-bundling
  // breaks; its CommonJS dependencies still need pre-bundling.
  optimizeDeps: {
    exclude: ["@mongodb-js/shell-bson-parser"],
    include: [
      "@mongodb-js/shell-bson-parser > javascript-stringify",
      "@mongodb-js/shell-bson-parser > web-worker",
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
  },
});
