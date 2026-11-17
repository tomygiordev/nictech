# Ejecución en producción ERP — 17/11/2026

Objetivo: ejecutar `docs/erp-production-runbook.md` contra `qatkzvlomuaoaxlfgjfa`.
Sin commits. Sin datos personales ni secretos en este registro.

## Entorno y convenciones

- Supabase CLI 2.117.0. Todo comando `supabase`/`docker` se corrió como
  `env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u DOCKER_HOST npx supabase ...`.
  - El shell tiene `SUPABASE_PROJECT_REF=tuzpcofywkhglkqplhnn` (proyecto viejo) y `DOCKER_HOST=tcp://127.0.0.1:2375`
    (Docker Desktop no expone TCP; funciona por named pipe). Se inició Docker Desktop (estaba detenido).
- No hay `$PROD_DB_URL` (contraseña de la base no disponible). Los scripts SQL se corrieron vía Management API
  (`supabase db query --linked -f`), como `postgres`, después de convertirlos a SQL plano con un conversor
  (`\if :apply` / `\echo` / `RAISE NOTICE` → log en tabla temporal devuelto como resultado). Las ramas
  `apply=false` terminan en `ROLLBACK` igual que en psql.
- Antes de cada paso irreversible se verificó `projects list`: `qatkzvlomuaoaxlfgjfa linked=true`.

### Intento previo (16:01–16:05), descartado

La credencial guardada de la CLI era de la cuenta vieja: `db dump` dio 403 y las 5 lecturas de 16:03 fueron
probablemente contra el proyecto viejo (`SUPABASE_PROJECT_REF`). Se descartaron. El usuario se re-logueó y se
rehízo todo desde §1.

## §0 / §2 Chequeos previos (prod, solo lectura)

| Chequeo | Resultado |
|---|---|
| Migraciones aplicadas | 99, última `20261022001512` |
| Precios publicados con más de 2 decimales (producto / variante) | 0 / 0 |
| `auth.users` | 5 usuarios, 2 con `app_metadata.role='admin'` |
| `erp.profile_roles` vigentes | 5 `owner` (todos los usuarios; consecuencia de H1) — **no se cerró ninguno: decisión del usuario** |
| Políticas `public`/`storage` | 55 (guardadas en `policies-pre.json`) |
| URLs de imágenes en el dump pre-migración | 0 con host viejo; todas ya en `qatkzvlomuaoaxlfgjfa` |
| Sonda de permisos Storage (txn con ROLLBACK) | `ALTER POLICY ... RENAME` → 42501; `ALTER POLICY ... USING/WITH CHECK` y `DROP POLICY` → OK (los que usa la #23) |

## §1 Respaldo — `A:\nictech-backup\20261117-1601-pre-erp\` (hora del respaldo: 16:10–16:16 -03)

| Archivo | Tamaño | Validación |
|---|---|---|
| `roles.sql` | 370 B | 3 `CREATE/ALTER ROLE`, 0 contraseñas |
| `schema.sql` | 1.634.791 B | 196 `CREATE TABLE`, 241 `CREATE POLICY` |
| `data.sql` | 3.958.541 B | 231 `COPY` (incluye `auth.users`, `erp.products`, `public.orders`, `public.repairs`…), termina en `RESET ALL` |
| `policies-pre.json` | 15.663 B | 55 políticas |
| `functions-src/` | — | fuentes desplegadas de `create-mercadopago-preference`, `mercadopago-webhook`, `mp-webhook` (rollback §5) |
| `types-regenerated/` | — | tipos ERP regenerados (no instalados) y tipos públicos originales |

Primer intento de `data.sql` falló (`28P01`): consultas concurrentes re-inicializaron el login temporal. Reintento solo: OK.
`data.sql` contiene datos personales: queda solo en el disco del usuario.

## §3 Migraciones — 16:16:43 a 16:16:55

- `db push --linked --dry-run`: exactamente las 24 (`20261114100000` … `20261117100000`), `seeds: []`.
- `db push --linked --yes`: exit 0, 0 errores, 0 avisos. Plan B de la #23 no fue necesario.
- Después: 123 aplicadas, última `20261117100000`.

## §4 Verificación post-migración (resultados reales)

| Verificación | Resultado |
|---|---|
| Banderas | 5 grupos en `off`, `admin_tab_hidden=false` |
| Canarios | 0 |
| Políticas `public` con `auth.role()='authenticated'` | 0 |
| Storage `objects` | sin `1uh8lhk_1/_2/_3`; blog upload/update/delete con `is_legacy_admin()`; `Allow Upload` exige `is_legacy_admin()` o `erp/*` + `catalog.manage` |
| Funciones `erp.*` ejecutables por `anon` | 0 |
| `public.storefront_promotion_prices` como `anon` | 41 filas; REST con anon key → 200 |
| `public.orders` como authenticated no admin | 0 |
| Storage con anon key: POST `1uh8lhk/…`, DELETE, POST `erp/…` | 400 (cuerpo `403 AccessDenied`) en los 3 |
| `/seguimiento` legacy (#24) | `public.repairs`: 4, todas `is_deleted=true` (0 vigentes). Prueba en txn con ROLLBACK (des-borrado temporal de 1): como `anon` devuelve 1 fila, `status=Finalizado`, tipo `repair_status`, sin `42804`. Datos sin cambios (4 borradas). |

## §4.1 Reescritura de URLs de imágenes — no aplicada (no hace falta)

- Dry-run (lógica de `scripts/rewrite-legacy-storage-host.sql`, con ROLLBACK): **0 candidatos** en las 7 columnas.
- Prod ya tenía todas las URLs en el host nuevo antes de las migraciones (0 apariciones del host viejo en `data.sql`).
  El conteo de 552 del ensayo provenía de datos del proyecto viejo.
- Verificación: 552 URLs (384 distintas) → 0 sin ruta pública, **0 faltantes en `storage.objects`** (579 objetos);
  HEAD HTTP de las 384 URLs distintas: **384 × 200**.
- `erp.cutover_storage_host_log` no se creó; no hay rollback que conservar.

## §5 Edge Functions — 16:20:10 a 16:20:30

- Secrets presentes (solo nombres): MP access token, webhook secret, `ERP_*` (org, branch, location, snapshot, payment method), `RESEND_API_KEY`.
  Faltan `MERCADOPAGO_NOTIFICATION_URL` y `STOREFRONT_ALLOWED_ORIGINS`: el código tiene defaults
  (`<SUPABASE_URL>/functions/v1/mercadopago-webhook` y lista de orígenes por defecto). No se crearon.
- `secrets set ERP_CHECKOUT_PAUSED=false`.
- Deploy (`--use-api`): `mercadopago-webhook` v6, `mp-webhook` v6, `create-mercadopago-preference` v5
  (con `--no-verify-jwt` para conservar `verify_jwt=false` que tenía; no tiene sección en `config.toml`). Las 3 `ACTIVE`, `verify_jwt=false`.
- Humo (sin órdenes ni pagos):
  - `POST mercadopago-webhook` y `mp-webhook` sin firma → 401 `Firma inválida`.
  - `POST create-mercadopago-preference` con `checkout_id` inválido → 400 `Identificador de checkout inválido` (confirma checkout no pausado).
  - `OPTIONS` → 200.
- Después: `public.orders`=0, `erp.web_orders`=0.

## §7 Cortes por etapa

Conciliación post-migración (`scripts/erp-cutover-reconciliation.sql`, solo lectura):
- catalog: 41 vinculados; 0 diferencias de nombre, descripción, categoría, marca y publicación; 219 productos ERP sin espejo público (todos no publicables); 41 diferencias de tags (`CYBERMONDAY`, F4/§5); 8 de `condition`.
- prices_promos: 0 diferencias de precio lista; 7 promos legacy vigentes sin promo ERP y 1 invertida; 0 promos ERP.
- stock: 0 diferencias (99 = 99).
- repairs: 4 legacy (0 activas), 0 en ERP, 0 activas sin espejo.

`scripts/erp-stage2-price-comparison.sql` (§7.2): 41 `igual`, 0 diferencias; 0 proyecciones fuera de rango.

| Etapa | Acción | Resultado |
|---|---|---|
| 7.1 catalog | `observe` | Backfill/cleanup no corridos (opcionales, requieren decisiones). `block` queda para después del período de observación. |
| 7.2 precio | activo con §3+§5 | 0 diferencias |
| 7.3 stock | `observe` | `block` depende del piloto y de la decisión §5 de las 494 unidades |
| 7.4 promos | dry-run OK; **apply NO ejecutado**; `observe` | El corte exige decidir `open_ended_policy` (promos sin fin, §5) y deja `CYBERMONDAY` para F4. No se pausó el checkout. |
| 7.5 reparaciones | dry-run → **apply 16:26** → `observe` | Precondición D5 cumplida (0 activas). `erp.cutover_function_backups`: 1 activo; RPC legacy ahora es adaptador de `get_repair_by_tracking_code_erp`; REST anon → 200 `[]`. No hay órdenes ERP para probar un código real. Rollback: `scripts/cutover/stage6-repairs-tracking-rollback.sql`. |
| 7.6 dashboard | sin cambios (`off`) | Último paso |

Banderas cambiadas vía `erp.set_storefront_cutover_group` simulando el JWT de un owner que también es admin legacy (auditado).
Estado final: `catalog=observe, prices_promos=observe, repairs=observe, stock=observe, dashboard=off`, todas `admin_tab_hidden=false`.
Prueba en txn con ROLLBACK: un admin legacy edita `public.products` → la escritura pasa y registra 1 canario `catalog`. Canarios reales: 0.

## §6.6 Tipos

- `gen types --schema public` → `src/integrations/supabase/types.ts` **instalado** (local, sin commit). `tsc` de la tienda: 95 → 21 errores. 3 de ellos son nuevos, en `src/contexts/CartContext.test.tsx` (mocks y la vista nueva).
- `gen types --schema erp` → **no instalado**: daba 3 errores nuevos en `typecheck:erp` (`CatalogSheetModal`, `ProductCompatibilityModal`, `ProductVariantsModal`: parámetros RPC nulos). Se restauró el original (`typecheck:erp` exit 0). Copia en `A:\nictech-backup\20261117-1601-pre-erp\types-regenerated\erp-supabase.ts`.

## Builds (16:31)

- `npm run build`: OK.
- `npm run build:erp`: OK.

## Pendiente (usuario)

1. §0.1: apagar el signup público en Dashboard → Auth (no se puede desde la CLI sin endpoint de config). Revisar los 5 owners vigentes y cerrar los no legítimos.
2. §6: desplegar la tienda (Vercel/`main`) y el ERP con la URL de prod; elegir el perfil de módulos.
3. Decisiones §5: promos sin fin (habilita el corte de la Etapa 4), 494 unidades (stock `block`), `CYBERMONDAY`/F4, el resto.
4. Pasar `catalog`, `stock` y `repairs` de `observe` a `block` después del período de observación con 0 canarios legítimos.
5. Adaptar los 3 errores de tipos ERP e instalar los tipos regenerados; arreglar los mocks de `CartContext.test.tsx`.
6. Opcional: setear `STOREFRONT_ALLOWED_ORIGINS` y `MERCADOPAGO_NOTIFICATION_URL` explícitos.
7. §8: después del primer pago aprobado real, verificar el asentamiento en `erp.storefront_payment_syncs`.
