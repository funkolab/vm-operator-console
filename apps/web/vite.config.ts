import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8080";

// Built with a relative base: JS chunks resolve each other through
// import.meta.url, and the server rewrites the "./" references in index.html
// to BASE_PATH at runtime, so a single build works under any URL prefix.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (/react-dom|scheduler/.test(id)) return "react";
          }
        },
      },
    },
  },
}));
