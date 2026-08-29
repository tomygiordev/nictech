import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseConfig } from "./supabaseConfig";

const runtimeEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL;
const supabasePublishableKey = runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
const configResult = resolveSupabaseConfig({
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
});

export const supabase: SupabaseClient | null = configResult.ok
  ? createClient(configResult.config.url, configResult.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, storage: localStorage },
    })
  : null;

export const supabaseConfigError = configResult.ok ? null : configResult.message;
