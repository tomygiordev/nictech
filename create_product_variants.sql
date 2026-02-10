CREATE TABLE IF NOT EXISTS product_variants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  color TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- Add RLS policies (Open for now as per previous patterns, or match products policy)
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON product_variants
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users only" ON product_variants
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users only" ON product_variants
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users only" ON product_variants
    FOR DELETE USING (auth.role() = 'authenticated');

-- Ensure products have a 'tags' column if not already there (handled in previous step, but safe to ignore if exists)
-- This script focuses on variants.
