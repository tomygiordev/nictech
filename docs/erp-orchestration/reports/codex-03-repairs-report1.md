# Resultado: parcial — no listo para desplegar

Implementé y probé la parte de **estados y entrega formal**, pero **no completé el seguimiento web**. No apliques todavía la migración nueva: faltan el código público, el RPC, las notas, los scripts de corte y sus pruebas.

No consulté ni modifiqué producción, no ejecuté el corte y no hice commits.

## 1. Archivos tocados

**Nuevos**

- `supabase/migrations/20261114200000_erp_repair_public_stages.sql` — etapas públicas, estados y transiciones; vincula el estado Entregado con la entrega formal.
- `supabase/tests/database/erp_repairs_public_tracking.test.sql` — ocho pruebas **parciales**, limitadas a estados y configuración.
- `apps/erp/src/features/repairs/transitions.ts` — identifica qué transiciones pueden hacerse manualmente.
- `apps/erp/src/features/repairs/transitions.test.ts` — dos pruebas para esa regla.

**Modificados**

- `supabase/seed.sql` — inicializa los estados y transiciones nuevos.
- `supabase/tests/database/erp_phase_d_repairs_lifecycle.test.sql` — verifica que no se pueda marcar Entregado sin entrega formal y actualiza la expectativa posterior a la entrega.
- `apps/erp/src/features/repairs/api.ts` — excluye Entregado de las transiciones manuales.
- `apps/erp/src/features/repairs/RepairsWorkspace.tsx` — muestra el estado «Esperando repuestos».

## 2. Estado de los objetivos

| Objetivo | Estado | Resultado |
|---|---|---|
| Catálogo de estados | **Parcial** | Agregué `public_stage`, los estados y las transiciones. La entrega formal registrada en `repair_deliveries` es la fuente de verdad: genera el evento Entregado; una transición sin entrega se rechaza. Falta probar el backfill histórico y resolver la inicialización de organizaciones futuras. |
| Código de seguimiento | **No hecho** | No agregué columna, generación, backfill ni cambios al ingreso o a la vista. |
| RPC web y límite de intentos | **No hecho** | No existe aún `get_repair_by_tracking_code_erp`; tampoco el registro ni la purga de intentos. |
| Notas públicas e internas | **No hecho** | No agregué tabla, RPC ni formulario. |
| Scripts de corte y rollback | **No hechos** | No se creó ni ejecutó ninguno. |
| UI ERP | **Parcial** | Reconoce Esperando repuestos y reserva Entregado para la entrega formal. Faltan búsqueda por código/DNI, código en detalle y comprobante, notas e indicador web. |
| Overlay de tipos | **No hecho** | No modifiqué `apps/erp/src/lib/supabase.ts`. |
| Pruebas | **Parcial** | Hay pruebas de estados y entrega, no de seguimiento, privacidad, rate limiting ni corte. |

## 3. Verificación

| Comando o prueba | Resultado real | Comparación |
|---|---|---|
| `npm run build` | OK; warning de chunk | Igual al baseline |
| `npm run typecheck:erp` | OK, 0 errores | Igual |
| `npm run build:erp` | OK; warning de chunk | Igual |
| Vitest focal de `transitions.test.ts` | **2/2** | Pruebas nuevas pasan |
| `npx vitest run` | Primera corrida: 36 archivos OK / 1 falla, 324 tests OK. Repetición: 35 OK / 2 fallan, 323 tests OK / 1 falla | En la repetición aparecen las dos fallas conocidas del baseline: `release-erp.test.mjs` y navegación de `App.test.tsx` |
| `npx tsc --noEmit -p tsconfig.app.json` | 132 errores | Igual al baseline; no toqué archivos de la tienda |
| `npm run lint` | 9 errores y 24 warnings | Igual al baseline |
| ESLint de los cuatro archivos de reparaciones | OK, 0 errores | Sin errores nuevos |
| `npm run test:erp:desktop` | **10/10** | Igual al baseline |
| PostgreSQL 18 local, migraciones y seed | Aplicación OK en base limpia aislada | Validación local, no despliegue |
| SQL parcial con shim pgTAP | **8/8** estados; **32/32** ciclo de reparación | La prueba de ciclo usó una copia temporal adaptada al fixture del shim |
| Deno / Edge Functions | No ejecutado | No se tocaron Edge Functions |
| `npx supabase test db` | No ejecutado | No había stack Supabase local; se usó el clúster aislado autorizado en el addendum |

El clúster local del puerto 56433 quedó detenido. El cierre normal agotó su tiempo de espera y se detuvo finalmente con `pg_ctl -m immediate`.

## 4. No verificado

- La migración y los tests no se ejecutaron en un stack Supabase con **pgTAP real**. El shim local cubre solo un subconjunto de pgTAP.
- No probé con datos históricos el backfill de eventos de entrega ni el aprovisionamiento de organizaciones creadas después de la migración.
- No se verificaron tracking, privacidad, rate limiting, corte ni rollback porque todavía no están implementados.
- La definición SQL anterior de `public.get_repair_by_tracking_code` no está versionada. Los tipos TypeScript muestran la forma consumida por la tienda, pero no permiten confirmar por sí solos la firma y tipos SQL exactos de producción. Eso debe verificarse por un medio autorizado antes del corte.

## 5. Riesgos y pendientes

1. **No aplicar la migración parcial ni ejecutar un corte.** Primero hay que completar y revisar el alcance restante.
2. La migración cambia el comportamiento de la entrega formal: agrega automáticamente el evento Entregado. Aunque las pruebas locales del ciclo pasaron, requiere revisión y pruebas con pgTAP real.
3. Sigue pendiente la decisión de una o dos sucursales; no creé ninguna.
4. Una vez completado el trabajo, el usuario deberá decidir cuándo aplicar migraciones y ejecutar los scripts de corte. Esos scripts aún no existen.

## 6. Contratos expuestos hasta ahora

- `erp.repair_statuses.public_stage text`: admite `Recibido`, `Diagnóstico`, `Repuestos`, `Reparación` y `Finalizado`; actualmente es nullable.
- Estados internos nuevos: `waiting_parts` y `delivered`.
- `erp.install_repair_public_stages(uuid) → void`: función interna de inicialización, sin ejecución concedida a `anon` ni `authenticated`.
- **No existe todavía** `public.get_repair_by_tracking_code_erp(search_code text)`: no corresponde presentar una firma de retorno ni una respuesta de ejemplo como si estuvieran implementadas.

## Key Learnings:

1. `ready` ya era terminal y la entrega formal tenía un hecho propio; marcar Entregado debe depender de `repair_deliveries`, no de una transición manual independiente.
2. La compatibilidad SQL del corte no puede darse por comprobada solo con los tipos TypeScript de la tienda.