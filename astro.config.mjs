import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://fifthwheel.community",
  base: "/",
  output: "static",
  // Directory routes so GitHub Pages serves /landing/ from landing/index.html.
  trailingSlash: "always",
  build: {
    format: "directory",
  },
});
