import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  base: './',
  plugins: [react()],
  envDir: __dirname,
  css: {
    postcss: { plugins: [] },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
