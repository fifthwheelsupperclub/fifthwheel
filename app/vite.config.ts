import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [tanstackStart(), react()],
  // Sharp ships native platform binaries and must remain a Node-side dependency.
  build: { rollupOptions: { external: ["sharp"] } },
  ssr: { external: ["sharp"] },
  server: { host: "127.0.0.1", port: 8085, strictPort: true },
});
