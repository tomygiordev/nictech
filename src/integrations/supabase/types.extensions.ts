import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { supabase } from './client';

type Product = Database['public']['Tables']['products'];
type Variant = Database['public']['Tables']['product_variants'];
export type StorefrontDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Views' | 'Functions'> & {
    Tables: Omit<Database['public']['Tables'], 'product_variants' | 'products'> & {
      products: Omit<Product, 'Row'> & { Row: Product['Row'] & { is_active: boolean; price_usd: number | null; original_price: number | null; sale_expires_at: string | null } };
      product_variants: Omit<Variant, 'Row'> & { Row: Variant['Row'] & { price: number | null; is_active: boolean } };
    };
    Views: {
      storefront_promotion_prices: {
        Row: {
          product_id: string;
          variant_id: string | null;
          list_price: number;
          effective_price: number;
          promotion_id: string | null;
          promotion_ends_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: Database['public']['Functions'] & {
      get_admin_cutover_flags: {
        Args: Record<PropertyKey, never>;
        Returns: {
          group_code: string;
          admin_tab_hidden: boolean;
          legacy_write_mode: string;
        }[];
      };
    };
  };
};

// The existing client and its auth session are shared; no second client is created.
export const storefrontSupabase = supabase as unknown as SupabaseClient<StorefrontDatabase>;
