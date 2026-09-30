# NexPOS Deep System Audit — 2026-09-29

## Scope

This audit covers the authenticated product shell, POS checkout, sales/refunds, products/categories, inventory, registers/shifts, customers, branches/transfers, reports, sync/devices, onboarding, permissions, payments, receipt/printing APIs, SaaS/billing APIs, PostgreSQL persistence, offline flows, responsive behavior, accessibility contracts, and first-run guidance.

The product was also benchmarked against current official documentation for Shopify POS, Square for Retail, Lightspeed Retail, and Loyverse. The goal is not feature parity for its own sake; the benchmark identifies retail workflows that mature POS products make first-class because store staff repeatedly need them.

## Current POS benchmark matrix

| Workflow | Current market pattern | NexPOS status | Audit conclusion |
| --- | --- | --- | --- |
| First login / guided setup | Shopify shows POS introduction screens; Square exposes a reusable Setup Guide | Previously missing after business onboarding; implemented in this audit | Necessary for discoverability and training reduction |
| Saved/open carts | Shopify POS exposes saved/recent carts with staff permissions; Loyverse exposes open tickets | Phase B adds a cashier-facing Held sales queue that resumes the original draft | Implemented baseline; labels/search/cancel handoff remain future refinements |
| Manager approval | Shopify can require manager approval/PIN for returns and other protected POS actions | Permissions exist, but no in-context supervisor approval UX | P0 flow gap |
| Returns and exchanges | Mature retail POS supports return/exchange directly from order context | Refund request/approve/reject exists; exchange does not | Add exchange as P0/P1 cashier flow |
| Purchase orders / vendors | Square, Lightspeed, and Loyverse make supplier/vendor ordering and receiving first-class inventory workflows | No supplier/vendor/PO schema | Largest inventory lifecycle gap; P0 |
| Receiving / stock counts | Retail POS systems support bulk receiving, partial PO receive, and physical counts | Manual inventory movements exist; transfer receiving exists; no PO receiving/count sessions | P0/P1 |
| Multi-location operations | Current retail POS keeps device/location, staff access, inventory, transfers, and reporting location-aware | Phase A added server-backed active branch context and scoped POS/inventory behavior | Implemented baseline; branch assignment remains a separate domain concern |
| Staff management | Retail POS exposes staff roles, PINs/access, and location assignment | Phase A added owner-facing Team management over the existing membership API | Implemented baseline; branch assignment and invite/reset UX remain future work |
| Discounts / overrides | Retail POS applies line/order discounts with permission or manager approval | Backend supports discounts/override; POS sends zero discounts | P0 UI/domain disconnect |
| Device management | Retail POS setup includes device/location readiness and device controls | Phase A added Device Fleet list/enroll/revoke UI and current-device/session-impact handling | Implemented baseline; last-seen/online telemetry is not modeled |
| Printers / hardware | Setup guides make printer/device configuration discoverable | Printer and print-job APIs exist; no management surface | P1 |
| Product variants / bundles | Lightspeed/Square/Shopify commonly model variations and richer item structures | Basic product model only | P1 for apparel/retail breadth |
| Gift card / loyalty | Square/Loyverse/Shopify ecosystems offer stored value and loyalty | Not modeled | P1/P2 depending target market |
| Offline operation | Leading POS products explicitly explain offline capabilities/limits and sync behavior | Strong cash-only offline queue/reconciliation with visible sync states | Current strength; preserve and simplify messaging |

### Benchmark interpretation

NexPOS should not copy every competitor feature. The immediate goal is to complete the workflows already implied by its own domain: users should never encounter an API-only capability, a hidden route, or an action that leaves them with an identifier but no next screen. Purchase/replenishment is the major new retail domain that is genuinely absent; most other P0 work is completing or exposing capabilities that already partly exist.

## Current strengths verified in the codebase

- Safe payment lifecycle: cash plus PayMongo Card, GCash, Maya, and QR Ph; payment uncertainty is not silently presented as success.
- Idempotent sales/payment handling and signed PayMongo webhook validation.
- Offline cash sale queue, reconnect replay, conflict resolution, and provisional receipt behavior.
- Inventory balances/movements, reorder levels, branch-aware stock, transfers, and stock restoration for refunds/voids.
- Register/shift opening, cash movements, close/variance, corrections, and audit-friendly immutable financial workflows.
- Customers, sales history, refund request/approval/rejection, receipt/share/download, and multiple operational reports.
- Role-based permissions for owner, manager, cashier, and inventory staff; server-side authorization remains authoritative.
- Multi-branch domain and reporting support.
- Device enrollment/revocation API, printer/print-job API, customer display token API, API-token API, billing/plan API, and platform support controls.
- Responsive POS/cart/payment surfaces and dedicated desktop/tablet/mobile E2E projects.

## P0 — necessary product-flow gaps

### 1. Real setup instead of completion-only onboarding

Current onboarding is structurally sound but the tax/currency and receipt steps mostly record `done` state. The first-run flow should configure the actual business settings it claims to prepare: tax defaults, currency rules, receipt header/footer/behavior, first register, branch, payment methods, and optionally first product/team member.

### 2. Held-sale retrieval — implemented baseline in Phase B

POS now exposes a visible Held sales queue directly from the cashier workspace. A seller can hold the current draft, see their own held carts with customer/item/total context, resume the original draft without cloning it, and either complete payment or re-hold it. Saved item order, register, branch, customer/walk-in context, and original sale identity are preserved. Offline resume is blocked and branch mismatch requires an explicit branch switch.

Future refinements remain: optional labels, search/filter, explicit cancel/expiry workflows, and audited handoff between permitted staff. These are not marked complete.

### 3. Staff/team management UI — implemented in Phase A2

At audit start, membership list/create/deactivate APIs already existed without an owner-facing Team screen, and the onboarding Employees step explicitly acknowledged the gap.

Implemented baseline: owner-facing Team screen with active memberships, role assignment, temporary credential handoff for new users, deactivation confirmation, and permission explanation. Branch assignment and secure invite/reset remain future work.

### 4. Fast manager approval at POS

Granular permissions exist for discount override, refund/void, inventory adjustment, shift close override, and settings/user management. What is missing is an in-context supervisor approval interaction for high-risk register actions.

Recommended flow: cashier triggers protected action → manager PIN/passcode/reauth overlay → action executes as approved-by manager → audit records cashier, approver, reason, amount/threshold.

### 5. Discounts are backend-only from POS

The sale domain supports line and order discounts plus override thresholds, but the current POS draft maps every cart line with zero discount. Add line discount and order discount controls, with visible authorization state and manager approval above thresholds.

### 6. Active branch/register context must be authoritative — implemented in Phase A

The shared shell now uses a server-backed session branch context instead of hard-coded `Main branch`. Branch selection persists on the authenticated session, rejects foreign/inactive branches, clears on business switch, falls back to All branches when the stored branch becomes invalid, and scopes POS registers plus inventory queries.

Further branch-assignment policy for staff/devices remains a separate domain decision and is not inferred client-side.

### 7. Device fleet UI should use the API that already exists — implemented in Phase A2

At audit start, GET /devices and revoke APIs existed while the Sync page said a device fleet list was unavailable and only exposed enrollment.

Implemented baseline: owners/managers can view the business device fleet; other staff see the server-authorized subset. Device Fleet owns registration, active/revoked state, current-browser marker, revoke confirmation, and session-impact handling. Sync is now focused on offline replay/conflict recovery. Last-activity telemetry is not yet modeled.

### 8. Navigation / information architecture — implemented baseline in Phase A2

At audit start, Categories, Registers, Expenses, and Transfers were implemented routes but were not first-class shell navigation.

Implemented baseline: role-aware grouped navigation now exposes Categories, Registers, Expenses, Transfers, Team, Devices, Branches, Administration / Help, and existing primary workflows. The new Administration landing links only to implemented destinations and can restart the system tour. Broader business settings such as printers, payments, API tokens, billing, and security sessions remain future work.

### 9. Purchasing and replenishment

The schema has no supplier/vendor or purchase-order model. For a serious retail POS this is the largest inventory lifecycle gap.

Required baseline: suppliers → purchase order → partial/full receiving → stock/cost update → receiving discrepancy → supplier return/cancel → PO history. Reorder levels should be able to create purchasing suggestions.

### 10. Returns/exchanges at the register

NexPOS has a strong refund workflow, but no direct exchange flow. Retail staff should be able to find a sale, choose returned quantities, add replacement products, calculate the difference, and collect/refund the net amount while preserving one auditable transaction relationship.

## P1 — high-value retail capabilities

- Product variants (size/color/etc.) and optionally bundles/kits/composite products.
- Barcode label printing and richer scanner-driven receiving/counting.
- Full/partial physical inventory counts with variance review and approval.
- Gift cards and store credit; loyalty points/rewards if customer retention is in product scope.
- Receipt delivery by email/SMS and owner-configurable receipt templates using the existing receipt settings/print APIs.
- Printer setup UI and print queue visibility using existing printer APIs.
- Low-stock notification center / replenishment inbox instead of relying only on inventory/report views.
- Required customer/contact fields configured per business when a workflow needs them.
- Staff PIN/clock-in/time tracking if NexPOS will own workforce operations rather than integrate with a separate system.
- Global/help search and explicit clear buttons for searchable lists.
- Route-specific document titles and app-owned 403/access-denied pages.
- Standardized app-owned validation (`noValidate`, inline field errors, first-invalid-field focus) across management forms.
- Unsaved-change protection for longer create/edit workflows.

## P2 — expansion capabilities

- Omnichannel orders, pickup/ship-from-store, and e-commerce synchronization.
- Accounting/export integrations beyond raw CSV/API tokens.
- Customer segmentation/marketing integrations.
- Advanced lot/serial/expiry tracking for product categories that need traceability.
- Workforce scheduling/payroll if NexPOS deliberately expands beyond store operations.

Restaurant-specific kitchen display/table-service workflows are not a baseline recommendation because NexPOS is currently retail-oriented. Add them only if the target market expands into food service.

## User-experience findings

### First-run guidance

Implemented during this audit:

- One-time per-user guided system tour after required business onboarding.
- Skip, Close, and Finish all suppress automatic display.
- Server-backed `workspaceTourSeen` preference for cross-device behavior with a local resilience fallback.
- Manual `Restart system tour` control in the shared shell plus `Help · Restart tour` in the desktop sidebar.
- Role-aware, task-oriented sequences: owners/managers are guided through catalog → shift → sale → review; cashiers through shift → POS → sale lookup; inventory staff through catalog → stock → location/sync context.
- Modal background blocking, responsive target highlighting, and reduced-motion-safe progress.
- Keyboard-safe modal behavior: initial action focus, Tab containment, and Escape-to-close.

## Security / dependency audit

- Full application security/abuse contract tests remain part of the required verification matrix.
- The production dependency audit initially found one moderate advisory in transitive Multer 2.3.0 (CVE-2026-88932: aborted multipart uploads can leave orphaned disk files). NexPOS currently has no Multer/file-interceptor/disk-storage upload route, so no direct application path was found.
- The repository's existing Multer override was upgraded to 2.4.0, the patched release. A fresh production dependency audit reports no known vulnerabilities.
- No high or critical dependency advisories were present before the upgrade.

### Discoverability

Phase A closes the hidden-route gap with role-aware grouped navigation and adds a dedicated Administration / Help landing. Remaining discoverability work is deeper help/settings coverage for future domains and completion of workflows such as held sales and purchasing.

### Validation consistency

Many route-owned forms still omit the project's app-owned validation contract. Browser-native bubbles will feel inconsistent beside the custom premium UI and make field-error handling vary by browser.

### Help / administration ownership

Phase A added a dedicated Administration / Help landing with Team, Devices, Branches, Registers, system-tour restart, and a route back to POS. Payment configuration, printers, API tokens, business/receipt settings, billing, and security sessions should be added only when those management surfaces are implemented.

## Recommended delivery phases

### Phase A — usability completion

Implemented baseline: first-run role-aware tour, grouped navigation, authoritative active branch context, Administration / Help landing, Device Fleet UI, and Team UI. Standardizing app-owned validation across older management forms remains an explicit follow-up rather than being marked complete.

Verification on 2026-09-30: web unit/component 144/144, API 441/441, PostgreSQL 135/135, typecheck/lint/build passed, production dependency audit reported no known vulnerabilities, and the complete Playwright desktop/tablet/mobile matrix passed 90/90 after updating stale E2E assumptions for the 7-step owner tour, the Device Fleet route, and branch-card visibility.

### Phase B — cashier workflow completion

Held-sale queue/resume baseline is implemented. Remaining Phase B work: POS discounts, manager approval/passcode, direct exchange flow, receipt delivery, and printer setup.

### Phase C — inventory lifecycle

Suppliers/vendors, purchase orders, receiving, supplier returns, physical counts, barcode labels, replenishment alerts/suggestions, variants/bundles.

### Phase D — retention and integrations

Gift cards/store credit, loyalty, omnichannel/e-commerce connectors, accounting connectors, richer customer engagement.

## Audit rule for future work

Do not add a feature only as an API or hidden route. Every operational capability should have a discoverable entry point, a complete beginning-to-end workflow, permission/error/loading/empty states, and browser verification on the form factors where store staff will use it.
