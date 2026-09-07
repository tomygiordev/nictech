import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseConfig } from "./supabaseConfig";

const runtimeEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};

export const configResult = resolveSupabaseConfig({
  VITE_SUPABASE_URL: runtimeEnv.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export const supabaseConfigError: string | null = configResult.ok ? null : configResult.message;

export const supabase: SupabaseClient<any, "erp"> = configResult.ok
  ? createClient(configResult.config.url, configResult.config.publishableKey, {
      db: { schema: "erp" },
      auth: { persistSession: true, autoRefreshToken: true, storage: localStorage },
    })
  : (new Proxy({}, {
      get(_target, prop) {
        throw new Error(
          supabaseConfigError ??
            "Configuración de Supabase incompleta. Configure VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.",
        );
      },
    }) as unknown as SupabaseClient<any, "erp">);

