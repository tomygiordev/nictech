
-- 1. Asegurar que existe la categoría 'Fundas'
INSERT INTO public.categories (name)
SELECT 'Fundas'
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE name ILIKE 'Fundas'
);

-- 2. (Opcional) Si quisieras limpiar fundas mal creadas anteriormente (bajo tu riesgo)
-- DELETE FROM public.products WHERE name LIKE 'Funda%';

-- 3. Asegurar índices para búsquedas rápidas si no existen
CREATE INDEX IF NOT EXISTS idx_products_model_id ON public.products(model_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);

-- 4. Política para que los variantes sean públicos (si no lo son ya)
-- Esto suele ser necesario para que los clientes puedan ver el stock de fundas
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'Enable read access for all users'
    ) THEN
        CREATE POLICY "Enable read access for all users" ON product_variants FOR SELECT USING (true);
    END IF;
END
$$;
