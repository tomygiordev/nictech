
### 6. Corrección: Estado Fijo (ENUM)

El cliente confirmó que los estados deben ser fijos para coincidir con la barra de progreso. Ejecuta esto para asegurar la estructura correcta:

```sql
-- 1. Asegurar que existe la columna de descripción
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS problem_description TEXT;

-- 2. Recrear el tipo ENUM si no existe o si fue borrado
DO $$ BEGIN
    CREATE TYPE repair_status AS ENUM ('Recibido', 'Diagnóstico', 'Repuestos', 'Reparación', 'Finalizado');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Convertir la columna status de vuelta a ENUM (con casting explícito para evitar errores)
-- Primero nos aseguramos que los datos actuales sean válidos, o los reseteamos a 'Recibido' si no coinciden
UPDATE repairs 
SET status = 'Recibido' 
WHERE status NOT IN ('Recibido', 'Diagnóstico', 'Repuestos', 'Reparación', 'Finalizado');

-- Ahora sí convertimos
ALTER TABLE repairs ALTER COLUMN status DROP DEFAULT;
ALTER TABLE repairs ALTER COLUMN status TYPE repair_status USING status::repair_status;
ALTER TABLE repairs ALTER COLUMN status SET DEFAULT 'Recibido';
```
