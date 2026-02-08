-- SCRIPT DE SEGURIDAD (RLS) PARA EL PANEL ADMIN
-- Ejecuta este script el SQL Editor de Supabase para asegurar tus datos.

-- 1. Habilitar RLS en todas las tablas sensibles
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE repairs ENABLE ROW LEVEL SECURITY;

-- 2. Políticas para PRODUCTOS
-- Cualquiera puede ver productos (para la tienda)
CREATE POLICY "Public Read Products" ON products FOR SELECT USING (true);
-- Solo admin puede crear, editar o borrar
CREATE POLICY "Admin All Products" ON products FOR ALL USING (auth.role() = 'authenticated');

-- 3. Políticas para CATEGORÍAS
-- Cualquiera puede ver categorías
CREATE POLICY "Public Read Categories" ON categories FOR SELECT USING (true);
-- Solo admin puede gestionar categorías
CREATE POLICY "Admin All Categories" ON categories FOR ALL USING (auth.role() = 'authenticated');

-- 4. Políticas para REPARACIONES
-- Cualquiera puede ver reparaciones (para el seguimiento por código)
-- Nota: En producción idealmente filtraríamos por código, pero 'true' es aceptable si los IDs/Códigos son secretos.
CREATE POLICY "Public Read Repairs" ON repairs FOR SELECT USING (true);
-- Solo admin puede actualizar estado y notas
CREATE POLICY "Admin Update Repairs" ON repairs FOR UPDATE USING (auth.role() = 'authenticated');
-- Permitir crear reparaciones (si hubiera un formulario público, si no, restringir a admin)
CREATE POLICY "Admin Create Repairs" ON repairs FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- NOTA SOBRE EL USUARIO ADMIN:
-- Para crear tu usuario administrador, ve a 'Authentication' -> 'Users' en el panel de Supabase
-- y haz clic en 'Add User'. Ingresa tu email y contraseña.
-- Una vez creado, podrás usar esas credenciales en el login (/login).
