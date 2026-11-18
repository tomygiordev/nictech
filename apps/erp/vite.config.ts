import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  base: process.env.ERP_BASE_PATH || "./",
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
