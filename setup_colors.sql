-- Create Colors table
CREATE TABLE IF NOT EXISTS public.colors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Enable read access for all users" ON public.colors FOR SELECT USING (true);
CREATE POLICY "Enable all access for auth users" ON public.colors USING (auth.role() = 'authenticated');

-- Insert common colors
INSERT INTO public.colors (name) VALUES 
('Negro'), ('Blanco'), ('Azul'), ('Rojo'), ('Verde'), ('Gris'), ('Dorado'), ('Plateado'), ('Violeta'), ('Rosa')
ON CONFLICT (name) DO NOTHING;
