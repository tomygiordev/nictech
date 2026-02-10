
-- 1. Drop existing constraint if it exists (we need to know the name, usually generic)
-- Try to drop the constraint on model_id. The name might vary, so we'll try a common naming convention or just alter.
-- PostgreSQL doesn't support "ALTER CONSTRAINT" directly to change action. We must DROP and ADD.

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Find the constraint name for the foreign key on model_id
    FOR r IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.products'::regclass 
        AND confrelid = 'public.models'::regclass
        AND contype = 'f'
        AND conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attname = 'model_id')
    LOOP
        EXECUTE 'ALTER TABLE public.products DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

-- 2. Add the constraint back with ON DELETE CASCADE
ALTER TABLE public.products
ADD CONSTRAINT fk_products_model
FOREIGN KEY (model_id)
REFERENCES public.models(id)
ON DELETE CASCADE;

-- 3. Ensure Case Categories exist (Idempotent)
INSERT INTO public.categories (name)
SELECT 'Fundas'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name ILIKE 'Fundas');
