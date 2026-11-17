# Traspaso: orquestación del plan de unificación ERP

Estado al 2026-11-14 ~20:20. Rama `dev/erp`. **Nada commiteado, nada aplicado a ninguna base.**

## Objetivo del usuario

Ejecutar completo `docs/erp-admin-unification-plan.md` (contexto en `docs/erp-admin-unification-context.md` y `docs/erp-catalog-input-contract.md`) y dejar el ERP listo para usar.

Modo de trabajo pedido por el usuario:
- La sesión principal **solo orquesta** y no implementa, para no llenar el contexto.
- Implementan agentes **Codex CLI** con el modelo default `gpt-6.1-terra` en **xhigh**, usando la skill `codex-delegar`.
- Planificación y auditoría las hacen **subagentes Opus en effort high**.

## Reglas duras

- La **única** base Supabase es **PRODUCCIÓN**, con la tienda en vivo: proyecto `tuzpcofywkhglkqplhnn`. `AGENTS.md` dice "desarrollo", pero está desactualizado. **Prohibido**: `supabase link`, `db push`, `functions deploy`, `psql` remoto y el MCP de Supabase. Tampoco se levanta `dev`, `dev:erp` ni Electron con el `.env` real.
- Validación SQL real: hay **PostgreSQL 18 local** con un shim de Supabase y pgTAP, preparado por el auditor. Scripts en `A:\_audit_pg\work\` (`00_shim.sql`, `01_pgtap_shim.sql`, fixtures); metodología en `reports/audit-01.md`. Cada agente usa su propio clúster y puerto:

  | Tarea | Clúster | Puerto |
  |---|---|---|
  | 01 | `A:\_audit_pg` | 56432 |
  | 03 | `A:\_audit_pg_03` | 56433 |
  | 04 | `A:\_audit_pg_04` | 56434 |
  | 02 | `A:\_audit_pg_02` | 56435 |

  Al terminar, `pg_ctl stop`.
- Los Codex corren en el checkout `A:\nictech` **sin `--worktree`**, porque hay muchos cambios sin commitear del usuario. Por eso **nadie commitea** y los conjuntos de archivos de agentes paralelos tienen que ser disjuntos.
- Docker no sirve: el daemon da "read-only file system". El disco C: estuvo lleno, y la limpieza de temporales **borró el scratchpad anterior**. Todo lo recuperado está en esta carpeta.

## Baseline previo a los cambios

- Pasan: `npm run build`, `typecheck:erp` (0 errores), `build:erp` y `test:erp:desktop` (10/10).
- `npx vitest run`: 321 de 322 tests. Fallas preexistentes en `scripts/release-erp.test.mjs` (es `node:test`) y, a veces, en `apps/erp/src/App.test.tsx` ("switches workspace").
- Typecheck de la tienda (`tsc -p tsconfig.app.json`): 132 errores previos. Lint: 9 errores previos.

## Tareas: estado

Los briefs completos están en `briefs/brief-0N.md`. Los prompts tal como se enviaron a Codex, con el addendum del orquestador, están en `briefs/codex-*-promptN.md`. Los reportes de Codex y la auditoría están en `reports/`.

| # | Tarea | Estado | Sesión Codex |
|---|---|---|---|
| 01 | Base del catálogo (0B + Etapa 1): migraciones `20261114100000..100900`, `scripts/erp-stage1-*.sql`, pgTAP | **HECHA y auditada.** El auditor encontró 3 bloqueantes, 6 importantes y 10 menores; todos aplicados según `reports/codex-01-catalog-db-report3.md`. Falta una re-auditoría corta de esos fixes. | `01a1dbd9-5732-7b93-b372-3abb07abbd42` |
| 02 | Pantallas del catálogo en el ERP: ficha guiada, fotos, publicar/pausar, estados, inactivos | **PARCIAL.** Cortada por el límite de uso de Codex, sin reporte final. Ya creó `CatalogSheetModal.tsx`, `sheetSchema.ts` y sus tests, y tocó `CatalogWorkspace.tsx`, `schemas.ts` y `StockWorkspace.tsx`. | `01a1dc20-931c-7512-8eb5-189741a350bf` |
| 03 | Reparaciones y `/seguimiento` (Etapa 6 + ajuste I) | **PARCIAL.** Hechos: estados `public_stage`, entrega formal (`20261114200000`), `transitions.ts` y `schemas.ts`. Faltan: código `XXXX-XXXX`, RPC `get_repair_by_tracking_code_erp`, notas públicas e internas, UI, scripts de corte y rollback, y sus pgTAP. Ver `reports/codex-03-repairs-report1.md`. | `01a1dc0e-c4b6-7251-886d-0ac92873e6f3` |
| 04 | Precio unificado y checkout (Etapa 2): Edge Function de MercadoPago, `types.extensions.ts`, `validateCart`, `scripts/erp-stage2-price-comparison.sql` | **PARCIAL.** Cortada mientras verificaba `deno check` y los tests, sin reporte final. | `01a1dc20-931a-7460-94d1-36fa934ddf88` |
| 05 | Promos y campañas (Etapa 4, sin USD) | **NO INICIADA.** Depende de 04. | — |
| 06 | Preparación del corte: banderas, canarios, conciliación y runbook | **NO INICIADA.** Va última. | — |

### Pendientes sueltos

- **Cambio de overlay de la tarea 01**, todavía sin aplicar. En `apps/erp/src/lib/supabase.ts`, tipar `active_catalog_products` como `Omit<products.Row, "base_cost" | "purchase_currency" | "target_margin_percent">`. Durante la ronda paralela, solo la tarea 03 tenía permiso para editar ese archivo: aplicarlo cuando la 03 cierre.
- Mientras corrían los agentes cambiaron archivos de admin en `src/`, `package.json` y `.gitignore`, y los logs de Codex no muestran que los haya escrito Codex. **Confirmar con el usuario** si son suyos.

## Cómo seguir

1. Reanudar las tres sesiones cortadas **cuando haya cuota de Codex**. El límite se reseteaba a las 22:56 del 14/11, y el usuario pidió que lo avise él. Se pueden correr en paralelo, en background y sin polling:
   ```bash
   cd /a/nictech && codex exec resume <SESSION_ID> --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort="xhigh" -o "<out>.md" - < docs/erp-orchestration/briefs/resume-generic.md
   ```
   Si alguna cierra parcial, volver a reanudarla con un prompt que liste lo que falta. Codex tiende a cortar en "parcial".
2. Auditar 02, 03 y 04, además de re-auditar los fixes de 01, con un subagente Opus en high. Mismo método que `reports/audit-01.md`: diff real, SQL ejecutado en Postgres local y build y tests contra el baseline. Los hallazgos van a un archivo, y Codex los aplica en la misma sesión.
3. Aplicar el overlay pendiente de la 01.
4. Lanzar la **05** (`briefs/brief-05.md`) con un addendum como el de `codex-04-price-checkout-prompt1.md`: contratos reales de las tareas previas, sin editar archivos ajenos y con su propio clúster en el puerto 56436. Auditar.
5. Lanzar la **06** (`briefs/brief-06.md`), con su clúster en el puerto 56437. Auditar.
6. Auditoría final integral con Opus: build, vitest, todos los pgTAP aplicados en orden en un clúster limpio y en uno tipo producción.

## Lo que necesita el usuario para que quede usable de verdad

- Un entorno Supabase de prueba, o aceptar la validación con el Postgres local.
- Aplicar las migraciones y desplegar las Edge Functions en producción. Lo hace él, con `ERP_CHECKOUT_PAUSED=true` durante los cortes de 04 y 05.
- Commitear el árbol.
- Volcar el DDL legacy y regenerar los tipos (Etapa 0 c, d y e).
- Piloto de caja y POS.
- Decisiones del plan §5:
  - Qué hacer con las 494 unidades en productos inactivos.
  - Si las promos llevan fecha de fin o no.
  - Si hay una o dos sucursales.
  - Los costos de 41 productos.
- La Etapa 7 (cortes del admin viejo) la decide él, módulo por módulo.
