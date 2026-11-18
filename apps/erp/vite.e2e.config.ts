import { defineConfig } from "vite";
import erpConfig from "./vite.config";
import { localUrl } from "../../e2e/erp/local-url.mjs";

const api = localUrl(process.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL").origin;
if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Falta VITE_SUPABASE_PUBLISHABLE_KEY local.");
}

export default defineConfig({
  ...erpConfig,
  base: "/",
  envDir: false,
  plugins: [
    erpConfig.plugins ?? [],
    {
      name: "erp-e2e-local-font",
      // main.tsx already bundles this face; don't load a second copy from a CDN in QA.
      transformIndexHtml: (html) => html.replace(/^\s*<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>\s*$/gm, ""),
    },
  ],
  server: {
    headers: { "Content-Security-Policy": `connect-src 'self' ${api}; img-src 'self' ${api} data: blob:; frame-src 'self' blob:` },
  },
});
