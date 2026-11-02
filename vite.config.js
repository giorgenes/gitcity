import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the viewer into one page, which the CLI fills with a repository's data.
export default defineConfig({
  root: "template",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    minify: false,
    modulePreload: false,
    rollupOptions: { input: "template/city.html" },
  },
});
