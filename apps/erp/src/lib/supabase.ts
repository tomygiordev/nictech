import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import { resolveSupabaseConfig } from "./supabaseConfig";

type ErpTables = Database["erp"]["Tables"];
type ErpFunctions = Database["erp"]["Functions"];

// Keep RPC nullability and structured JSON contracts outside the generated file.
export type CatalogSheetPayload = {
  id?: string;
  internal_name?: string;
  public_name?: string | null;
  public_description?: string | null;
  internal_description?: string | null;
  category_id?: string;
  brand_id?: string;
  model_id?: string | null;
  sheet_template?: "celular" | "accesorio" | "funda";
  base_cost?: number;
  base_sale_price?: number;
  tax_rate_percent?: number;
  tags?: string[];
  condition?: "nuevo" | "usado" | "reacondicionado" | null;
  capacity?: string | null;
  compatible_model_ids?: string[];
  variants?: Array<{
    id?: string | null; code: string; name: string; barcode?: string | null;
    color_id?: string | null; is_active?: boolean;
    final_price_mode?: "inherit" | "own"; final_price_ars?: number | null;
  }>;
  media?: Array<{
    id?: string; variant_id?: string | null; variant_code?: string;
    storage_path: string; sort_order: number; is_primary?: boolean; alt_text?: string | null;
  }>;
  initial_stock?: Array<{
    variant_code?: string;
    variant_id?: string;
    quantity: number;
    location_id: string;
    unit_cost: number;
  }>;
};
export type CatalogMediaRow = {
  id: string; organization_id: string; product_id: string; variant_id: string | null;
  storage_path: string; sort_order: number; is_primary: boolean; alt_text: string | null;
  is_active: boolean; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null;
};
export type CatalogColorRow = {
  id: string; organization_id: string; name: string; hex: string | null; is_active: boolean;
  created_at: string; updated_at: string; created_by: string | null; updated_by: string | null;
};

export type ErpDatabase = Omit<Database, "erp"> & {
  erp: Omit<Database["erp"], "Tables" | "Functions" | "Views"> & {
    Tables: Omit<ErpTables, "product_variants" | "products" | "product_categories" | "repair_orders" | "repair_statuses"> & {
      repair_orders: {
        Row: ErpTables["repair_orders"]["Row"] & { public_tracking_code: string };
        Insert: ErpTables["repair_orders"]["Insert"] & { public_tracking_code?: never };
        Update: ErpTables["repair_orders"]["Update"] & { public_tracking_code?: never };
        Relationships: ErpTables["repair_orders"]["Relationships"];
      };
      repair_statuses: {
        Row: ErpTables["repair_statuses"]["Row"] & { public_stage: string | null };
        Insert: ErpTables["repair_statuses"]["Insert"] & { public_stage?: string | null };
        Update: ErpTables["repair_statuses"]["Update"] & { public_stage?: string | null };
        Relationships: ErpTables["repair_statuses"]["Relationships"];
      };
      repair_notes: {
        Row: { id: string; organization_id: string; branch_id: string; repair_order_id: string; content: string; is_public: boolean; created_at: string; created_by: string | null };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      product_categories: {
        Row: ErpTables["product_categories"]["Row"] & { code_prefix: string };
        Insert: ErpTables["product_categories"]["Insert"] & { code_prefix?: string };
        Update: ErpTables["product_categories"]["Update"] & { code_prefix?: string };
        Relationships: ErpTables["product_categories"]["Relationships"];
      };
      colors: {
        Row: CatalogColorRow;
        Insert: Partial<CatalogColorRow> & Pick<CatalogColorRow, "organization_id" | "name">;
        Update: Partial<CatalogColorRow>;
        Relationships: [];
      };
      catalog_code_counters: {
        Row: { organization_id: string; prefix: string; last_value: number };
        Insert: { organization_id: string; prefix: string; last_value?: number };
        Update: { organization_id?: string; prefix?: string; last_value?: number };
        Relationships: [];
      };
      product_compatible_models: {
        Row: { id: string; organization_id: string; product_id: string; model_id: string; created_at: string; created_by: string | null; is_active: boolean };
        Insert: { id?: string; organization_id: string; product_id: string; model_id: string; created_at?: string; created_by?: string | null; is_active?: boolean };
        Update: { id?: string; organization_id?: string; product_id?: string; model_id?: string; created_at?: string; created_by?: string | null; is_active?: boolean };
        Relationships: [];
      };
      product_media: {
        Row: CatalogMediaRow;
        Insert: Partial<CatalogMediaRow> & Pick<CatalogMediaRow, "organization_id" | "product_id" | "storage_path" | "sort_order">;
        Update: Partial<CatalogMediaRow>;
        Relationships: [];
      };
      products: {
        Row: ErpTables["products"]["Row"] & {
          tags: string[];
          condition: "nuevo" | "usado" | "reacondicionado" | null;
          capacity: string | null;
          sheet_template: "celular" | "accesorio" | "funda";
          web_status: "draft" | "published" | "paused";
          media_initialized: boolean;
          sheet_fields_initialized: boolean;
        };
        Insert: ErpTables["products"]["Insert"] & {
          tags?: string[];
          condition?: "nuevo" | "usado" | "reacondicionado" | null;
          capacity?: string | null;
          sheet_template?: "celular" | "accesorio" | "funda";
        };
        Update: ErpTables["products"]["Update"] & {
          tags?: string[];
          condition?: "nuevo" | "usado" | "reacondicionado" | null;
          capacity?: string | null;
          sheet_template?: "celular" | "accesorio" | "funda";
        };
        Relationships: ErpTables["products"]["Relationships"];
      };
      product_variants: {
        Row: ErpTables["product_variants"]["Row"] & {
          final_price_ars: number | null;
          color_id: string | null;
        };
        Insert: ErpTables["product_variants"]["Insert"] & {
          final_price_ars?: number | null;
          color_id?: string | null;
        };
        Update: ErpTables["product_variants"]["Update"] & {
          final_price_ars?: number | null;
          color_id?: string | null;
        };
        Relationships: ErpTables["product_variants"]["Relationships"];
      };
    };
    Views: Omit<Database["erp"]["Views"], "repair_orders_overview"> & {
      repair_orders_overview: { Row: Database["erp"]["Views"]["repair_orders_overview"]["Row"] & { public_tracking_code: string | null; status_public_stage: string | null }; Relationships: Database["erp"]["Views"]["repair_orders_overview"]["Relationships"] };
      active_catalog_products: { Row: Omit<ErpDatabase["erp"]["Tables"]["products"]["Row"], "base_cost" | "purchase_currency" | "target_margin_percent">; Relationships: [] };
      active_catalog_variants: { Row: ErpDatabase["erp"]["Tables"]["product_variants"]["Row"]; Relationships: [] };
      active_stock_balances: { Row: ErpTables["stock_balances"]["Row"]; Relationships: [] };
    };
    Functions: Omit<
      ErpFunctions,
      "record_repair_payment" | "intake_trade_in_direct" | "record_trade_in_refurbishment"
      | "save_catalog_product_sheet" | "set_product_compatible_models" | "manage_product_variants"
    > & {
      search_repairs_by_document: { Args: { p_document: string }; Returns: Array<{ repair_order_id: string }> };
      add_repair_note: { Args: { p_repair_order_id: string; p_content: string; p_is_public: boolean }; Returns: string };
      save_catalog_product_sheet: {
        Args: { payload: CatalogSheetPayload; p_expected_updated_at?: string | null };
        Returns: { product: ErpDatabase["erp"]["Tables"]["products"]["Row"]; variants: ErpDatabase["erp"]["Tables"]["product_variants"]["Row"][]; media: CatalogMediaRow[] };
      };
      get_catalog_publish_checklist: {
        Args: { p_product_id: string }; Returns: { product_id: string; ready: boolean; missing: string[] };
      };
      publish_catalog_product: { Args: { p_product_id: string }; Returns: { product_id: string; web_status: "published" } };
      unpublish_catalog_product: { Args: { p_product_id: string }; Returns: { product_id: string; web_status: "draft" | "published" | "paused" } };
      recode_catalog_product: { Args: { p_product_id: string; p_new_code: string }; Returns: { product_id: string; old_code: string; internal_code: string } };
      save_catalog_color: { Args: { p_name: string; p_hex?: string | null; p_color_id?: string | null; p_is_active?: boolean }; Returns: CatalogColorRow };
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
          tax_rate_percent: number;
          price_source: "parent_base" | "parent_inherited" | "variant_override";
          is_override: boolean;
        };
      };
      get_catalog_product_variants: {
        Args: {
          p_product_id: string;
          p_include_inactive?: boolean;
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

export const configResult = resolveSupabaseConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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

