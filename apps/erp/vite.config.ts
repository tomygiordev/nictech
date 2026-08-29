import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, "../../"),
  css: {
    postcss: { plugins: [] },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
