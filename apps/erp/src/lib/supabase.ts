import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import { resolveSupabaseConfig } from "./supabaseConfig";

type ErpFunctions = Database["erp"]["Functions"];

// Supabase type generation does not currently preserve nullability for RPC
// parameters without a PostgreSQL default. Keep the generated file immutable
// and document the three nullable UUIDs exposed by the ERP SQL contract here.
type ErpDatabase = Omit<Database, "erp"> & {
  erp: Omit<Database["erp"], "Functions"> & {
    Functions: Omit<
      ErpFunctions,
      "record_repair_payment" | "intake_trade_in_direct" | "record_trade_in_refurbishment"
    > & {
      record_repair_payment: Omit<ErpFunctions["record_repair_payment"], "Args"> & {
        Args: Omit<ErpFunctions["record_repair_payment"]["Args"], "target_cash_session_id"> & {
          target_cash_session_id: string | null;
        };
      };
      intake_trade_in_direct: Omit<ErpFunctions["intake_trade_in_direct"], "Args"> & {
        Args: Omit<ErpFunctions["intake_trade_in_direct"]["Args"], "target_variant_id"> & {
          target_variant_id: string | null;
        };
      };
      record_trade_in_refurbishment: Omit<
        ErpFunctions["record_trade_in_refurbishment"],
        "Args"
      > & {
        Args: Omit<
          ErpFunctions["record_trade_in_refurbishment"]["Args"],
          "target_repair_order_id"
        > & {
          target_repair_order_id: string | null;
        };
      };
    };
  };
};

const runtimeEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};

export const configResult = resolveSupabaseConfig({
  VITE_SUPABASE_URL: runtimeEnv.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export const supabaseConfigError: string | null = configResult.ok ? null : configResult.message;

const unavailableClient = (): SupabaseClient<ErpDatabase, "erp"> =>
  createClient<ErpDatabase, "erp">("http://127.0.0.1:54321", "missing-supabase-configuration", {
    db: { schema: "erp" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: () =>
        Promise.reject(
          new Error(
            supabaseConfigError ??
              "Configuración de Supabase incompleta. Configure VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.",
          ),
        ),
    },
  });

export const supabase: SupabaseClient<ErpDatabase, "erp"> = configResult.ok
  ? createClient(configResult.config.url, configResult.config.publishableKey, {
      db: { schema: "erp" },
      auth: { persistSession: true, autoRefreshToken: true, storage: localStorage },
    })
  : unavailableClient();

