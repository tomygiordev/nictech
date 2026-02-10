-- Create Brands table
CREATE TABLE IF NOT EXISTS public.brands (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create Models table
CREATE TABLE IF NOT EXISTS public.models (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(brand_id, name)
);

-- Add new columns to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id),
ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES public.models(id),
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS capacity TEXT,
ADD COLUMN IF NOT EXISTS condition TEXT CHECK (condition IN ('Nuevo', 'Usado', 'Reacondicionado'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_model_id ON public.products(model_id);

-- Enable RLS
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Simplified for now)
CREATE POLICY "Enable read access for all users" ON public.brands FOR SELECT USING (true);
CREATE POLICY "Enable all access for auth users" ON public.brands USING (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for all users" ON public.models FOR SELECT USING (true);
CREATE POLICY "Enable all access for auth users" ON public.models USING (auth.role() = 'authenticated');
