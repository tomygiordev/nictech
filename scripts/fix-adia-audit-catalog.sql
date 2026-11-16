-- =============================================================================
-- Saneamiento de Catálogo — Auditoría Comercial y Técnica ADIA (16/11/2026)
-- Cubre hallazgos:
--   02: Precios tachados (original_price) menores o iguales al precio actual (Motorola G23)
--   04: Réplicas con marcas registradas Apple/AirPods
--   05: Datos inconsistentes (Samsung A03 precio texto vs tarjeta, Airpods MAX color naranja vs foto celeste/gris, A03 Core vs A04e)
--   06: Etiqueta masiva CYBERMONDAY en los 41 productos
--   07 y 13: Unificación de criterio "Usado seleccionado" + 90 días de garantía escrita y normalización de mayúsculas
-- =============================================================================

BEGIN;

-- 1. Punto 02: Limpiar original_price inválido cuando es menor o igual a price (ej. Motorola G23: antes $93.390, ahora $184.900)
UPDATE public.products
SET original_price = NULL
WHERE original_price IS NOT NULL
  AND original_price <= price;

-- 2. Punto 06: Quitar el tag masivo CYBERMONDAY de los productos
UPDATE public.products
SET tags = array_remove(tags, 'CYBERMONDAY')
WHERE tags @> ARRAY['CYBERMONDAY'];

-- 3. Punto 04 y 05: Renombrar réplicas sin marcas registradas Apple/AirPods/Siri/Digital Crown y corregir color de vincha
UPDATE public.products
SET
  name = 'Auriculares Inalámbricos Vincha ANC Pro',
  description = E'Color: Celeste / Gris espacial\n• Audio de alta fidelidad con bajos profundos, medios precisos y agudos nítidos.\n• Cancelación Activa de Ruido (ANC) y Modo Ambiente para escuchar el entorno cuando lo necesites.\n• Diadema de malla respirable y almohadillas de espuma viscoelástica de alto confort.\n• Corona lateral multifunción para control de volumen, reproducción y llamadas.\n• Autonomía de hasta 20 horas de reproducción continua y carga por puerto USB-C.'
WHERE id = '1719bc3f-3df5-476a-97f1-914d22598d50';

UPDATE public.products
SET
  name = 'Auriculares Inalámbricos Bluetooth con Cancelación de Ruido',
  description = E'• Cancelación Activa de Ruido (ANC) con micrófonos para reducir ruidos ambientales.\n• Diseño ergonómico semi-abierto de gran comodidad para uso diario.\n• Conectividad Bluetooth 5.3 estable para celulares Android e iOS.\n• Control táctil en el auricular para música, llamadas y modos de sonido.\n• Estuche de carga compacto con puerto USB-C y hasta 30 horas de autonomía combinada.'
WHERE id = 'a789795d-46d4-4982-bc48-934c3e665aea';

-- 4. Punto 05 y 07: Corregir Samsung A03 64GB (quitar "Precio de contado: $155.000" que contradecía $145.898) y unificar criterio de usados con garantía escrita de 90 días
UPDATE public.products
SET
  condition = 'Usado',
  description = E'Samsung Galaxy A03 – 64 GB | 4 GB RAM\n\nEquipo usado seleccionado, revisado íntegramente en nuestro laboratorio técnico.\n\n• 64 GB de almacenamiento interno.\n• 4 GB de memoria RAM.\n• Estado: Usado seleccionado en excelente funcionamiento.\n• Garantía escrita: 90 días (3 meses) de respaldo técnico Nictech.\n• Batería y componentes verificados en banco de pruebas.'
WHERE id = 'f40cd62b-1e46-4681-965d-a3b3a3a30be8';

UPDATE public.products
SET
  condition = 'Usado',
  description = E'Motorola Moto G20 – 128 GB | 4 GB RAM\n\nEquipo usado seleccionado, revisado íntegramente en nuestro laboratorio técnico.\n\n• 128 GB de almacenamiento interno.\n• 4 GB de memoria RAM.\n• Estado: Usado seleccionado en excelente funcionamiento.\n• Garantía escrita: 90 días (3 meses) de respaldo técnico Nictech.\n• Batería y componentes verificados en banco de pruebas.'
WHERE id = '7c4de3aa-eab2-4811-a5fb-bf81718e59a2';

UPDATE public.products
SET
  condition = 'Usado',
  description = E'Motorola Moto G23 – 128 GB | 4 GB RAM\n\nEquipo usado seleccionado, revisado íntegramente en nuestro laboratorio técnico.\n\n• 128 GB de almacenamiento interno.\n• 4 GB de memoria RAM.\n• Estado: Usado seleccionado, excelente estado estético sin marcas de uso.\n• Garantía escrita: 90 días (3 meses) de respaldo técnico Nictech.\n• Batería y componentes verificados en banco de pruebas.'
WHERE id = '944b1eac-0926-4e7d-acf7-3c263dfe3fe4';

UPDATE public.products
SET
  condition = 'Usado',
  price = 98900.00,
  description = E'Samsung Galaxy A03 Core – 32 GB | 2 GB RAM\n\nEquipo usado seleccionado, ideal para WhatsApp, llamadas y tareas diarias.\n\n• 32 GB de almacenamiento interno.\n• 2 GB de memoria RAM.\n• Estado: Usado seleccionado, revisado en nuestro laboratorio técnico.\n• Garantía escrita: 90 días (3 meses) de respaldo técnico Nictech.'
WHERE id = 'aebe81bf-ea80-408b-8a9b-efcc977fef4d';

UPDATE public.products
SET
  condition = 'Usado',
  price = 121900.00,
  original_price = 135000.00,
  description = E'Samsung Galaxy A04e – 64 GB | 4 GB RAM\n\nEquipo usado seleccionado con amplio almacenamiento para redes sociales, fotos y aplicaciones.\n\n• 64 GB de almacenamiento interno.\n• 4 GB de memoria RAM.\n• Estado: Usado seleccionado, revisado en nuestro laboratorio técnico.\n• Garantía escrita: 90 días (3 meses) de respaldo técnico Nictech.'
WHERE id = 'a8dac598-ae37-4ed4-99c1-d8913c77c4c2';

UPDATE public.products
SET
  condition = 'Usado',
  description = E'Samsung Galaxy A51 – 128 GB | 4 GB RAM\n\nEquipo usado seleccionado, revisado íntegramente en nuestro laboratorio técnico.\n\n• 128 GB de almacenamiento interno.\n• 4 GB de memoria RAM.\n• Estado: Usado seleccionado en excelente funcionamiento.\n• Garantía escrita: 90 días (3 meses) de respaldo técnico Nictech.\n• Batería y componentes verificados en banco de pruebas.'
WHERE id = 'e9133f01-8942-449d-8e3e-4e951ce9d37f';

-- 5. Punto 05 y 13: Normalizar Auriculares Samsung con cable (quitar mayúsculas excesivas) y completar condition = Nuevo en productos nuevos
UPDATE public.products
SET
  name = 'Auriculares Samsung con Cable 3.5mm y Micrófono',
  description = E'• Auriculares con cable, micrófono integrado y botón manos libres.\n• Conector mini plug de 3.5 mm compatible con celulares, tablets y notebooks.\n• Sonido claro para llamadas, música y clases online.'
WHERE id = '4e961de2-d544-407a-878a-8534666489b5';

UPDATE public.products
SET condition = 'Nuevo'
WHERE condition IS NULL
  AND name NOT ILIKE '%(Usado)%';

COMMIT;
