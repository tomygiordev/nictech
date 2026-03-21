# NicTech: Persistent Memory (AI_NOTES.md)

This file contains distilled knowledge about the project to save tokens in future conversations.

## Project Knowledge (Learned)
-   **Structure**: React 18, Vite, Supabase. (Identified 2026-03-21)
-   **Styling**: Standard Shadcn UI implementation.
-   **Vercel Integration**: `vercel.json` exists, likely for hosting.
-   **Active Modules**:
    -   `src/pages/Seguimiento.tsx`: Tracking logic.
    -   `src/pages/Checkout.tsx`: Checkout flow.
-   **Gotchas & Tips**:
    -   Use `src/integrations/supabase/` for DB clients.
    -   React Hook Form is preferred.
    -   Zod is used for validation.

## Task Log (Completed)
-   **2026-03-21**: Meta-configuration completed.
    -   Created `CLAUDE.md`: Rules and standards.
    -   Created `ARCHITECTURE.md`: Project map.
    -   Created `.agent/workflows/token-optimizer.md`: AI efficiency guidelines.
    -   Created `AI_NOTES.md` (this file): Memory bank.

## Tech Stack Deep-Dive
-   **@radix-ui**: Full suite of Radix primitives used via Shadcn.
-   **TanStack Query**: `v5.83.0` (Latest/v5 API patterns).
-   **Recharts**: Large implementation for admin dashboards.
-   **Quill**: Rich text editor used in `src/pages/Seguimiento.tsx` (via react-quill).

## Future Memory (Write here)
*(This section will be updated with new architectural decisions, bug fixes, or complex logic traces.)*
