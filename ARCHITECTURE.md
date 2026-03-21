# NicTech Architecture (Context Map)

Summarized mapping for AI agents to find things quickly without listing.

## Root Directories
-   `.agent/workflows/`: Automation steps.
-   `src/`: Application source code.
-   `supabase/`: Database migrations and functions.

## Source Sub-folders (`src/`)
-   `pages/`: Main page components.
    -   `admin/`: Backoffice views.
    -   `Seguimiento.tsx`: Current active page.
    -   `Checkout.tsx`: Payment flow.
-   `components/`: UI components.
    -   `admin/`: Specialized admin controls.
    -   `ui/`: Shadcn UI foundational components.
-   `integrations/supabase/`: Supabase client and types.
-   `hooks/`: Custom React hooks (useAuth, useProducts, etc.).
-   `lib/`: Core libraries (utils.ts for tailwind merge).
-   `types/`: Typescript definitions.
-   `utils/`: Helper functions.

## Data Flow
-   **Fetching**: Use `TanStack React Query` + `supabase`.
-   **Storage**: Supabase storage buckets for assets.
-   **Auth**: Supabase Auth (handled in `src/contexts/AuthContext.tsx` or similar).

## Icons & UI
-   **Icons**: `lucide-react`.
-   **Modals/Drawers**: `vaul` or `radix-ui/dialog`.
-   **Toasts**: `sonner`.
-   **Forms**: `react-hook-form` + `zod`.
