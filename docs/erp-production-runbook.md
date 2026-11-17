# Runbook de producción: unificación Admin → ERP

> Redactado el 17/11/2026 por el auditor final de la orquestación (rama `plan/auditoria-adia`, sin commits).
> **Producción = proyecto Supabase `qatkzvlomuaoaxlfgjfa`** (sa-east-1). El ref viejo `tuzpcofywkhglkqplhnn` ya no es producción.
> Nada de este runbook fue ejecutado contra producción. Todo se ensayó en PostgreSQL 18 local sobre una copia del esquema y los datos de prod (`A:\_pg_agy_21`, ver §11).
>
> Convención: **[IRREVERSIBLE]** = no hay vuelta atrás sin restaurar el respaldo (con pérdida de lo escrito después). **[REVERSIBLE]** = tiene paso de rollback documentado.

## 0. Antes de empezar

### 0.1 Seguridad inmediata (hallazgo H1, hacer YA, no espera a la ventana)

1. Dashboard de `qatkzvlomuaoaxlfgjfa` → Authentication → Sign In / Providers → desactivar **"Allow new users to sign up"**. [REVERSIBLE]
   - Motivo: en prod, el trigger `erp_profile_on_auth_user_created` le da rol **owner** del ERP a todo usuario nuevo. Con el signup abierto, cualquiera con la anon key obtiene acceso total al ERP.
   - Después de las migraciones (H1 corregido en `20261114350100`), un usuario nuevo recibe un **perfil activo sin roles**. Ese perfil igual puede leer la organización, las sucursales, las ubicaciones y `system_settings` (R-2). Por eso **el signup queda apagado de forma permanente**: los usuarios se crean por invitación.
2. Revisar quién tiene roles hoy (SQL Editor, solo lectura):
   ```sql
   select pr.profile_id, u.email, r.code, pr.valid_from, pr.valid_until
   from erp.profile_roles pr
   join erp.roles r on r.id = pr.role_id
   join auth.users u on u.id = pr.profile_id
   order by pr.valid_from;
   ```
   Si hay owners que no son del negocio, cerrarlos sin borrar historia: [REVERSIBLE, se revierte con `valid_until = null`]
   ```sql
   update erp.profile_roles set valid_until = now()
   where profile_id = '<UUID_NO_LEGITIMO>' and (valid_until is null or valid_until > now());
   update erp.profiles set is_active = false where id = '<UUID_NO_LEGITIMO>';
   ```

### 0.2 Prerrequisitos

- [ ] **Ventana:** de baja actividad (de noche), de 60 a 90 minutos para los pasos 1 a 6. Los cortes (§7) van en días separados.
- [ ] **CLI:** logueada en la cuenta nueva (`nictech.sistemas`), con la contraseña de la base de prod a mano. No se pega en archivos ni en chats.
- [ ] **Enlace del repo:** el repo está enlazado a prod. Antes de cualquier comando `db`, verificar:
  ```bash
  cat supabase/.temp/project-ref      # debe imprimir exactamente: qatkzvlomuaoaxlfgjfa
  ```
  `supabase db push`, `db dump` y `migration list` **no aceptan `--project-ref`**. Se usa `--linked` después de esa verificación, o `--db-url "$PROD_DB_URL"` con la variable exportada solo en la sesión.
- [ ] **Código a desplegar:**
  - Commiteado y revisado. Hoy hay 76 archivos modificados y 115 sin trackear, de dos orquestaciones.
  - Mergeado a `main` **sin desplegar todavía la tienda**: Vercel despliega `main` solo. Si eso no se puede separar, mergear a `main` recién en el §6.
- [ ] **Admins legacy:** todo admin que use `/admin` debe tener `app_metadata.role = 'admin'`. La migración `20261116800000` restringe las escrituras legacy a ese criterio, que es el mismo de `ProtectedRoute`.
  ```sql
  select count(*) filter (where raw_app_meta_data->>'role' = 'admin') as admins_legacy, count(*) as usuarios
  from auth.users;
  ```
- [ ] **Imágenes:** las URLs de imágenes de la base de prod (41 en `public.products`, 230 en `erp.products`, 277 en `erp.product_variants` y 4 en banners/blog) todavía apuntan a `tuzpcofywkhglkqplhnn.supabase.co`. **No pausar ni borrar el proyecto viejo** hasta verificar que todas las imágenes cargan desde el host nuevo y que los objetos existen en Storage del proyecto nuevo (§4.1).
- [ ] **Seguimiento roto (hallazgo nuevo):** en el respaldo de prod, `public.get_repair_by_tracking_code` falla con `42804`. La columna `public.repairs.status` es `text` y la función declara `status repair_status`. `/seguimiento` probablemente esté roto hoy en prod. La migración #24 corrige el RPC legacy; en el respaldo todos los estados entran en el enum (0 fuera y 0 nulos). Después de aplicarla, probar con un código real (§4).

## 1. Respaldo

**Obligatorio; sin respaldo no se sigue.**

```bash
mkdir -p A:/nictech-backup/$(date +%Y%m%d)-pre-erp && cd A:/nictech-backup/$(date +%Y%m%d)-pre-erp
cat A:/nictech/supabase/.temp/project-ref                     # qatkzvlomuaoaxlfgjfa
npx supabase db dump --linked --role-only -f roles.sql      --workdir A:/nictech
npx supabase db dump --linked             -f schema.sql     --workdir A:/nictech
npx supabase db dump --linked --data-only --use-copy -f data.sql --workdir A:/nictech
# Fuentes desplegadas de las funciones (para el rollback del §5)
for f in create-mercadopago-preference mercadopago-webhook mp-webhook; do
  npx supabase functions download $f --project-ref qatkzvlomuaoaxlfgjfa --workdir A:/nictech
done
```

Guardar además, desde el SQL Editor, las definiciones actuales de las políticas que se van a tocar:

```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by 1, 2, 3;
```

Guardar el resultado como `policies-pre.csv`.

- Si el plan de Supabase tiene PITR o backups diarios, anotar la hora exacta del respaldo.
- `data.sql` tiene datos personales: queda solo en el disco del usuario.

## 2. Chequeos previos (solo lectura)

```bash
npx supabase migration list --linked
```

Esperado: 99 aplicadas, hasta `20261022001512`, y las 24 de §3 como pendientes (solo locales).

**Si aparece cualquier otra diferencia, PARAR.**

Con la URL de la base exportada solo en la sesión (`$PROD_DB_URL`), correr los scripts de solo lectura. Todos terminan en `ROLLBACK`:

```bash
psql "$PROD_DB_URL" -X -f scripts/check-erp-catalog-baseline.sql
psql "$PROD_DB_URL" -X -f scripts/erp-stage2-price-comparison.sql
psql "$PROD_DB_URL" -X -f scripts/erp-stage1-catalog-cleanup.sql
```

`erp-stage1-catalog-cleanup.sql` corre en dry-run por defecto.

Condición para seguir: las dos consultas "Correct these published prices before applying migration 20261114100800" devuelven **0 filas**. En la copia local dieron 0.

## 3. Migraciones

**[IRREVERSIBLE]**

**Orden exacto: el de los nombres; `db push` las aplica en ese orden.** Son 24. Ninguna está en prod.

| # | Migración | Qué cambia en prod al aplicarse |
|---|---|---|
| 1 | `20261114100000_erp_catalog_draft_and_price` | Borrador de catálogo y precio por variante (ERP) |
| 2 | `20261114100100_erp_catalog_sheet_columns` | Columnas nuevas de la ficha |
| 3 | `20261114100200_erp_catalog_media_codes` | Media y contadores de códigos |
| 4 | `20261114100300_erp_catalog_publication` | Reglas de publicación |
| 5 | `20261114100400_erp_catalog_compatibility_history` | Historial de compatibilidad |
| 6 | `20261114100500_erp_catalog_save_sheet` | RPC `save_catalog_product_sheet` |
| 7 | `20261114100600_erp_catalog_sheet_bridge` | Puente de la ficha hacia `public` |
| 8 | `20261114100700_erp_catalog_colors_active_views` | Colores y vistas de activos |
| 9 | `20261114100800_erp_catalog_published_price_guard` | Guard: precio publicado con 2 decimales como máximo (requiere §2) |
| 10 | `20261114100900_erp_catalog_active_getter` | Getter de catálogo activo |
| 11 | `20261114200000_erp_repair_public_stages` | Etapas públicas de reparación (+2 estados y +4 transiciones) |
| 12 | `20261114200100_erp_repair_public_tracking` | Código `XXXX-XXXX`, rate limit y `get_repair_by_tracking_code_erp` (todavía sin uso) |
| 13 | `20261114300000_erp_unified_price` | **Precio único:** `resolve_catalog_effective_price_internal`, `public.product_variants.price` y triggers |
| 14 | `20261114350000_erp_sheet_stock_and_auth_hardening` | ACL `anon` (H5) y ficha con stock inicial |
| 15 | `20261114350100_erp_auth_no_automatic_roles` | **H1:** sin owner automático; `bootstrap_first_owner` (solo `service_role`) |
| 16 | `20261114350200_erp_sheet_stock` | Stock inicial por color |
| 17 | `20261114400000_erp_promotions` | Promos ERP, vista `public.storefront_promotion_prices` y `public.storefront_web_price` |
| 18 | `20261114500000_erp_cutover_flags` | Banderas de corte; las 5 en `off` |
| 19 | `20261114500100_erp_legacy_write_canaries` | Canarios en `public.*`; en `off` solo hacen una lectura por PK |
| 20 | `20261114500200_erp_role_web_content` | Rol `web_content` (sin permisos todavía) |
| 21 | `20261116600000_erp_role_assignment` | RPC `assign_profile_role`; revoca insert/update directo en `profile_roles` |
| 22 | `20261116700000_erp_webhook_fulfillment_fix` | `process_mercadopago_payment` asienta el pedido web (venta, stock, asiento); `pricing_version` v2 |
| 23 | `20261116800000_legacy_public_rls_admin_only` | **RLS legacy solo admin (27 políticas)** y Storage: sin escritura `anon` en `product_images`; subida ERP en `product_images/erp/*` con `catalog.manage` |
| 24 | `20261117100000_legacy_tracking_status_cast` | Corrige el error `42804` del RPC legacy mediante cast de `repairs.status` a `repair_status`; no reemplaza el adaptador ERP si el corte de Etapa 6 está activo. |

```bash
cat supabase/.temp/project-ref                 # qatkzvlomuaoaxlfgjfa
npx supabase db push --linked --dry-run        # debe listar exactamente las 24 de arriba
npx supabase db push --linked                  # [IRREVERSIBLE]
npx supabase migration list --linked           # 123 aplicadas, última 20261117100000
```

Notas:

- **Todo o nada.** `db push` aplica cada migración en su transacción. Si una falla, las anteriores quedan aplicadas y las siguientes no.
  - No reintentar a ciegas: leer el error, corregir **la migración que falló** (todavía no está aplicada) y volver a hacer `push`.
  - No editar migraciones ya aplicadas.
- **Riesgo conocido en la #23:**
  - La parte de `storage.objects` (ALTER/DROP POLICY) **no se pudo ejecutar en local**: no hay esquema `storage`.
  - Si falla por permisos (el dueño de `storage.objects` es `supabase_storage_admin`), el plan B es:
    1. Quitar de la #23 el bloque `do $$ … storage.objects … $$`.
    2. Hacer `push`.
    3. Aplicar esas 4 sentencias de políticas desde el SQL Editor del Dashboard, que corre como `postgres`.
- **Funciones viejas contra el esquema nuevo:** entre este paso y el 4, las funciones viejas siguen corriendo.
  - Firma de `process_mercadopago_payment`: idéntica a la vieja.
  - La función de preferencia vieja lee `public.products`.
  - Es compatible por unos minutos, pero no hay que demorar el §5.
- **Rollback de §3:** no hay migraciones *down*.
  - Ante un problema grave: restaurar el respaldo del §1 (se pierde lo escrito después).
  - Si no, hacer *forward fix* con una migración nueva.

## 4. Verificación inmediata después de las migraciones (SQL Editor, solo lectura)

```sql
-- Banderas: 5 grupos en off / visibles
select group_code, legacy_write_mode, admin_tab_hidden from erp.storefront_cutover_groups order by 1;
-- Canarios sin eventos
select count(*) from erp.legacy_write_canary_events;
-- RLS legacy: ninguna política de public sigue usando auth.role() = 'authenticated'
select tablename, policyname from pg_policies
where schemaname = 'public' and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%auth.role()%authenticated%';   -- 0 filas
-- Storage: sin políticas de escritura/borrado para anon en product_images
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'storage' and tablename = 'objects' order by policyname;
--   no deben existir "...1uh8lhk_1", "_2", "_3"; "Allow Upload" exige is_legacy_admin() o erp/* + catalog.manage
-- anon no ejecuta nada de erp.*
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'erp' and has_function_privilege('anon', p.oid, 'execute');   -- 0
-- La vista de precios de la tienda funciona como anon
begin; set local role anon; select count(*) from public.storefront_promotion_prices; rollback;
-- Un usuario autenticado NO admin no ve pedidos legacy
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select count(*) from public.orders;      -- 0
rollback;
```

Prueba funcional de Storage con la anon key (publishable). Esperado: **400/403** en ambas:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://qatkzvlomuaoaxlfgjfa.supabase.co/storage/v1/object/product_images/1uh8lhk/prueba-anon.txt" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: text/plain" --data "x"
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  "https://qatkzvlomuaoaxlfgjfa.supabase.co/storage/v1/object/product_images/1uh8lhk/prueba-anon.txt" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

- Si el POST devuelve 200, la política sigue abierta: borrar ese archivo desde el Dashboard y revisar §3 (plan B).
- [REVERSIBLE: solo lectura] Consultar `/seguimiento` con un **código real de prueba** tras aplicar la #24: debe mostrar la reparación y sus notas públicas sin error `42804`. Verificar también la tienda y `/admin` como admin legacy.

## 4.1 Reescritura de URLs de imágenes

Ejecutar **después de las migraciones y antes de los cortes de catálogo (§7.1)**, con el respaldo de §1 y la conexión de producción verificada. No copia objetos: solo cambia referencias del host `tuzpcofywkhglkqplhnn` a `qatkzvlomuaoaxlfgjfa`.

1. **Dry-run [REVERSIBLE: transacción con ROLLBACK]:** como `postgres`, revisar los conteos y el aviso de objetos faltantes. Se esperan **552 valores** según el ensayo; si difieren, investigar antes de aplicar.
   ```bash
   psql "$PROD_DB_URL" -X -f scripts/rewrite-legacy-storage-host.sql
   ```
2. **Apply [REVERSIBLE: rollback debajo]:** solo con el dry-run conciliado.
   ```bash
   psql "$PROD_DB_URL" -X -v apply=true -f scripts/rewrite-legacy-storage-host.sql
   ```
   El log `erp.cutover_storage_host_log` guarda los valores anteriores. Los triggers agregaron aproximadamente **507 eventos de auditoría** en el ensayo; están aceptados. No se modifican ni borran eventos anteriores.
3. **Verificación [REVERSIBLE: solo lectura]:** repetir el dry-run: debe encontrar **0 candidatos**. Consultar en el proyecto nuevo los objetos referenciados por el lote activo; esperado: `faltantes = 0` y `sin_ruta_publica = 0`. La comprobación del script sobre `storage.objects` usa esta misma relación bucket/ruta; Storage no se pudo verificar localmente.
   ```sql
   with urls as (
     select a.value #>> '{}' as url
     from erp.cutover_storage_host_log l
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(l.new_value) = 'array' then l.new_value
            else jsonb_build_array(l.new_value) end
     ) a(value)
     where l.rolled_back_at is null
   ), paths as (
     select url, regexp_match(url, '^https://qatkzvlomuaoaxlfgjfa[.]supabase[.]co/storage/v1/object/public/([^/]+)/(.+)$') as parts
     from urls
     where url like 'https://qatkzvlomuaoaxlfgjfa.supabase.co/%'
   )
   select count(*) as urls, count(*) filter (where parts is null) as sin_ruta_publica,
          count(*) filter (where parts is not null and not exists (
            select 1 from storage.objects o where o.bucket_id = parts[1] and o.name = parts[2]
          )) as faltantes
   from paths;
   ```
   Comprobar además que **todas las imágenes cargan desde el host nuevo** en tienda, ERP, banners y blog. Si faltan objetos, copiarlos y volver a verificar antes de continuar. **NO pausar ni borrar el proyecto viejo** hasta confirmar tanto la carga de todas las imágenes como la existencia de los objetos en Storage del proyecto nuevo.
4. **Rollback [REVERSIBLE de las URLs; los eventos de auditoría nuevos permanecen]:** si la verificación falla, revisar primero el dry-run del rollback y luego aplicarlo; restaura los valores registrados y valida la conciliación.
   ```bash
   psql "$PROD_DB_URL" -X -f scripts/rewrite-legacy-storage-host-rollback.sql
   psql "$PROD_DB_URL" -X -v apply=true -f scripts/rewrite-legacy-storage-host-rollback.sql
   ```

## 5. Edge Functions

**[REVERSIBLE]: se redepliega la versión bajada en §1.**

**Orden: siempre DESPUÉS de §3.**
- `create-mercadopago-preference` llama a `erp.resolve_catalog_effective_price_internal`, que crean las migraciones #13 y #17. Si se despliega antes, el checkout queda caído (falla cerrada, 5xx).
- El webhook manda `p_customer_id = null` y depende de la #22 para asentar el pedido.

1. Secrets (ya existen 9 en prod; revisar sin imprimir valores):
   ```bash
   npx supabase secrets list --project-ref qatkzvlomuaoaxlfgjfa
   ```
   - Requeridos por el código nuevo:
     - `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` y `MERCADOPAGO_NOTIFICATION_URL`.
     - `STOREFRONT_ALLOWED_ORIGINS`.
     - `ERP_ORGANIZATION_ID`, `ERP_BRANCH_ID`, `ERP_STOREFRONT_LOCATION_ID`, `ERP_STORE_EXCHANGE_SNAPSHOT_ID` y `ERP_MERCADOPAGO_PAYMENT_METHOD_ID`.
     - `RESEND_API_KEY` es opcional.
   - `ERP_STOREFRONT_CUSTOMER_ID` ya no se usa.
   - Nuevo: `ERP_CHECKOUT_PAUSED` (`true` responde 503 en preferencia y webhook). Dejarlo explícito en `false`:
     ```bash
     npx supabase secrets set ERP_CHECKOUT_PAUSED=false --project-ref qatkzvlomuaoaxlfgjfa
     ```
2. Deploy, en este orden:
   ```bash
   npx supabase functions deploy mercadopago-webhook            --project-ref qatkzvlomuaoaxlfgjfa
   npx supabase functions deploy mp-webhook                     --project-ref qatkzvlomuaoaxlfgjfa   # alias histórico (config.toml)
   npx supabase functions deploy create-mercadopago-preference  --project-ref qatkzvlomuaoaxlfgjfa
   ```
   - Los webhooks llevan `verify_jwt = false` desde `config.toml`; confirmarlo en el Dashboard después del deploy.
   - `get-dollar-rate` no cambió: no se redepliega.
3. **Rollback:**
   ```bash
   npx supabase functions deploy <nombre> --project-ref qatkzvlomuaoaxlfgjfa
   ```
   Correrlo desde el directorio con la fuente bajada en §1. El webhook viejo es compatible con la RPC nueva.

## 6. Frontends, primer owner y roles

1. **Tienda (Vercel, `main`):** mergear o desplegar recién ahora. Si la vista de promos falla, la tienda cae al precio legacy (falla abierta), y el servidor sigue siendo la autoridad: devuelve 409 si el precio cambió. [REVERSIBLE: *Instant Rollback* de Vercel]
2. **ERP (escritorio/Docker):** compilar con `VITE_SUPABASE_URL=https://qatkzvlomuaoaxlfgjfa.supabase.co` y la publishable key de prod:
   - Escritorio: `npm run build:erp:electron` y publicar con `npm run release:erp`.
   - Docker: `ERP_SUPABASE_URL` y `ERP_SUPABASE_PUBLISHABLE_KEY` en `.env`.
3. **Primer owner:**
   - **Solo si la organización no tiene ningún rol vigente.** Si en §0.1 quedó al menos un owner legítimo, se saltea: `bootstrap_first_owner` falla con `55000` si ya hay asignaciones.
   - El perfil tiene que existir y estar activo (se crea al invitar al usuario desde Authentication → Users → Invite).
   ```sql
   -- SQL Editor (postgres), simulando service_role
   begin;
   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
   set local role service_role;
   select erp.bootstrap_first_owner('<UUID_DEL_DUEÑO>');
   commit;
   ```
4. **Resto de los roles:** desde el ERP → Sistema → Usuarios (`assign_profile_role`; exige `users.manage` y ser owner o admin).
   - Nadie puede cambiarse su propio rol.
   - Al reasignar, se vencen todas las asignaciones vigentes del perfil, incluidas las de sucursal (R-3).
   - El rol `admin` no está sembrado: el único administrador global es owner.
5. **Perfil de módulos del ERP (F-5):** sin configuración, el ERP arranca en perfil `salida` y oculta compras, finanzas, etc. Elegir el perfil en Configuración → Navegación.
6. **Regenerar tipos y commitear:**
   ```bash
   npx supabase gen types typescript --project-id qatkzvlomuaoaxlfgjfa --schema public > src/integrations/supabase/types.ts
   npx supabase gen types typescript --project-id qatkzvlomuaoaxlfgjfa --schema erp    > apps/erp/src/types/supabase.ts
   npm run typecheck:erp && npx tsc --noEmit -p tsconfig.app.json && npm run build && npm run build:erp
   ```
   - Después se pueden reducir los overlays: `apps/erp/src/lib/supabase.ts` y `src/integrations/supabase/types.extensions.ts`.
   - En la tienda, la referencia de `tsc` es de 95 errores legacy, que no deben aumentar.

## 7. Cortes por etapa

Todos son [REVERSIBLE]. **Cada corte es una decisión del usuario, en días separados.**

### 7.0 Mecánica común

**Cambiar una bandera.** Lo hace un owner con `configuration.manage`, desde el SQL Editor:

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub','<UUID_OWNER>','role','authenticated')::text, true);
set local role authenticated;
select erp.set_storefront_cutover_group('<grupo>', <admin_tab_hidden>, '<off|observe|block>', '<motivo>');
commit;
```

- Grupos: `catalog`, `stock`, `prices_promos`, `repairs`, `dashboard`.
- Cada cambio queda auditado.

**Modos:**
- `off`: no hace nada.
- `observe`: registra en `erp.legacy_write_canary_events` cada escritura legacy.
- `block`: rechaza la escritura legacy con `42501` ("Este dato se gestiona desde el ERP").

**Canario (cuántas escrituras legacy hubo):**

```sql
select group_code, table_name, operation, count(*), max(created_at)
from erp.legacy_write_canary_events where created_at > now() - interval '7 days'
group by 1, 2, 3 order by 1;
```

**Conciliación:** antes y después de cada corte.

```bash
psql "$PROD_DB_URL" -X -f scripts/erp-cutover-reconciliation.sql
```

Es solo lectura: no muestra datos personales, solo conteos y hasta 20 ejemplos por categoría.

**Secuencia por grupo:**
1. Conciliación.
2. `observe` (`admin_tab_hidden=false`) durante el período de prueba. Con el canario en 0 escrituras legítimas, se sigue.
3. `block` con `admin_tab_hidden=true`: el admin oculta la pestaña (falla abierta; la seguridad está en la base).
4. Conciliación.

**Rollback:** `set_storefront_cutover_group('<grupo>', false, 'off', 'rollback: <motivo>')`.

### 7.1 Catálogo (Etapa 1)

- Precondición: la ficha del ERP en uso.
- Opcional, si el usuario decide limpiar el catálogo:
  ```bash
  psql "$PROD_DB_URL" -X -f scripts/erp-stage1-backfill-catalog-sheet.sql            # dry-run
  psql "$PROD_DB_URL" -X -v apply=true -f scripts/erp-stage1-backfill-catalog-sheet.sql    # [IRREVERSIBLE sin respaldo]
  psql "$PROD_DB_URL" -X -v apply=true -v actor=<UUID catalog.manage> -f scripts/erp-stage1-catalog-cleanup.sql   # solo con decisiones cargadas
  ```
- Bandera `catalog`: `observe` → `block`.

### 7.2 Precio único (Etapa 2)

- Queda activo con §3 + §5; no tiene bandera propia.
- Verificar:
  ```bash
  psql "$PROD_DB_URL" -X -f scripts/erp-stage2-price-comparison.sql
  ```
  Esperado: 0 diferencias, como en la copia local.
- **Nota P-5:** el resolver elige el canal por `auth.role()`: `service_role` cobra precio **web** y cualquier otro rol, **POS**. Ningún proceso de mostrador puede correr con `service_role`.

### 7.3 Stock (Etapa 3)

- Precondición: piloto de stock y venta rápida en el ERP.
- Bandera `stock`: `observe` → `block`.

### 7.4 Promos (Etapa 4)

**Orden obligatorio:**
1. **Antes del apply**, poner `prices_promos` en **`block`**. Sin eso, el puente legacy puede pisar `erp.products.base_sale_price`.
2. Pausar el checkout:
   ```bash
   npx supabase secrets set ERP_CHECKOUT_PAUSED=true --project-ref qatkzvlomuaoaxlfgjfa
   ```
3. Correr el corte:
   ```bash
   psql "$PROD_DB_URL" -X -f scripts/cutover/stage4-promotions-cutover.sql                 # dry-run: revisar migrables/invertidas
   psql "$PROD_DB_URL" -X -v apply=true -f scripts/cutover/stage4-promotions-cutover.sql   # COMMIT solo si concilia
   psql "$PROD_DB_URL" -X -f scripts/erp-cutover-reconciliation.sql
   ```
4. Reanudar el checkout:
   ```bash
   npx supabase secrets set ERP_CHECKOUT_PAUSED=false --project-ref qatkzvlomuaoaxlfgjfa
   ```

En la copia local: 7 promos migradas y 1 invertida (Motorola G23) que **no** se migra. Su `original_price` se limpia a mano. Los 34 `CYBERMONDAY` restantes quedan para el saneamiento F4.

**Rollback:** checkout pausado y después:

```bash
psql "$PROD_DB_URL" -X -v apply=true -f scripts/cutover/stage4-promotions-rollback.sql
```

- Desactiva las promos sin borrarlas y restaura `base_sale_price` y los tags desde `erp.cutover_promotions_log`.
- Después, `prices_promos` → `off`.
- Probado en local: aplicar, revertir y volver a conciliar dan OK.

### 7.5 Reparaciones (Etapa 6)

- Precondición (D5): no quedan reparaciones vigentes en `public.repairs` sin cargar en el ERP. Después del corte, `/seguimiento` lee solo `erp.repair_orders`.
- Corte:
  ```bash
  psql "$PROD_DB_URL" -X -f scripts/cutover/stage6-repairs-tracking-switch.sql                 # dry-run
  psql "$PROD_DB_URL" -X -v apply=true -f scripts/cutover/stage6-repairs-tracking-switch.sql   # guarda respaldo en erp.cutover_function_backups
  ```
- Bandera `repairs`: `observe` → `block`.
- **Rollback:**
  ```bash
  psql "$PROD_DB_URL" -X -v apply=true -f scripts/cutover/stage6-repairs-tracking-rollback.sql
  ```
  - Restaura la definición previa, idéntica a la original.
  - **Ojo:** la definición previa debe ser la corregida por la migración #24; si se omitió o se activó el corte antes de aplicarla, verificar el RPC restaurado y probar `/seguimiento` (§4).

### 7.6 Dashboard (Etapa 7)

Último paso, cuando todos los demás grupos están en `block`. Bandera `dashboard`. Banners y blog no se apagan.

## 8. Verificación de pedidos web y webhook (después del §5 y en cada corte)

Después del primer pago aprobado real (o de una compra de prueba de bajo monto que decida el usuario):

```sql
-- Pedidos aprobados desde el despliegue sin asentar en el ERP: debe ser 0
select count(*) from public.orders o
where o.status = 'approved' and o.created_at > '<HORA_DEL_PASO_5>'
  and not exists (select 1 from erp.storefront_payment_syncs s where s.storefront_order_id = o.id);
-- Asentamiento completo (venta, documento de stock, asiento)
select processed_at, sale_id is not null as venta, stock_document_id is not null as stock,
       journal_entry_id is not null as asiento
from erp.storefront_payment_syncs order by processed_at desc limit 5;
```

- Revisar los logs de las funciones en el Dashboard: no tiene que haber 5xx repetidos.
- Un pago aprobado que llega antes de activar el ERP queda "requiere conciliación manual"; es esperado.
- Dos pagos aprobados distintos para el mismo checkout fallan por clave `storefront:<id>`: conciliación manual.

## 9. Resumen de reversibilidad

| Paso | Tipo | Cómo se revierte |
|---|---|---|
| 0.1 signup off / cerrar owners | REVERSIBLE | Dashboard / `valid_until = null` |
| 1 respaldo | — | — |
| 3 migraciones | **IRREVERSIBLE** | Restaurar respaldo §1 o *forward fix* |
| 4.1 reescritura de URLs | REVERSIBLE | `rewrite-legacy-storage-host-rollback.sql`; conserva los eventos de auditoría nuevos |
| 5 funciones | REVERSIBLE | Redeploy de la fuente bajada |
| 6 frontends | REVERSIBLE | Vercel Instant Rollback / build anterior |
| 6 bootstrap y roles | REVERSIBLE | `assign_profile_role` / `valid_until` |
| 7.1 backfill/cleanup apply | **IRREVERSIBLE** (sin respaldo) | Respaldo §1 |
| 7.x banderas | REVERSIBLE | Bandera a `off` |
| 7.4 corte promos | REVERSIBLE | `stage4-promotions-rollback.sql` |
| 7.5 corte seguimiento | REVERSIBLE | `stage6-repairs-tracking-rollback.sql` |
| `scripts/fix-adia-audit-catalog.sql` (otra orquestación) | **IRREVERSIBLE**: commitea sin dry-run | Correrlo solo dentro de su plan, con respaldo |

## 10. Lo que este runbook no cubre

Son decisiones abiertas del plan (§5):
- Las 494 unidades en productos desactivados.
- Promos sin fin.
- Una o dos sucursales.
- Los costos de los 41 productos.
- USD (Etapa 4, parte dólar).
- Multimodelo (Etapa 5).

## 11. Evidencia del ensayo local (16/11/2026, `A:\_pg_agy_21`)

**pgTAP, 44 archivos, 1885/1885 en las dos bases, `notok=0` y `errors=0`:**
- `clean`: 122 migraciones + seed.
- `prodlike`: esquema de prod + 23 nuevas.
- Incluye 3 archivos de humo con `PASS`. Dos de ellos saltean un subcaso por falta de un perfil sin permiso.

**`proddata` (datos reales, solo conteos):** las 23 migraciones aplicaron sin errores. Diferencias de filas, todas esperadas:
- Marca Genérico: +1 en `erp.brands` y +1 en `public.brands`.
- `audit_events`: +34.
- `repair_statuses`: +2; `repair_status_transitions`: +4.
- `roles`: +1 (`web_content`).
- `storefront_cutover_groups`: 5; `repair_tracking_rate_config`: 1.
- 12 tablas nuevas vacías.

**Scripts en dry-run:** todos con exit 0. Los rollbacks sin corte previo abortan a propósito con su guard.

**Simulación de un día con todo en `off`:** precio, stock y descripción editados en `public.products` se proyectan al ERP y a la vista; la reparación legacy se inserta y quedan 0 canarios.

**Cortes simulados:** en catálogo, `prices_promos` (con el apply y el rollback del Stage 4), reparaciones (con el switch y el rollback del Stage 6) y stock, `observe` registra el canario, `block` rechaza con `42501` y `off` vuelve atrás. Todo OK.

**No ensayado:** `storage.objects` (no existe en local) y la interacción real con MercadoPago (solo pgTAP del flujo e2e, 53/53).
