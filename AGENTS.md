# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project: NicTech

E-commerce and repair-tracking platform for a tech shop. Features a public storefront (products, checkout via MercadoPago, repair status tracking) and a protected admin dashboard.

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript (strict)
- **UI**: Tailwind CSS 3.4 + shadcn/ui (Radix) + Framer Motion + Lucide React
- **State/Data**: Supabase (DB + Auth + Edge Functions) + TanStack React Query v5
- **Forms**: React Hook Form + Zod
- **Notifications**: Sonner (toast), React Helmet Async (SEO)
- **Payments**: MercadoPago (server-side Supabase Edge Function)

## Commands

```bash
npm run dev          # Dev server (port 8080)
npm run build        # Production build
npm run lint         # ESLint
npm run preview      # Preview production build

# Supabase
npx supabase login
npx supabase gen types typescript --local > src/types/supabase.ts
```

## Architecture

### Entry Points
- `src/main.tsx` — mounts `<App>` wrapped in QueryClient + Helmet + Auth + Cart providers
- `src/App.tsx` — React Router v6 with 12 routes (all wrapped in `<Layout>`)

### Global Contexts
- `src/contexts/AuthContext.tsx` — Supabase session/user, `signOut`. Hook: `useAuth()`
- `src/contexts/CartContext.tsx` — Cart persisted to localStorage. Validates stock against DB before checkout (`validateCart()`). Hook: `useCart()`

### Data Layer
- `src/integrations/supabase/client.ts` — Single Supabase client (localStorage sessions, auto token refresh)
- `src/integrations/supabase/types.ts` — Auto-generated DB types. **Never hand-edit this file.**

### Key Pages & Routes

| Route | Page | Notes |
|---|---|---|
| `/` | Index | Hero, services, testimonials |
| `/tienda` | Tienda | Product grid, filters, "Load more" pagination |
| `/checkout` | Checkout | Cart validation → MercadoPago redirect |
| `/seguimiento` | Seguimiento | Repair lookup by DNI or tracking code |
| `/login` | Login | Admin auth; 5-attempt lockout (5 min) via localStorage |
| `/admin` | Admin | Tabbed admin dashboard (repairs, products, variants, blog, orders) |
| `/blog` | Blog | Published posts |

### Supabase Edge Functions (Deno)
Located in `supabase/functions/`:
- `create-mercadopago-preference/` — Re-validates prices and stock from DB before creating payment. Never trust frontend prices.
- `mercadopago-webhook/` — Handles async payment status updates.

### Database Key Patterns
- **Products** have optional `brand_id` + `model_id` FKs and a `product_variants` child table (color + stock + image per variant).
- **Orders** store `items` and `payer` as JSONB; also record `ip_address`, `device_fingerprint`, `user_agent` for fraud detection.
- **Repairs** use a fixed 5-step enum status: `"Recibido" | "Diagnóstico" | "Repuestos" | "Reparación" | "Finalizado"`.
- `repair_logs` has `is_public` — only public logs shown to customers on `/seguimiento`.
- Critical operations use RPCs: `get_repair_by_tracking_code()`, `process_approved_order()`, `decrement_stock()`.

### Admin Components (large files, be careful)
In `src/components/admin/`:
- `VariantManagement.tsx` (~76KB) — Color variants with separate stock per product
- `SmartphoneManagement.tsx` (~57KB) — Full CRUD for phone products
- `CaseManagement.tsx` (~57KB) — Repair case templates
- `BrandModelSelector.tsx`, `CreatableResourceSelector.tsx`, `CreatableAttributeSelector.tsx` — Allow creating new DB entries inline from dropdowns

## Coding Standards

1. **No `any`** — Strict TypeScript throughout. Use generated Supabase types.
2. **Early returns** — Guard clauses over nested ifs.
3. **Zod schemas required** — Every form needs a schema. Place in `src/hooks/use-<feature>-form.ts` or inline in the component file.
4. **shadcn/ui first** — Use existing `src/components/ui/` components; don't build custom alternatives.
5. **DRY** — Check for existing hooks (`src/hooks/`) and admin selectors before writing new ones.

## Key Non-Obvious Patterns

- **Variant-aware cart**: Items with same product ID but different color variants are separate cart entries.
- **Tracking code format**: Always `XXXX-XXXX` (8 chars excluding I, O, 0, 1). Use `generateTrackingCode()`.
- **Image arrays**: `products.additional_images` is a string array (URLs). Primary image is separate.
- **Tags**: `products.tags` is a string array used for filtering.
- `cn()` utility in `src/lib/utils.ts` — use for conditional Tailwind classes.
- Path alias `@` maps to `./src`.

## Entorno de Pruebas y Base de Datos

- **Docker NO se utiliza**: No exigir demonio de Docker ni considerarlo un bloqueo para pruebas o ejecución. No ejecutar `docker info` ni `supabase db reset`.
- **Testing de BD**: Se realiza directamente contra el proyecto Supabase de desarrollo (`tuzpcofywkhglkqplhnn`), utilizando transacciones aisladas con `ROLLBACK` o fixtures temporales debidamente limpiados.
- **Verificación local**: Priorizar `npm run typecheck:erp` y pruebas de Vitest puntuales (`npx vitest run <archivo>`).

## Delegación y Orquestación con agy (Gemini)

- **Estándar de invocación**: Usar la skill `gemini-cli` (`agy -p "<PROMPT>" --model <MODELO> --dangerously-skip-permissions --print-timeout 30m`). El modelo lo define el usuario o el plan según la tarea (ej: Flash para velocidad/rutina, Argon para razonamiento profundo/auditoría). Si se requiere continuar la conversación, usar `-c` o `--continue`.
- La delegación a `agy` (Gemini) está plenamente autorizada para **escribir, editar e implementar código directamente en el repositorio**. No forzar modos `READ-ONLY` ni generar reportes teóricos cuando el pedido es implementar una feature.
- **Ejecución por fases**: Respetar la topología de delegación solicitada (incluyendo si un subagente consulta a otro como Flash -> Argon). En fases de implementación, el foco es producir código y verificarlo contra el `git diff` real y tests locales, sin crear intermediarios innecesarios no previstos en el plan.

## Engram — memoria y continuidad obligatorias

- Engram es el sistema requerido de memoria y persistencia para todo el trabajo de este repositorio. Consultarlo al iniciar, registrar avances durante el trabajo y guardar el cierre; no esperar a que el usuario lo recuerde.
- Con el MCP cargado, usar `mem_session_start` y `mem_context` para recuperar continuidad, `mem_search` para antecedentes, `mem_get_observation` para leer completa una observación por ID, `mem_save` para decisiones/progreso y `mem_update` para corregir una observación existente.
- La ausencia de herramientas `mem_*` es un problema de configuración que se debe reparar. Verificar la configuración activa de Codex, asegurar `[mcp_servers.engram]` y las instrucciones de memoria/compactación, corregir la ruta que realmente lee el proceso, reiniciar Codex y verificar que las herramientas aparezcan. No dar la tarea por lista ni normalizar el uso del CLI como reemplazo permanente del MCP.
- Como bootstrap de reparación o continuidad mientras se recarga Codex, se puede usar el CLI local: `engram setup codex`, `engram search "<tema>" --project nictech` y, para IDs exactos, `engram mcp --tools=agent --project nictech` por stdio con `mem_get_observation`. En Windows, comprobar `%USERPROFILE%\.codex\config.toml` y `%APPDATA%\Codex\config.toml`; no asumir que el setup modificó el archivo activo.
- Persistir el estado en hitos y al cierre: **qué se hizo, qué no se hizo**, archivos afectados, verificaciones y resultados, bloqueos, decisiones pendientes y próximo paso. No presentar trabajo incompleto como terminado. Reutilizar un `topic_key` estable o actualizar la observación existente para evitar memorias duplicadas o contradictorias.
- Cerrar con `mem_session_summary`, con Goal, Instructions, Discoveries, Accomplished, Next Steps y Relevant Files, dejando explícito lo pendiente.
