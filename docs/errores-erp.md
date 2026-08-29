# Errores encontrados en el ERP

## Veredicto

**Los errores técnicos documentados con reproducción local fueron corregidos en código; la suite SQL sigue pendiente de ejecutarse con PostgreSQL local disponible.**

El frontend compila y Docker levanta, pero la base local falla en operaciones centrales y la mayoría de los módulos todavía no tiene un flujo funcional completo.

## ERP-1 — Error central en permisos de base de datos

**Severidad: P1 grave**

Archivo corregido mediante migración forward-only: `supabase/migrations/202608190012_fix_erp_permission_clock.sql`

El código declara:

```sql
current_time timestamptz := now();
```

Luego usa:

```sql
override_grant.valid_from <= current_time
```

PostgreSQL interpreta `current_time` como su función incorporada de tipo `time with time zone`, no como la variable `timestamptz`.

Error reproducido:

```text
operator does not exist:
timestamp with time zone <= time with time zone
```

Esto rompía `erp.has_permission()` y afectaba inventario, stock valorizado, compras, ventas, caja, reparaciones, presupuestos, documentos, canjes y varias validaciones RLS/permisos. La migración correctiva renombra la variable a `permission_check_time` sin alterar la semántica ni los privilegios.

Es el problema técnico más importante del ERP y quedó corregido en la migración nueva.

## ERP-2 — La suite pgTAP falla

**Severidad: P1 grave**

Comando: `npm run db:test`

Resultado anterior: **FAIL**. Resultado actual: **pendiente**, porque el entorno local devuelve `ECONNREFUSED 127.0.0.1:54322` antes de ejecutar las suites.

Varias suites abortan antes de completar todos los tests por el error central de permisos:

- `erp_documents_communications.test.sql`
- `erp_inventory_ledger.test.sql`
- `erp_purchases_costs_pricing.test.sql`
- `erp_repairs_quotes_warranties.test.sql`
- `erp_sales_cash_orders.test.sql`
- `erp_stock_cost_ledger.test.sql`

Los planes TAP quedan incompletos porque muchas operaciones fallan antes de llegar a sus assertions.

## ERP-3 — Inconsistencia entre seed y tests de ubicaciones

**Severidad: P1/P2**

El test esperaba `7 ubicaciones`, pero el seed crea una octava válida: `CUARENTENA-CANJES`. El test fue actualizado para esperar 8.

Archivos:

- `supabase/seed.sql:578-587`
- `supabase/tests/database/erp_foundation.test.sql`

Puede tratarse de un test desactualizado, un seed actualizado sin su test correspondiente o una inconsistencia de contrato entre etapas.

## ERP-4 — Inconsistencia entre seed y tests de medios de pago

**Severidad: P1/P2**

El test esperaba `2 medios de pago`, pero el seed crea 4 intencionales:

- `CASH`
- `CARD`
- `MERCADOPAGO`
- `TRADE_IN`

Archivos:

- `supabase/seed.sql:458-477`
- `supabase/seed.sql:589-597`
- `supabase/tests/database/erp_purchases_costs_pricing.test.sql`

El contrato de pruebas fue actualizado para incluir `TRADE_IN`; no se eliminaron medios válidos del seed.

## ERP-5 — Fallos independientes en PC, canjes e IMEI

**Severidad: P1**

La suite `supabase/tests/database/erp_pc_tradeins_imei.test.sql` reportó anteriormente fallos independientes en los tests 113, 145, 146 y 212. No se modificaron sin reproducirlos: deben revalidarse después de aplicar la migración correctiva y ejecutar PostgreSQL local.

Los fallos afectan:

- reconciliación del costo total de liberación;
- alcance RLS por tenant y sucursal;
- liberación de stock físico y valuación de canjes.

Deben revisarse después de solucionar el error central de permisos, porque algunos resultados podrían estar contaminados por fallos anteriores.

## ERP-6 — La mayoría de los módulos no están implementados funcionalmente

**Severidad: P1 funcional**

En `apps/erp/src/App.tsx:271-279` solo están conectados funcionalmente:

- cuentas corrientes;
- contabilidad.

El resto muestra `Contrato preparado, flujo pendiente`:

- punto de venta;
- caja;
- pedidos online;
- productos y servicios;
- existencias e inventarios físicos;
- etiquetas;
- compras y proveedores;
- clientes;
- presupuestos;
- reparaciones y pruebas técnicas;
- armados de PC;
- equipos usados y garantías;
- precios, monedas y rentabilidad;
- reportes;
- documentos/ARCA;
- WhatsApp e integraciones;
- usuarios, permisos y sucursales;
- configuración y auditoría.

No es un error de compilación, pero sí una limitación funcional muy grande para llamarlo ERP operativo completo.

## ERP-7 — El dashboard todavía es una maqueta funcional

**Severidad: P1/P2**

El dashboard muestra caja sin apertura, pedidos web sin datos, reparaciones sin datos y alertas de stock sin datos.

También indica que la actividad aparecerá cuando se conecte el primer flujo transaccional. Esto confirma que la navegación está preparada, pero todavía no existe una operación integrada de punta a punta en la mayoría del ERP.

## ERP-8 — Configuración sin validación fuerte del entorno

**Severidad: P1**

Archivo: `apps/erp/src/lib/supabase.ts`

Tiene defaults como:

```text
http://127.0.0.1:54321
local-development-key
```

Si las variables no existen, ahora el resolver rechaza la configuración y el gate muestra un error claro; no se crea un cliente con valores ficticios.

Riesgos:

- ~~errores poco claros~~ (corregido con estado visible de configuración);
- ~~aplicación aparentemente levantada pero sin backend válido~~ (corregido: no se hacen llamadas con cliente inválido);
- imposibilidad de distinguir configuración local correcta de configuración incompleta;
- comportamiento diferente entre build local, Docker y producción.

## ERP-9 — Warnings de React Hooks

**Severidad: P2**

Lint termina con `0 errores` y `20 warnings`, todos fuera del ERP. El warning propio de `ErpAuthProvider` fue corregido separando el contexto/hook y la validación en archivos independientes.

Archivos observados:

- `CaseManagement.tsx`
- `InventoryHistory.tsx`
- `InventoryModule.tsx`
- `VariantManagement.tsx`
- `ProductDetailModal.tsx`

Los warnings principales son dependencias faltantes en `useEffect`, funciones recreadas en cada render, dependencias faltantes en `useMemo` y exports incompatibles con Fast Refresh.

## Checks que sí pasaron

- `npm run lint`: 0 errores, 20 warnings fuera del ERP.
- `npm run typecheck:erp`: PASS.
- `npm run build:erp`: PASS.
- `npm run test:run`: 6 archivos, 44 tests PASS.
- `http://127.0.0.1:8081/health`: 200.
- Contenedor Docker del ERP: `healthy`.

Estos resultados no sustituyen la ejecución pendiente de SQL/RPC/RLS ni prueban que el ERP sea funcional de punta a punta.

## Limitaciones de la auditoría

No se probaron navegación E2E, rollback real, restauración de backup, pruebas fiscales ARCA ni concurrencia real de usuarios.

La revisión de SQL, RPC, RLS y pgTAP depende de ejecutar nuevamente la base local con la migración correctiva aplicada. ERP-5 permanece pendiente de esa revalidación.

## Prioridad recomendada

1. Levantar Docker/Postgres local y ejecutar todas las suites pgTAP.
2. Separar los fallos de cascada de los fallos independientes y revalidar ERP-5.
3. Conectar los flujos mínimos de ventas, caja, stock y reparaciones (ERP-6/7 siguen fuera de este arreglo).
