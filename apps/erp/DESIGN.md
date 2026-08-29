# NicTech ERP Design Contract

## Surface

- Mode: Operate
- Direction seed: `c8e6ddc1`
- Thesis: a quiet operational ledger where current state, authority and next action are visible without decoration competing with work.
- Scope: the private management application only. The storefront keeps its existing visual identity until its own redesign is approved.

## Visual Language

- Source Sans 3 Variable is the interface typeface.
- Dense navigation and compact labels support repeated desktop use; touch targets remain at least 44 px on narrow screens.
- Warm neutral surfaces carry structure. NicTech cyan is reserved for selection, focus and high-value state changes.
- Borders, alignment and tabular rhythm define hierarchy before shadows or ornamental containers.
- Status is never communicated by color alone.

## Workspace Pattern

- Left rail: stable module map, grouped by operational area.
- Top bar: branch and environment context.
- Center: the active ledger, form or workflow.
- Right rail: attention, readiness and exceptions, not duplicate navigation.
- Empty states state what is missing and which verified dependency unlocks it; they never invent business data.

## Interaction Rules

- `F2` focuses module search.
- Keyboard focus must remain visible.
- Destructive records are deactivated, cancelled or reversed; the UI must not present hard-delete actions.
- Sensitive actions show the permission or approval boundary before submission.
- Remote and local environments must be unmistakable.
- Motion is limited to spatial transitions and respects `prefers-reduced-motion`.

## Data Presentation

- Monetary values always display currency and operation exchange-rate context.
- Stock always identifies location and separates physical, reserved and available quantities.
- Every posted operation exposes actor, time, status and correlation/reference identifiers.
- Tables prioritize scanning and reconciliation; cards are reserved for summaries or exceptional states.
