# Contexto para planificar la unificación Panel Admin web → ERP

> Documento de handoff para el agente planificador. Relevado el 2026-11-14 sobre la rama `dev/erp`.
> Objetivo de este documento: dar todo el contexto necesario para **planificar** (no implementar) la fusión del panel de admin de la tienda web con el ERP.

---

## 1. Qué pide el usuario

- NicTech es un e-commerce de tecnología + servicio técnico de un amigo del usuario.
- Existen **dos paneles de gestión separados**:
  1. **Panel Admin web** (`/admin` dentro de la tienda, `src/pages/Admin.tsx` + `src/components/admin/`).
  2. **ERP** (app aparte, `apps/erp/`, React + Vite + Electron, módulos en `apps/erp/src/features/`).
- Todo se construyó con IA, en etapas, y el usuario sospecha que hay cosas incompatibles entre ambos, **sobre todo en la carga de productos**.
- **Meta:** que el ERP sea el único lugar de gestión y que el panel admin se absorba en él (o se reduzca a lo estrictamente web: blog, banners).
- El usuario quiere ir paso a paso ("vamos viendo qué onda"): el plan debe ser incremental, con cortes verificables y sin romper la tienda en producción.

## 2. Mapa técnico rápido

| Pieza | Ubicación | Notas |
|---|---|---|
| Tienda web | `src/` (React 18 + Vite + TS + shadcn) | Lee `public.products`, `public.product_variants`, `public.product_images`, `public.repairs`, `posts`, etc. |
| Panel admin | `src/pages/Admin.tsx`, `src/components/admin/*` | Escribe directo en tablas `public.*` con el cliente Supabase. |
| ERP | `apps/erp/src/features/*` | Usa schema `erp.*`, RPCs con permisos (`erp.has_permission`), organización fija `10000000-0000-0000-0000-000000000001`. |
| Registro de módulos ERP | `packages/domain/src/modules.ts` | Lista de módulos, áreas y permisos. |
| Checkout | `supabase/functions/create-mercadopago-preference/index.ts` | Toma precio de `public.products.price` (no de variantes). |
| Webhook MP | `supabase/functions/mercadopago-webhook/index.ts` | |
| Migraciones | `supabase/migrations/` (99 archivos, ~75 de ERP) | |
| Contrato previo | `docs/erp-catalog-input-contract.md` | **Leer completo.** Etapa S1 de un plan S1–S6 (del 2026-10-20). Matriz campo por campo admin→ERP y decisiones de negocio ya fijadas. Parcialmente desactualizado (ver §6). |
| Script de conciliación | `scripts/check-erp-catalog-baseline.sql` | Solo lectura. |
| Manuales | `ManualDeUsoERP.md`, `Manual_Operativo_ERP_NicTech.*` | Uso operativo del ERP. |

Convenciones del repo: ver `CLAUDE.md` y `AGENTS.md` (sin `any`, Zod en todo formulario, shadcn primero, no editar a mano los tipos generados). **Docker ya no se usa**; las pruebas de base usan fixtures temporales con rollback sobre Supabase, nunca `reset`/`seed`.

## 3. Cómo se conectan hoy (puente bidireccional por triggers)

Migraciones `20260923050000`–`20260923050005`:

- **Importación inicial** (`erp.import_storefront_catalog_opening`): copió el catálogo web al ERP **con los mismos UUID** (producto y variante).
- **Sincronización de catálogo** (`20260923050003_erp_storefront_catalog_sync.sql`), ambos sentidos, solo estos campos:
  - Producto: `name ↔ internal_name/public_name`, `description ↔ public_description`, `price ↔ base_sale_price`, `image_url ↔ web_image_path`, `is_active ↔ (is_active ∧ publish_on_web ∧ allow_online_sale ∧ can_sell)`, `category_id`, `brand_id`, `model_id`.
  - Variante: `color ↔ name/attributes.color`, `image_url ↔ image_path`, `is_active`.
  - Borrar en web → desactiva en ERP.
- **Referencias** (`...050005`): categorías, marcas y modelos sincronizados.
- **Stock**: el ERP es la autoridad. `erp.stock_balances` se proyecta a `public.products.stock` / `public.product_variants.stock` (solo ubicaciones con `contributes_to_web_stock`). Si alguien escribe stock directo en `public`, el trigger `capture_storefront_stock_delta` lo convierte en un **ajuste** de stock en el ERP (requiere permisos `stock.adjust` / `costs.manage`).
- Según el doc S1, el puente (catálogo + proyección + captura) estaba **activo en producción** al 2026-10-20.

## 4. Incompatibilidades encontradas (carga de productos)

1. **La ficha del ERP es más pobre que la del admin.** `CreateProductModal` / `ProductEditModal` (`apps/erp/src/features/catalog/`) no permiten cargar: foto principal, galería (`additional_images` / tabla `product_images`), descripción pública, `tags`, `capacity`, `condition` (Nuevo/Usado/Reacondicionado), precio en USD. Esos campos solo existen en `public.products` y se editan solo desde el admin.
2. **El ERP publica al instante sin contenido.** `erp.create_catalog_product_with_variants` inserta con `publish_on_web = true`, `allow_online_sale = true` → el producto aparece en la tienda sin foto ni descripción.
3. **Precio por variante divergente.** El ERP tiene `erp.product_variants.final_price_ars` (precio propio o heredado, migración `20261021014019`) y el POS lo usa vía `erp.resolve_catalog_effective_price`. **No se proyecta** a `public.product_variants`, y la web/checkout cobran el precio del padre → mismo artículo, distinto precio en mostrador y en web.
4. **Compatibilidad multimodelo sin reflejo web.** ERP: un SKU físico ↔ N modelos (`erp.product_compatible_models`, RPC `set_product_compatible_models`). Admin (`CaseManagement.tsx`): clona **un producto por modelo**, cada uno con stock propio. La tienda filtra por un único `model_id` y no conoce la compatibilidad del ERP.
5. **Promos y dólar del admin pisan el precio base del ERP.**
   - `PromoManagement.tsx` sobrescribe `public.products.price` con el precio rebajado (guarda `original_price`, `sale_expires_at`). El trigger lo copia a `erp.base_sale_price` → el POS cobra el precio promo y el vencimiento depende de una acción manual.
   - `DollarSettings.tsx` recalcula cada hora `price = price_usd * cotización` sin aprobación. Choca con la regla ERP de preview + aprobación (`erp.price_change_previews` / `price_change_applications`).
6. **Movimientos de stock del admin sin trazabilidad ERP.** `QuickSaleModal`, `QuickRestockModal`, `StockMovementModal` y `UnifiedInventory` hacen `UPDATE stock` directo (cálculo en cliente, con riesgo de pisar ventas concurrentes). El ERP lo ve como "ajuste": una venta rápida no pasa por caja/venta/comprobante y una reposición no registra compra ni costo formal. Además escriben `public.inventory_movements`, que el ERP no usa.
7. **Visibilidad de categorías de variantes en `localStorage`** (`VariantManagement.tsx`, clave `nictech_hidden_variant_cats`): estado local de un navegador, no del servidor.

## 5. Mapa del resto de módulos (admin → ERP)

Pestañas del admin (`src/pages/Admin.tsx`): `dashboard`, `repairs`, `inventory`, `products`, `cases`, `variants`, `promos`, `banners`, `blog` + `DollarSettings`.

| Admin (tabla que toca) | Equivalente ERP | Estado |
|---|---|---|
| Dashboard (`DashboardModule`) | Centro operativo (`dashboard`) | Duplicado. El ERP es más completo. |
| Reparaciones (`public.repairs`, `repair_logs`, `repair_statuses`; seguimiento web por `get_repair_by_tracking_code`) | Reparaciones (`erp.repair_orders`, tokens `erp.repair_tracking_tokens` con digest) | **No encontré puente entre los dos sistemas de reparaciones.** Hay que verificar: probablemente son dos bases de reparaciones paralelas, y `/seguimiento` solo ve las del admin. Riesgo alto. |
| Inventario / Productos / Fundas / Variantes (`products`, `product_variants`, `product_images`, `inventory_movements`, `categories`, `brands`, `models`) | Productos y servicios (`catalog`), Existencias (`stock`), Compras | Ver §4. |
| Promos (`products.price/original_price`) | Precios y monedas (`pricing`) | El ERP no tiene listas promocionales con vigencia operativas en la UI. |
| Dólar (`dollar_settings`) | Precios y monedas (cotizaciones/snapshots) | Lógicas incompatibles (§4.5). |
| Venta rápida | Punto de venta (`pos`) + Caja | El POS del ERP reemplaza esto. |
| Pedidos (`orders`) | Pedidos online (`online-orders`, RPC `erp.fulfill_web_order`) | Ya existe un puente ERP para pedidos web; verificar cobertura. |
| Banners (`hero_banners`, `carousel_settings`), Blog (`posts`) | — | Solo web. Decidir si migran al ERP (módulo "Contenido web") o quedan en un admin mínimo. |
| `product_clicks` (analítica web) | — | Solo web. |

Módulos ERP sin equivalente en admin: caja, compras, proveedores, clientes, presupuestos, garantías, armados de PC, equipos usados, cuentas corrientes, contabilidad, documentos/facturas, WhatsApp, integraciones, usuarios, auditoría.

## 6. Decisiones de negocio ya fijadas (de `docs/erp-catalog-input-contract.md`, §4)

1. El precio que carga el operador es **precio final ARS con IVA incluido**.
2. IVA 21% se **desglosa** (neto = round(final/1.21, 2)), nunca se suma encima.
3. **Un único resolver de precios en servidor** para POS, web y checkout.
4. Capturar la cotización USD **no cambia precios** automáticamente; requiere preview + aprobación.
5. Los productos con precio fijo en ARS no se tocan con cambios del dólar.
6. Compatibilidad múltiple = **un solo SKU físico** que referencia N modelos; prohibido clonar.
7. Los automatismos legacy (`DollarSettings`, `PromoManagement`) siguen activos hasta el cutover final (S6).

Avance posterior al doc S1 (commits recientes `3ed3c85`, `9a50b2d`, `4b52684`, `02fcf5b`): compatibilidades múltiples y comandos de variantes, precio final propio por variante, resolver canónico, POS con precio bruto final autoritativo (contrato v2). **Pendiente según el plan original:** proyección de ese resolver a web/checkout, guardado atómico de la ficha completa, nuevas pantallas, retiro de sincronizadores legacy (S6).

## 7. Qué no está verificado

- El estado real de producción (MCP de Supabase sin autorizar en la sesión de relevamiento). Los números del baseline vienen del doc S1 (2026-10-20): 199 productos web / 223 ERP, 275 variantes web / 294 ERP, 1 producto con `price_usd`, 2 promos activas.
- Si `public.repairs` y `erp.repair_orders` tienen alguna conexión fuera de las migraciones (por ejemplo, Edge Functions o un script manual).
- Si `public.inventory_movements` alimenta algo que importe (reportes del admin, `InventoryHistory.tsx`).
- Tipos de `src/integrations/supabase/types.ts` posiblemente desactualizados (no listan `price_usd`, `original_price`, `is_active`).
- Hay muchos cambios sin commitear en `dev/erp` (incluidos `CartContext`, `Checkout`, `Tienda`, Edge Functions de MP y migraciones nuevas no trackeadas). El plan debe partir de ese estado.

## 8. Qué se espera del plan

Un plan incremental en etapas, cada una desplegable y reversible, que para cada etapa indique: alcance, migraciones/RPC, pantallas afectadas en ERP y web, qué se apaga del admin, datos a migrar, criterios de aceptación y riesgo. Preguntas que el plan debería resolver o elevar al usuario:

1. **Ficha completa en el ERP**: dónde viven foto, galería, descripción, tags, capacidad y condición (¿columnas en `erp.products`, atributos de variante, tabla de medios?) y cómo se proyectan a `public`. Estado "borrador / no publicado" por defecto.
2. **Resolver único en la web**: cómo exponer `resolve_catalog_effective_price` a la tienda, al carrito y a `create-mercadopago-preference` (incluido el precio por variante).
3. **Promos y USD**: modelo de listas de precio con vigencia en el ERP; migración de las 2 promos activas y del producto en USD; apagado de `DollarSettings` y `PromoManagement`.
4. **Compatibilidad multimodelo en la web**: cómo la consulta la tienda (filtros por modelo) y cómo consolidar las fundas ya clonadas (unir stock, redirigir UUID usados en pedidos históricos).
5. **Reparaciones**: unificar `public.repairs` con `erp.repair_orders` y mantener `/seguimiento` funcionando (códigos `XXXX-XXXX` existentes).
6. **Stock y ventas rápidas**: reemplazar las escrituras directas del admin por documentos de stock / POS del ERP; qué hacer con `inventory_movements`.
7. **Contenido web** (banners, blog, carrusel): ¿módulo nuevo en el ERP o admin web mínimo?
8. **Acceso**: los usuarios del admin web y sus permisos en el ERP (las escrituras desde `public` ya exigen `catalog.manage`).
9. **Orden de apagado** de cada pestaña del admin y cómo verificar que nada en la web siga dependiendo de ella.
