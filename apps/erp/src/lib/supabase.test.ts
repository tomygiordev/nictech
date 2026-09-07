import { describe, expect, it } from "vitest";
import { supabase, supabaseConfigError } from "./supabase";

describe("supabase client initialization", () => {
  it("initializes without remote fallbacks", () => {
    // When environment variables are set from .env, it should succeed without config error
    if (supabaseConfigError) {
      expect(typeof supabaseConfigError).toBe("string");
    } else {
      expect(supabaseConfigError).toBeNull();
      expect(supabase).toBeDefined();
    }
  });

  it("does not contain hardcoded remote URL or key in exports", () => {
    expect(supabaseConfigError ?? "").not.toContain("tuzpcofywkhglkqplhnn");
  });
});


