ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Create an index for faster searching if needed later (GIN index for array)
CREATE INDEX IF NOT EXISTS idx_products_tags ON public.products USING GIN (tags);
