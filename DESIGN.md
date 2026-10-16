---
version: alpha
name: "NexPOS"
description: "Premium retail-operations workspace with warm paper surfaces, coral operational accents, and a dark appliance-like POS."
colors:
  primary: "#F35D3F"
  canvas: "#FCF8F3"
  surface: "#FFFFFF"
  surface-subtle: "#F7F1EA"
  coral: "#F35D3F"
  coral-hover: "#D94A30"
  coral-soft: "#FFF0EA"
  graphite: "#17130F"
  graphite-raised: "#252422"
  text-secondary: "#73685F"
  border: "#EEE4DB"
  success: "#1F8A5B"
  success-soft: "#EAF7F0"
  warning: "#B56D0C"
  warning-soft: "#FFF4DF"
  danger: "#C43E3E"
  danger-soft: "#FFF0F0"
  info: "#3468D4"
  info-soft: "#EDF3FF"
typography:
  display:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
  sans:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
rounded:
  DEFAULT: "0.625rem"
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.875rem"
  xl: "1rem"
  panel: "1.125rem"
spacing:
  page-max: "77.5rem"
  shell-gap: "1.25rem"
  panel-gap: "1rem"
  section-gap: "1.25rem"
components:
  shell: { }
  panel: { }
  metric-card: { }
  button: { }
  field: { }
  table: { }
  chart: { }
  pos-workspace: { }
---

# NexPOS Design System

## Overview

### Creative North Star

NexPOS should feel like a well-run retail counter translated into software: warm receipt paper and ledger surfaces around a precise graphite transaction appliance. The management application is calm, bright, and editorial; the cashier workspace is darker, denser, and more tactile.

### Product context and register

- Audience and primary job: retail owners, managers, cashiers, and inventory staff operating a POS and the surrounding business workflows.
- Target market(s) and evidence: current repository behavior is Philippine Peso and Philippine retail oriented.
- Locale(s) and language policy: English UI; Philippine Peso formatting uses en-PH. User-entered names/content remain as entered.
- Usage scene: repeated daily use on 1280–1440px management desktops and 1024px POS tablets, often under time pressure.
- Register: hybrid. Authenticated management pages are product/admin; Login carries more brand expression; POS is an appliance-like operational surface.
- Memorable signature: visible peach/coral circular geometry behind floating white management surfaces, paired with a dark charcoal POS workspace.
- Restraint: transactional controls, tables, shift close, sync states, billing, and reconciliation prioritize legibility and state certainty over decoration.
- Anti-references: generic blue/navy SaaS dashboards; gradient-heavy fintech; glassmorphism over dense operations; decorative sparklines that do not encode real data.
- Token ownership/runtime mapping: this file records approved visual intent. Runtime implementation is apps/web/src/app/globals.css, apps/web/src/components/AppShell.tsx, apps/web/src/components/ui.tsx, and apps/web/src/components/premium.tsx. Figma file xr66O7yTaG0bhMhDI2UI7R remains the canonical visual reference.

## Colors

Canvas, surface, and surface-subtle create the warm paper hierarchy. Coral is the expressive/action color and must not replace semantic status colors. Graphite is primary text; graphite-raised is the dominant POS/product-tile surface.

Status colors are semantic and always paired with text or iconography. Focus uses coral. Charts use coral first, warm neutral comparison tones second, and semantic blue/green only when they encode a distinct series or status. No gradients are part of the core product language.

## Typography

Sora is reserved for page titles, key totals, major card values, and brand marks. IBM Plex Sans is the operational UI face. IBM Plex Mono is used for money, timestamps, SKUs, request IDs, receipts, data labels, and compact technical captions.

Use sentence case for actions and labels. Dense identifiers may use uppercase mono eyebrows. Avoid all-caps body copy.

Fonts are loaded through next/font/google; font files are not checked into or distributed from the repository.

## Layout

Management pages target a 1240px content column inside a floating shell. At xl widths the shell uses a persistent sidebar; below xl the sidebar collapses into the top navigation so the 1024px POS tablet remains full-width.

Cards stack deliberately at smaller widths. Tables may scroll horizontally when column meaning would be lost by aggressive compression. Do not shrink desktop canvases uniformly.

The decorative peach/coral circles are viewport-level background geometry, pointer-inert and aria-hidden.

## Elevation & Depth

Management cards use warm, low-contrast shadows plus thin #EEE4DB borders. The topbar and sidebar float slightly above the canvas. POS is flatter and relies more on charcoal tonal separation and borders.

Avoid stacking multiple heavy shadows. Modals may use stronger elevation because they interrupt the active workflow.

## Shapes

Controls use roughly 8–10px radii, panels 14–18px, and statuses/filters may use pills. Rounded geometry should feel precise rather than bubbly.

Icon chips are compact rounded squares. Dividers remain subtle warm neutrals.

## Components

### Foundational visual states

Hover slightly increases contrast/elevation without moving core layout. Focus-visible uses a coral ring. Disabled controls retain readable labels and do not look successful. Busy states preserve control geometry. Error/warning/success states use semantic text plus tone.

### Buttons and actions

Primary action = coral fill. Secondary action = white surface with warm border. Destructive action = danger-soft with danger text/border. Button copy names the action outcome directly.

### Navigation and data display

The active sidebar item uses coral-soft, a coral rail, and a compact icon chip. Tables use mono uppercase headers and warm row dividers. Charts are sparse, labeled, and always backed by real API values or deterministic transformations.

### Forms and overlays

Fields are white with warm borders and coral focus rings; POS fields use charcoal surfaces. Validation is explicit and close to the affected field or operation. Payment/reconciliation overlays preserve entered state after recoverable failure.

### Iconography

Current implementation uses lightweight typographic glyphs and symbols. Icons never replace critical text labels for irreversible or financial actions.

### Motion

Motion is restrained: short rise/hover transitions and focused state feedback. Routine dashboard decoration does not animate continuously. prefers-reduced-motion disables nonessential transitions.

### Content and data visualization

Voice is operational, concise, and specific. Unknown/pending/offline states are named directly. Money uses tabular mono formatting. No chart or KPI may fabricate a business value to visually fill a Figma placeholder.

## Do's and Don'ts

- Do: keep management pages warm, calm, and clearly layered.
- Do: make POS faster and darker than management pages while preserving the same coral identity.
- Do: use real data and explicit unavailable states.
- Don't: reintroduce generic blue/navy SaaS chrome.
- Don't: use random decorative trend strokes, fake metrics, gradients, or color-only status.
- Don't: expose business financial, customer, employee, or inventory figures before authentication.

## Atlas 2026 V4 operational surfaces

### Atlas V4 cashier sale workspace

- The active `/pos` route now opts into the light Atlas cashier treatment
  (Figma 66:3): 78px dark `#252E2B` sale rail at desktop widths, coral
  NexPOS mark, light `#F7F8F5` product surface, white editable current-sale
  panel and `#DA614C` payment CTA. The payment-method chooser uses the
  light modal treatment from Figma 66:964; disabled tender methods remain
  disabled if the server/provider has not enabled them.
- Product imagery must come from the owner's real catalog `imageUrl` data;
  use accessible name/initials fallbacks when missing. Never ship Figma's
  example photos, product names, inventory quantities or demo monetary
  values as actual business data. The UI must never fake stock availability.
- Existing POS sale creation, hold/resume, discounts, manager approvals,
  PayMongo webhook settlement, offline handling, cart order and receipt
  totals remain authoritative and separate from visual presentation.
- On smaller screens the cashier retains the accessible V4 mobile header
  and navigation, with a light cart tray/drawer and a keyboard-accessible
  payment method modal. Test 390 / 820 / 1024 / 1280 / 1440px.
- **P5 accessibility refinement:** Keep Figma's coral `#DA614C` as a
  decorative accent where appropriate, but use darkened `#B84F3C` for
  normal-sized white-on-coral POS action labels (at least 4.5:1 contrast).
  Use `#53615A` instead of lighter `#71807A` / `#748078` for small text
  on white or `#F7F8F5` POS surfaces. Payment workflow labels on white
  use `#B04A39` rather than light coral. Contrast is measured from browser
  computed styles, not accepted solely from design-token names.

Figma Atlas V4 is an **additional, role-specific operational layout** within NexPOS,
not permission to replace the existing POS transaction engine or invent example
transactions. The older cream/coral direction above still applies to routes not
yet designated as Atlas V4. The source file is
`xr66O7yTaG0bhMhDI2UI7R` (Owner 95:2, Approvals 97:2, Inventory 98:273,
Guest/Platform 99:2, Responsive QA 100:2).

- **Tokens:** V4 canvas `#F7F8F5`, white surfaces, primary text `#202826`,
  dark action `#29332D`, subdued text `#748078`, lines `#E5E9E3`,
  owner/approvals accent `#DA614C`, inventory/verified accent `#267552`.
  Heading font is Sora; operational text uses IBM Plex Sans; data/receipts
  use IBM Plex Mono. Status still needs a text label in addition to color.
- **Desktop shells:** owner sidebar 239px; approvals sidebar 230px; inventory
  sidebar 226px; platform sidebar 233px. Major desktop headers are approximately
  78–80px high; content is fluid rather than a scaled 1440px screenshot.
- **Manager administration (Atlas P4):** `/admin` uses a 228px manager
  workspace rail, V4 canvas and accessible task cards for real approvals,
  sales, inventory, procurement, shifts and reporting. Owners retain their
  239px control shell and broader account shortcuts. Do not display the sample
  financial figures in Figma frame 63:62 as live metrics. Manager and
  non-management roles must not receive owner-only links or grants.
- **Atlas mobile shell:** 77px white header, 42px dark square NexPOS mark,
  visible role badge and a minimum 44px menu disclosure. Navigation,
  active-branch selection, tour controls and sign-out are reachable from the
  expanded menu. Escape closes it and returns focus to the disclosure.
  The mobile concept frames are 100:3 (employee access), 100:34 (approvals),
  100:64 (receipt complaint), and 100:88 (guest support).
- **Real workflow states:** employee access uses actual role/branch/register
  restrictions, not fabricated permission labels. Approvals display scoped
  queued records, or an explicit empty/error state. Receipt complaints use
  verified purchases, eligible quantities and idempotent manager review.
  Guest support uses an authenticated-by-token order-status link; never
  substitute a typed reference number for verification. Mobile submit/review
  actions use a reachable, minimum 53px control, without covering content.
- **Implementation boundaries:** reuse existing server-approved grants,
  sales/refunds, stock counts, purchase/receiving and guest order status.
  Separate design-only inventory lot/expiry and platform controls from
  backend capabilities that actually exist; do not display mock data as live
  truth or silently add APIs. Approval must not execute a protected action.
  Never change financial or inventory authority, PayMongo settlement rules,
  or cross-tenant isolation merely to reproduce a Figma frame.
- **Acceptance:** verify role-aware access, privacy, keyboard/focus, reduced
  motion, loading/empty/error/retry states and 390/820/1024/1280/1440px
  viewport behavior. Operational content may be taller than a fixed Figma
  example because valid product lines and customer cases cannot be truncated.
