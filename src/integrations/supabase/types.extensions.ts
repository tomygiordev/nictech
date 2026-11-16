import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { supabase } from './client';

type Product = Database['public']['Tables']['products'];
type Variant = Database['public']['Tables']['product_variants'];
export type StorefrontDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Omit<Database['public']['Tables'], 'product_variants' | 'products'> & {
      products: Omit<Product, 'Row'> & { Row: Product['Row'] & { is_active: boolean; price_usd: number | null; original_price: number | null; sale_expires_at: string | null } };
      product_variants: Omit<Variant, 'Row'> & { Row: Variant['Row'] & { price: number | null; is_active: boolean } };
    };
  };
};

// The existing client and its auth session are shared; no second client is created.
export const storefrontSupabase = supabase as unknown as SupabaseClient<StorefrontDatabase>;
