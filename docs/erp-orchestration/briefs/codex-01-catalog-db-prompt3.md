Un auditor revisó tu trabajo del Brief 01 y ejecutó de verdad las migraciones en un PostgreSQL 18 local y aislado. Aplicá TODOS los hallazgos BLOQUEANTE e IMPORTANTE, y los MENOR que sean razonables, del archivo:
C:\Users\Gime\AppData\Local\Temp\claude\d36df3ccd66b24bf\a0008f39-37b6-4aa8-a076-995924bb68db\scratchpad\audit-01.md

Reglas:
- Solo podés editar tus archivos de esta tarea: supabase/migrations/20261114100*.sql, scripts/erp-stage1-*.sql y los tests pgTAP en supabase/tests/database/ (incluido erp_storefront_bridge.test.sql si el fix I1 lo exige).
- PROHIBIDO en esta ronda: apps/erp/src/lib/supabase.ts (ahora lo edita otro agente en paralelo). Si algún fix requiere cambiar el overlay de tipos, NO lo hagas: escribí el cambio exacto (diff textual) en una sección "Cambios de overlay pendientes" del reporte final.
- Tampoco toques supabase/migrations/2026111420* ni archivos de reparaciones/seguimiento (son de otro agente que corre en paralelo).
- Siguen vigentes las reglas del brief: no hay base remota, no se commitea y no se editan migraciones anteriores a 20261114.
- VALIDACIÓN REAL: el auditor dejó un clúster en A:\_audit_pg (puerto 56432, solo localhost, trust) con un shim de Supabase y pgTAP en A:\_audit_pg\work\ (sus datos fueron borrados: re-inicializalo con initdb si hace falta, usando el mismo directorio y puerto). Leé la sección de metodología de audit-01.md. Aplicá las 99 migraciones previas + seed + tus 10 nuevas en base limpia y en la copia tipo producción, y corré tus pgTAP + erp_storefront_bridge + catálogo + POS hasta que pasen todos. Al terminar, detené el clúster (pg_ctl stop). Nunca te conectes a hosts remotos.
- Corré de nuevo npm run typecheck:erp, build:erp, build y npx vitest run.

Reportá en el mismo formato: cada hallazgo (ID) con su estado (resuelto / descartado y por qué), y los resultados reales de pgTAP con números.
