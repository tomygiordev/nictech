
### 7. Bitácora de Reparaciones (Logs Cronológicos)

Para permitir un historial detallado de avances con fecha automática:

```sql
-- 1. Crear tabla de logs
CREATE TABLE repair_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id UUID REFERENCES repairs(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_public BOOLEAN DEFAULT TRUE -- Por defecto visible al cliente
);

-- 2. Habilitar RLS
ALTER TABLE repair_logs ENABLE ROW LEVEL SECURITY;

-- 3. Políticas
-- Admin puede hacer todo
CREATE POLICY "Admin All Logs" ON repair_logs FOR ALL USING (auth.role() = 'authenticated');
-- Clientes pueden leer logs públicos de sus reparaciones (o cualquiera si es público general por ahora)
CREATE POLICY "Public Read Logs" ON repair_logs FOR SELECT USING (is_public = TRUE);
```
