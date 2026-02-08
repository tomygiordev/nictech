
### 5. Refactorización de Reparaciones (Flexible Status)

Para permitir estados personalizados y descripciones detalladas, ejecuta este script en el SQL Editor de Supabase:

```sql
-- 1. Eliminar el check del enum actual (si existe) y convertir a texto
ALTER TABLE repairs ALTER COLUMN status DROP DEFAULT;
-- Primero castear la columna status a texto para quitar la dependencia del enum
ALTER TABLE repairs ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE repairs ALTER COLUMN status SET DEFAULT 'Recibido';

-- 2. Asegurar que existe la columna de descripción (si no usas notes)
-- En este caso usaremos 'notes' para la descripción técnica y agregaremos 'problem_description' para lo que dice el cliente.
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS problem_description TEXT;

-- 3. (Opcional) Si quieres limpiar los tipos viejos
DROP TYPE IF EXISTS repair_status;
```
