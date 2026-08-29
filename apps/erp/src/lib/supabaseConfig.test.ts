import { describe, expect, it } from "vitest";
import { resolveSupabaseConfig } from "./supabaseConfig";

describe("resolveSupabaseConfig", () => {
  it("accepts a complete valid configuration", () => {
    expect(resolveSupabaseConfig({ VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toEqual({
      ok: true,
      config: { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" },
    });
  });
  it("rejects missing values without fallbacks", () => {
    expect(resolveSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: "key" }).ok).toBe(false);
    expect(resolveSupabaseConfig({ VITE_SUPABASE_URL: "https://example.supabase.co" }).ok).toBe(false);
  });
  it("rejects an invalid URL", () => {
    expect(resolveSupabaseConfig({ VITE_SUPABASE_URL: "not-a-url", VITE_SUPABASE_PUBLISHABLE_KEY: "key" })).toEqual({ ok: false, message: "VITE_SUPABASE_URL no contiene una URL válida." });
  });
});
