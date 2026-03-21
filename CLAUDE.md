# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
