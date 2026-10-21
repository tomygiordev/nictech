import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import { resolveSupabaseConfig } from "./supabaseConfig";

type ErpTables = Database["erp"]["Tables"];
type ErpFunctions = Database["erp"]["Functions"];

// Supabase type generation does not currently preserve nullability for RPC
// parameters without a PostgreSQL default, nor does it contain the new nullable
// final_price_ars column on erp.product_variants until remote schema is synced.
// Keep the generated file immutable and document ERP database extensions here.
type ErpDatabase = Omit<Database, "erp"> & {
  erp: Omit<Database["erp"], "Tables" | "Functions"> & {
    Tables: Omit<ErpTables, "product_variants"> & {
      product_variants: {
        Row: ErpTables["product_variants"]["Row"] & {
          final_price_ars: number | null;
        };
        Insert: ErpTables["product_variants"]["Insert"] & {
          final_price_ars?: number | null;
        };
        Update: ErpTables["product_variants"]["Update"] & {
          final_price_ars?: number | null;
        };
        Relationships: ErpTables["product_variants"]["Relationships"];
      };
    };
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
      set_product_compatible_models: {
        Args: {
          p_product_id: string;
          p_model_ids: string[];
          p_expected_updated_at?: string | null;
        };
        Returns: {
          product_id: string;
          compatible_model_ids: string[];
        };
      };
      get_product_compatible_models: {
        Args: {
          p_product_id: string;
        };
        Returns: Array<{
          id: string;
          model_id: string;
          model_code: string;
          model_name: string;
          brand_id: string | null;
          brand_name: string | null;
        }>;
      };
      manage_product_variants: {
        Args: {
          p_product_id: string;
          p_variants: Array<{
            id?: string | null;
            name: string;
            code: string;
            barcode?: string | null;
            is_active?: boolean;
            final_price_mode?: "inherit" | "own";
            final_price_ars?: number | null;
          }>;
          p_expected_updated_at?: string | null;
        };
        Returns: {
          product_id: string;
          variants: Array<{
            id: string;
            code: string;
            name: string;
            is_active: boolean;
            barcode: string | null;
            final_price_ars?: number | null;
            effective_price_ars?: number;
            is_override?: boolean;
          }>;
        };
      };
      resolve_catalog_effective_price: {
        Args: {
          p_product_id: string;
          p_variant_id?: string | null;
        };
        Returns: {
          product_id: string;
          variant_id: string | null;
          currency_code: string;
          final_price_ars: number;
          price_source: string;
          is_override: boolean;
        };
      };
      get_catalog_product_variants: {
        Args: {
          p_product_id: string;
        };
        Returns: Array<{
          id: string;
          code: string;
          name: string;
          attributes: Record<string, unknown>;
          price_delta: number;
          final_price_ars: number | null;
          effective_price_ars: number;
          is_override: boolean;
          is_active: boolean;
          barcode: string | null;
          sku: string | null;
        }>;
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

