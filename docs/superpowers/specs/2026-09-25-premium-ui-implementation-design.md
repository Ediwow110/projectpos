# NexPOS Premium UI Implementation Design

## Purpose

Implement the approved Figma design in the existing NexPOS web application without rewriting the product logic. The implementation must preserve the current API contracts, POS/payment safety behavior, offline queueing, permissions, reporting semantics, and route structure while replacing the old blue/navy presentation with the premium cream/coral product system.

The Figma file `NexPOS — Premium Product UI/UX` (`xr66O7yTaG0bhMhDI2UI7R`) is the visual source of truth. Canonical frames used for implementation are:

- Dashboard: `33:38`
- POS sell workspace: `36:6`
- POS payment: `36:226`
- POS tablet: `36:316`
- Products: `29:28`
- Inventory: `34:28`
- Sales: `41:2`
- Reports: `41:447`
- Customers: `34:715`
- Shifts: `30:53`
- Shift close: `34:1007`
- Login: `18:2`
- Onboarding: `35:2`
- Branches: `30:245`
- Billing: `30:420`
- Sync & Devices: `30:552`

## Outcome

A user should experience one coherent premium interface across authenticated management pages, POS, authentication, and onboarding. The implementation should feel materially different from the current generic blue SaaS shell while retaining the same workflows and data integrity.

Success means:

1. Existing routes and API-backed behaviors still work.
2. The visual language matches the approved Figma direction closely enough that Dashboard, POS, Products/Inventory, Sales/Reports, Customers/Shifts, Branches/Billing/Sync, Login, and Onboarding read as the same product family.
3. Pre-authentication pages do not expose business-sensitive financial or operational data.
4. Reporting visualizations use real API data only. Unsupported graph concepts are omitted or represented by an honest unavailable state; no fabricated production data is introduced.
5. Desktop and tablet layouts remain first-class. Mobile remains usable and accessible even where the Figma artifact is desktop-led.

## Visual System

### Color

The implementation derives from these canonical colors:

- Canvas / paper: `#FCF8F3`
- Surface: `#FFFFFF`
- Surface subtle: `#F7F1EA`
- Coral action: `#F35D3F`
- Coral hover: `#D94A30`
- Coral soft: `#FFF0EA`
- Graphite: `#17130F`
- Graphite elevated: `#252422`
- Secondary text: `#73685F`
- Border: `#EEE4DB`
- Success: `#1F8A5B`
- Success soft: `#EAF7F0`
- Warning: `#B56D0C`
- Warning soft: `#FFF4DF`
- Danger: `#C43E3E`
- Danger soft: `#FFF0F0`
- Info: `#3468D4`
- Info soft: `#EDF3FF`

Peach/coral background circles are a signature part of management pages. They must be visible enough to create depth but must remain decorative, pointer-inert, and behind actionable content.

### Typography

- Display / headings: Sora, 600–700
- Operational UI/body: IBM Plex Sans, 400–600
- Money, SKUs, timestamps, IDs, data labels: IBM Plex Mono, 400–500

Use `next/font/google` so typography is bundled by Next.js and no font files are distributed separately.

### Shape and elevation

- Compact controls: 8–10px radius
- Cards/panels: 14–18px radius
- Pills: full radius
- Management cards use restrained warm shadows rather than blue/gray shadows.
- POS uses darker, flatter surfaces and stronger border contrast to preserve appliance-like clarity.

## Architecture

The redesign will be implemented as a shared presentation layer, not copied page-by-page from Figma absolute coordinates.

### Shared shell

`AppShell` remains the authenticated application frame but is rewritten to match the premium sidebar/topbar. It will retain the existing navigation and route behavior. The shell owns:

- premium sidebar
- mobile navigation
- branch/business context
- online/offline state display
- decorative background geometry
- page content slot

### Shared UI primitives

The current `ui.tsx` primitives will be upgraded and extended instead of introducing an unrelated component library. Shared primitives should cover:

- Card / Panel
- MetricCard
- SectionHeader / PageHeader
- PrimaryButton / GhostButton / DangerButton
- StatusPill
- Field / Select styling
- Empty, loading, error, and permission states
- data table chrome

### Charts

`apps/web/src/lib/charts.tsx` becomes the shared chart layer. Charts stay dependency-light and SVG-based unless the existing codebase later adopts a chart library. Required primitives:

- vertical bar chart
- grouped bar chart
- horizontal bar chart
- donut chart
- heatmap
- accessible labels/descriptions for all chart SVGs

Charts must receive real values from API responses or deterministic transformations of them.

## Route Mapping

### Dashboard

Preserve the existing overview endpoint and controls. Restyle the KPI row, sales performance, attention/store health, quick actions, top products, and sync/connectivity states. If a Figma widget cannot be backed by existing data, keep an existing supported operational panel rather than filling the gap with sample values.

### POS

Retain all current cart, register, customer, hold, payment, offline queue, idempotency, receipt, and PAYMENT_UNKNOWN handling. Only the composition changes: premium outer chrome, dark cashier workspace, product grid, high-contrast cart rail, and focused payment dialog/surface. Responsive tablet behavior follows the Figma tablet frame.

### Products & Inventory

Retain current CRUD/search/filter data flows. Use premium summary cards and tables. Inventory risk states must remain text-backed, not color-only. Cost values remain permission-aware.

### Sales & Reports

Use the graph-rich designs as canonical. Existing reporting APIs already provide sales series, payment mix, product performance, branch comparison, inventory, and cash reports. Graphs that require data not currently exposed must not be fabricated. Where possible, compose supported charts from existing endpoints; otherwise show an explicit unavailable/unsupported state or retain an existing supported chart.

### Customers & Shifts

Preserve customer search/history semantics and shift open/close behavior. Shift close must continue to treat expected cash, counted cash, variance, actor, and timestamp as audit-sensitive values.

### Branches, Billing, Sync & Devices

Preserve existing permissions, plan limitations, device/sync semantics, and retry/reconciliation behavior. The redesign must not make queued/offline/recovered states look final when they are not.

### Login & Onboarding

Login follows the privacy-first Figma design. No sales totals, order counts, cash amounts, branch performance, customer data, inventory values, or real-looking business metrics may appear before authentication.

Onboarding should visually match the approved premium setup flow, but existing backend-supported setup actions remain authoritative. UI fields that are not persisted by current APIs must not pretend to save successfully; either connect them to real settings endpoints or present them only where current product behavior supports them.

## Data and Security Rules

- Never hardcode sample business figures into production authenticated pages as if they are live data.
- Never expose actual business financial/operational data before authentication.
- Preserve role-based cost visibility and permission handling.
- Preserve idempotency and PAYMENT_UNKNOWN behavior exactly.
- Preserve offline queue semantics and provisional receipt labeling.
- A failed or unknown operation must not be visually represented as successful.

## Responsive and Accessibility Requirements

- Desktop management target: 1280–1440px wide.
- Tablet POS target: 1024px wide.
- Mobile: stack cards/tables intentionally; do not rely on shrinking the desktop canvas.
- Primary controls maintain at least 44px effective hit height where practical.
- Visible keyboard focus is required.
- Status must never rely on color alone.
- Charts need accessible `title`/`desc` or equivalent labels.
- Respect `prefers-reduced-motion`.
- Decorative background shapes must be hidden from assistive technology.

## Testing and Verification

Implementation uses Vitest for deterministic component/helper tests plus TypeScript and Next.js build verification. Visual verification compares rendered application screens against the Figma screenshots; screenshots are references only and are never embedded as implementation assets.

Required final verification:

- `pnpm --filter @pos/web test`
- `pnpm --filter @pos/web typecheck`
- `pnpm --filter @pos/web build`
- inspect key desktop screens at 1440px and POS at 1024px tablet width
- confirm no temporary Figma asset URLs appear in source
- confirm login source contains no pre-auth business metrics
