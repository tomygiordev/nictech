-- Ensure products table has tags column
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Ensure tags column is indexed
CREATE INDEX IF NOT EXISTS idx_products_tags ON public.products USING GIN (tags);

-- Insert default categories if they don't exist
INSERT INTO public.categories (name)
SELECT 'Celulares'
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE name ILIKE '%celular%' OR name ILIKE '%smartphone%'
);

INSERT INTO public.categories (name)
SELECT 'Fundas'
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE name ILIKE '%funda%' OR name ILIKE '%case%'
);

-- Ensure product_variants table exists (from previous step, just to be safe in one script)
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  color TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for variants if table was just created
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'Enable read access for all users'
    ) THEN
        CREATE POLICY "Enable read access for all users" ON product_variants FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'Enable insert for authenticated users'
    ) THEN
        CREATE POLICY "Enable insert for authenticated users" ON product_variants FOR INSERT WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'Enable update for authenticated users'
    ) THEN
        CREATE POLICY "Enable update for authenticated users" ON product_variants FOR UPDATE USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'Enable delete for authenticated users'
    ) THEN
        CREATE POLICY "Enable delete for authenticated users" ON product_variants FOR DELETE USING (auth.role() = 'authenticated');
    END IF;
END
$$;
