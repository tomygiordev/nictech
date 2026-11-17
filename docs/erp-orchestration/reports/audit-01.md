# Auditoría 01: catálogo ERP, base de datos (Etapa 0B + Etapa 1)

**Veredicto: APROBADO CON FIXES.** Hay 3 bloqueantes, 6 importantes y 10 menores.

Las migraciones `20261114100000…100900` todavía no están aplicadas en ningún entorno. Por eso los fixes **se hacen editando esas mismas migraciones nuevas** (no hace falta una migración adicional), salvo que se indique otra cosa.

## Cómo se validó (ejecución real, 100 % local)

- Se armó un clúster PostgreSQL 18 aislado en `A:\_audit_pg` (puerto 56432, `trust`, solo localhost). Tiene un shim mínimo de Supabase (roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()/role()/jwt()`, schema `extensions` con pgcrypto) y un subconjunto de pgTAP (`plan/ok/is/isnt/lives_ok/throws_ok/throws_like/finish`). Scripts en `A:\_audit_pg\work\`.
- Docker no sirvió: el daemon reporta `read-only file system` al hacer pull. No hubo conexiones remotas.
- Se aplicaron las 99 migraciones previas y `seed.sql` (todas OK), y después las 10 nuevas: OK en una base vacía y en una simulación de producción. La simulación tiene `public.products/product_variants/categories/brands/models` con la forma de `src/integrations/supabase/types.ts`, datos con tags, condición, galería y variantes, `import_storefront_catalog_opening()` + `activate_storefront_bridge()`, y otra copia sin puente activo.
- Al aplicar las migraciones no cambió ninguna fila de `public.products/product_variants` (diff vacío).
- Paridad de precio con `price_delta = 0`: `resolve_catalog_effective_price` y `get_catalog_product_variants` devuelven JSON **idéntico** antes y después.
- Firmas, `SECURITY DEFINER`, `search_path` y ACL de las funciones redefinidas no cambian. La única diferencia es `prevent_product_code_reassignment`, que pasa a `SECURITY DEFINER`; es intencional.
- Tests DO existentes con las migraciones nuevas: `erp_catalog_compatibility_and_variants`, `erp_catalog_variant_final_price` y `erp_pos_authoritative_gross_pricing` → **PASS** (con fixture de admin, marca, 2 modelos y tipo de cambio ARS). `erp_storefront_bridge.test.sql` → **ROTO** (ver I1).
- Test nuevo `erp_catalog_sheet_media_publish.test.sql`: **falla**. Con B1 y B2 parcheados solo en la base de prueba da 44/45; la que falla es la 26 (ver B3).
- Scripts de datos: `erp-stage1-backfill-catalog-sheet.sql`, en dry-run hace ROLLBACK; en apply es idempotente (la segunda corrida da `INSERT 0 0`). Pero **borra condiciones no estándar en la web** (ver I3). `erp-stage1-catalog-cleanup.sql` en dry-run: OK.

---

## BLOQUEANTES

### B1. `save_catalog_product_sheet` falla siempre: `column reference "p" is ambiguous`
- **Archivo:** `supabase/migrations/20261114100500_erp_catalog_save_sheet.sql:103`
- **Problema:** la variable PL/pgSQL `p erp.products%rowtype` (línea 4) choca con el alias `p` del `select … from erp.products p` final. Toda llamada (alta o edición) termina en error 42702 después de hacer todo el trabajo. Verificado ejecutando.
- **Fix:** en la línea 103 renombrar el alias a `pr`, es decir `to_jsonb(pr)`, `v.product_id=pr.id`, `m.product_id=pr.id`, `from erp.products pr where pr.id=v_id and pr.organization_id=org_id`. Alternativa: renombrar la variable `p` a `v_prod` en toda la función.

### B2. `authenticated` no puede leer las columnas nuevas de `erp.products`, y la vista `erp.active_catalog_products` es inutilizable
- **Archivos:** `supabase/migrations/20261114100100_erp_catalog_sheet_columns.sql` (al final), `20261114100200_erp_catalog_media_codes.sql:2-3` y `20261114100700_erp_catalog_colors_active_views.sql:20`
- **Problema:** `erp.products` usa **grants por columna** para `authenticated`; por ejemplo, `base_cost`, `purchase_currency` y `target_margin_percent` no son seleccionables. Las columnas nuevas `tags, condition, capacity, sheet_template, web_status, media_initialized, sheet_fields_initialized` no tienen `grant select`.
  - `select web_status from erp.products` como `authenticated` → `permission denied for table products`. Verificado; es la línea 60 del test nuevo.
  - `erp.active_catalog_products` está definida como `select *` con `security_invoker` → `permission denied` para cualquier usuario. Verificado.
  - La tarea 02 no puede leer la ficha.
- **Fix:**
  1. Agregar al final de `20261114100200_…sql` (después de crear `media_initialized` y `sheet_fields_initialized`):
     `grant select (tags, condition, capacity, sheet_template, web_status, media_initialized, sheet_fields_initialized) on erp.products to authenticated;`
     No dar `update`: las escrituras van por RPC.
  2. Redefinir `erp.active_catalog_products` en `100700` con **lista explícita de columnas**, es decir todas las que `authenticated` tiene en SELECT más las nuevas, **sin** `base_cost`, `purchase_currency` ni `target_margin_percent`. Sacar la lista de `information_schema.column_privileges` (grantee `authenticated`, privilege `SELECT`).
  3. Ajustar el overlay `active_catalog_products.Row` en `apps/erp/src/lib/supabase.ts` a `Omit<…products Row, "base_cost" | "purchase_currency" | "target_margin_percent">`.
  4. Agregar al test nuevo una aserción `lives_ok('select web_status, tags from erp.products limit 1')` y otra sobre la vista, ambas como `authenticated`.

### B3. El test pgTAP nuevo no pasa
- **Archivo:** `supabase/tests/database/erp_catalog_sheet_media_publish.test.sql`
- **Problema:** además de B1 y B2, la aserción 26 (línea 104, `direct code reassignment is blocked`) espera `23000`, pero como `authenticated` sale antes `42501` (no tiene UPDATE sobre `internal_code`). Por eso nunca prueba el trigger.
- **Fix:** antes de la línea 104 poner `reset role;`, ejecutar el `throws_ok(… '23000' …)` como dueño y luego volver con `set local role authenticated;`. Opcional: agregar otra aserción como `authenticated` que espere `42501`. Después de B1 y B2 el test tiene que dar 45/45.

---

## IMPORTANTES

### I1. El puente rompe con `public.products` sin `tags/condition/capacity/additional_images` y rompe `erp_storefront_bridge.test.sql`
- **Archivo:** `supabase/migrations/20261114100600_erp_catalog_sheet_bridge.sql:84-89, 94-97, 104` (trigger web→ERP) y `:13, :19, :24-31` (`project_catalog_sheet`)
- **Problema:** usa `new.condition`, `new.tags`, `new.capacity` y `new.additional_images` directamente. El test existente `erp_storefront_bridge.test.sql` crea `public.products` sin esas columnas y ahora falla con `record "new" has no field "condition"` (antes: 24/24 OK). Producción sí tiene esas columnas, pero cualquier fixture o entorno sin ellas queda roto.
- **Fix:**
  - En el trigger, leer con `to_jsonb(new)` (como ya se hace con `category_id`): `v_condition := lower(nullif(btrim(to_jsonb(new)->>'condition'),''))`; `tags := coalesce(array(select jsonb_array_elements_text(coalesce(to_jsonb(new)->'tags','[]'))), '{}')`; `capacity := to_jsonb(new)->>'capacity'`. Comparar imágenes con `(to_jsonb(old)->'additional_images') is distinct from (to_jsonb(new)->'additional_images')`.
  - Además, actualizar los fixtures `create table if not exists public.products (...)` de `erp_storefront_bridge.test.sql`, `erp_storefront_catalog_import.test.sql`, `erp_storefront_catalog_batches.test.sql` y `erp_storefront_stock_projection.test.sql` para que incluyan `additional_images text[]`, `tags text[]`, `condition text`, `capacity text`, como en producción. Ese archivo de test está en la lista de permitidos.

### I2. `save_catalog_product_sheet` falla en cualquier base sin `public.products` (reset local de Supabase)
- **Archivo:** `supabase/migrations/20261114100500_erp_catalog_save_sheet.sql:19-20`
- **Problema:** la condición del `IF` referencia `public.products` de forma estática. PL/pgSQL planifica la expresión completa, así que en una base local (las tablas `public.*` legacy no se crean en migraciones) **toda** llamada, incluidas las altas, falla con `relation "public.products" does not exist`. Verificado. Esto bloquea el desarrollo y las pruebas locales de la tarea 02.
- **Fix:**
  ```sql
  if not v_new and not p.sheet_fields_initialized and to_regclass('public.products') is not null
     and exists(select 1 from erp.storefront_catalog_sync where organization_id=org_id) then
    execute 'select coalesce(tags,''{}''), lower(nullif(btrim(condition),'''')), capacity from public.products where id=$1'
      into v_tags, v_condition, v_capacity using v_id;
  end if;
  ```
  Aplicar lo mismo en `project_catalog_sheet` (`100600:13, :19`), aunque ahí ya está detrás del chequeo de puente activo.

### I3. Condiciones no estándar: bloquean el admin legacy y el backfill las borra de la web
- **Archivos:** `20261114100600_erp_catalog_sheet_bridge.sql:84-85`, `20261114100500_erp_catalog_save_sheet.sql:20` y `scripts/erp-stage1-backfill-catalog-sheet.sql:16`
- **Problema (verificado con `condition = 'Usado - Excelente'`):**
  1. Con el puente activo, cualquier edición legacy de ese producto (incluso del precio) falla con `invalid storefront condition`. También fallaría el `update public.products set name=name` de `activate_storefront_bridge`.
  2. `save_catalog_product_sheet` copia `lower(...)` y rompe el check `products_condition_sheet_check`.
  3. El backfill en modo apply pone `condition = null` y el puente **proyecta NULL a `public.products.condition`**: la web pierde el dato sin aviso.
- **Fix:**
  - (a) En el trigger web→ERP no lanzar excepción: si el valor no está en `('nuevo','usado','reacondicionado')`, dejar `condition` del ERP en null y **no** marcar `sheet_fields_initialized = true` en esa fila, para que la proyección siga tomando el valor de `public`.
  - (b) En `save_catalog_product_sheet:20`, mapear los valores no reconocidos a null.
  - (c) En el backfill, agregar en dry-run un `select id, condition from public.products where condition is not null and lower(btrim(condition)) not in (...)`. En modo apply, **excluir** esas filas del `update` (que queden con `sheet_fields_initialized = false`) salvo que el usuario cargue una decisión explícita.

### I4. `get_catalog_product_variants(uuid)` cambia de comportamiento para la pantalla actual y devuelve precio 0 en productos inactivos
- **Archivo:** `supabase/migrations/20261114100900_erp_catalog_active_getter.sql:22, :73-76`
- **Problema:**
  - La firma de 1 argumento ahora oculta las variantes inactivas. La pantalla actual de variantes del ERP (`ProductVariantsModal`, que pausa y reactiva) deja de ver las pausadas.
  - Además, el `select base_sale_price … and (p_include_inactive or is_active)` hace que, en un producto inactivo, `v_parent_price` sea null y `effective_price_ars` de las variantes heredadas salga `0`.
- **Fix:**
  - Quitar `and (p_include_inactive or is_active)` del `select` del precio del padre (línea 22); el filtro sobre variantes se queda.
  - Dejar anotado en el contrato para la tarea 02 que el modal de variantes debe llamar con `p_include_inactive => true`.
  - Opcional: agregar una aserción pgTAP de que `(uuid, true)` devuelve las inactivas con el precio del padre.

### I5. Editar solo descripción o fotos de un producto legacy sin marca o categoría falla
- **Archivo:** `supabase/migrations/20261114100500_erp_catalog_save_sheet.sql:30-31`
- **Problema:** marca y categoría activas se exigen en **cada** guardado. Los productos importados sin marca (la mayoría de los accesorios) no pueden editar descripción ni fotos (`marca activa obligatoria`; verificado). El checklist de publicación ya exige marca.
- **Fix:** validar marca y categoría solo si `v_new or payload ? 'brand_id'` (respectivamente `'category_id'`). Si se mantiene la regla estricta, documentarla como contrato para que la tarea 02 obligue a elegir marca (o "Genérico") antes de cualquier guardado. Recomendado: lo primero.

### I6. Precios publicados con más de 2 decimales: el guard puede bloquear ediciones legacy sin aviso previo
- **Archivos:** `supabase/migrations/20261114100800_erp_catalog_published_price_guard.sql` y `scripts/erp-stage1-catalog-cleanup.sql`
- **Problema:** cualquier `UPDATE` que toque `base_sale_price` o las banderas de un producto publicado con 3 o 4 decimales falla. El trigger web→ERP siempre setea `base_sale_price`, así que **toda** edición legacy de ese producto falla. Ningún script reporta esos casos antes de aplicar la migración.
- **Fix:** agregar al dry-run del cleanup (o a un bloque previo del backfill) un reporte de `erp.products` publicados (`is_active and publish_on_web and allow_online_sale and can_sell`) con `base_sale_price <> round(base_sale_price,2)`, y de variantes activas con `final_price_ars <> round(final_price_ars,2)`. Documentar en el reporte que hay que corregirlos antes de aplicar la `100800`.

---

## MENORES

- **M1.** `20261114100200_…sql:6, :11`: el prefijo elimina letras acentuadas ("Cámaras y Cables" → `CMA`). Usar `translate(upper(name),'ÁÉÍÓÚÜÑ','AEIOUUN')` antes de `regexp_replace`.
- **M2.** `20261114100200_…sql:64-68`: "Genérico" se crea con código aleatorio `GENERICO-<uuid>`. En reset local no existe, porque la organización la crea `seed.sql` después de las migraciones. Con el puente activo se proyecta a `public.brands` (se ve en la web). Fix: código determinístico `'GENERICO'` (con `on conflict do nothing`) y agregar el mismo insert a `supabase/seed.sql`, que está permitido. Documentar que aparece en la tienda.
- **M3.** `20261114100600_…sql:53-60`: `erp.sync_erp_media_to_storefront()` no tiene `revoke` (ACL nula → PUBLIC). Agregar `revoke all on function erp.sync_erp_media_to_storefront() from public, anon, authenticated, service_role;`.
- **M4.** `20261114100500_…sql:38`: `condition` del payload no se normaliza. Usar `lower(btrim(...))` y validar con `22023` y un mensaje claro en lugar del check genérico 23514.
- **M5.** `20261114100500_…sql:42`: `array_agg(distinct …)` reordena los tags. Usar `array(select distinct on (lower(x)) btrim(x) … order by min(ordinality))` o conservar el orden de entrada.
- **M6.** `20261114100500_…sql:65, :68, :87`: el match `code = upper(btrim(item->>'code'))` no encuentra variantes legacy con código `WEB-<hex minúscula>`. Usar `upper(btrim(code)) = upper(btrim(item->>'code'))` en los dos lados, o priorizar `id`.
- **M7.** `20261114100500_…sql:16`: el conflicto de concurrencia usa `23514`, igual que los errores de validación. Usar `40001` o un `detail = 'concurrency_conflict'` distinguible. Documentar que `p_expected_updated_at` debe enviarse con el string exacto devuelto por la base (microsegundos; un `Date` de JS lo trunca y siempre daría conflicto).
- **M8.** `scripts/erp-stage1-catalog-cleanup.sql`:
  - El modo apply llama a `recode_catalog_product`, que exige `auth.uid()`, pero no hay forma de fijar el actor. Agregar `\set actor` + `select set_config('request.jwt.claim.sub', :'actor', true)` y abortar si `not erp.has_permission('catalog.manage')`.
  - El listado de candidatos por "primera palabra" genera un producto cartesiano enorme (todas las "Funda …"). Limitar a la misma categoría y la misma marca, y agregar similitud del resto del nombre.
- **M9.** `scripts/erp-stage1-backfill-catalog-sheet.sql:8-13`: el dry-run solo lista filas; no informa qué cambiaría. Agregar conteos (`productos con tags a copiar`, `condiciones/capacidades`, `medios a crear`) y la lista de medios a insertar.
- **M10.** Overlay `apps/erp/src/lib/supabase.ts`:
  - Falta sobrescribir `create_catalog_product_with_variants.Args.p_internal_code` como `string | null`, ahora que la RPC autogenera el código.
  - `unpublish_catalog_product.Returns.web_status` puede ser `"paused" | "draft"`.
  - Documentar que `publish_on_web = true` ya no significa "visible": la UI debe usar `web_status`.

---

## Notas fuera de los hallazgos (para el orquestador)

- **Brecha conocida y aceptable en construcción:** con el puente activo, el admin legacy puede republicar un producto pausado (`public.products.is_active = true`) sin pasar el checklist. Verificado. Queda para el corte.
- `publish_catalog_product` también setea `can_sell = true`: un producto que estaba marcado como no vendible pasa a vendible en POS al publicarlo. Confirmarlo con el usuario.
- `20261114100400_erp_catalog_compatibility_history.sql` no lo pedía el brief: cambia el borrado de compatibilidades por baja lógica. Es correcto y su test pasa, pero el embebido directo de `product_compatible_models` (`ProductDetailModal`, si algún día se usa) tiene que filtrar `is_active`.
- Durante la ventana de Codex (17:56–18:24) cambiaron archivos prohibidos para esa tarea: `src/components/admin/{Banner,Blog,Case,Smartphone,VariantManagement,UnifiedInventory}.tsx`, `src/pages/Admin.tsx`, `src/lib/image-upload.ts` (nuevo), `scripts/optimize-existing-images.mjs`, `package.json`, `package-lock.json` y `.gitignore`, todos alrededor de las 18:13–18:19. Los logs de Codex no muestran escrituras a esos archivos; parece trabajo paralelo del usuario u otro agente, pero conviene confirmarlo.
- No se editó ninguna migración anterior a `20261114`: sin `M` en `supabase/migrations` y mtimes previos intactos.
