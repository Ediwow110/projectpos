# NexPOS Deep System Audit — 2026-09-29

## Scope

This audit covers the authenticated product shell, POS checkout, sales/refunds, products/categories, inventory, registers/shifts, customers, branches/transfers, reports, sync/devices, onboarding, permissions, payments, receipt/printing APIs, SaaS/billing APIs, PostgreSQL persistence, offline flows, responsive behavior, accessibility contracts, and first-run guidance.

The product was also benchmarked against current official documentation for Shopify POS, Square for Retail, Lightspeed Retail, and Loyverse. The goal is not feature parity for its own sake; the benchmark identifies retail workflows that mature POS products make first-class because store staff repeatedly need them.

## Current POS benchmark matrix

| Workflow | Current market pattern | NexPOS status | Audit conclusion |
| --- | --- | --- | --- |
| First login / guided setup | Shopify shows POS introduction screens; Square exposes a reusable Setup Guide | Previously missing after business onboarding; implemented in this audit | Necessary for discoverability and training reduction |
| Saved/open carts | Shopify POS exposes saved/recent carts with staff permissions; Loyverse exposes open tickets | Phase B adds a cashier-facing Held sales queue that resumes the original draft | Implemented baseline; labels/search/cancel handoff remain future refinements |
| Manager approval | Shopify can require manager approval/PIN for returns and other protected POS actions | Phase B adds business-scoped six-digit owner/manager PIN enrollment plus in-context approval for over-threshold POS discounts | Implemented discount/PIN baseline; expansion to other protected actions remains future work |
| Returns and exchanges | Mature retail POS supports return/exchange directly from order context | Phase B adds a linked cash-settled exchange flow from sale detail | Implemented cash baseline; provider-side electronic-tender exchanges remain future work |
| Purchase orders / vendors | Square, Lightspeed, and Loyverse make supplier/vendor ordering and receiving first-class inventory workflows | No supplier/vendor/PO schema | Largest inventory lifecycle gap; P0 |
| Receiving / stock counts | Retail POS systems support bulk receiving, partial PO receive, and physical counts | Manual inventory movements exist; transfer receiving exists; no PO receiving/count sessions | P0/P1 |
| Multi-location operations | Current retail POS keeps device/location, staff access, inventory, transfers, and reporting location-aware | Phase A added server-backed active branch context and scoped POS/inventory behavior | Implemented baseline; branch assignment remains a separate domain concern |
| Staff management | Retail POS exposes staff roles, PINs/access, and location assignment | Phase A added owner-facing Team management; Phase B adds approval-PIN enrollment for owners/managers | Implemented approval-PIN baseline; branch assignment, workforce PIN/time tracking, and invite/reset UX remain future work |
| Discounts / overrides | Retail POS applies line/order discounts with permission or manager approval | Phase B adds fixed-PHP line/order discounts plus one-use manager approval by staff PIN or password fallback | Implemented baseline |
| Device management | Retail POS setup includes device/location readiness and device controls | Phase A added Device Fleet list/enroll/revoke UI and current-device/session-impact handling | Implemented baseline; last-seen/online telemetry is not modeled |
| Printers / hardware | Setup guides make printer/device configuration discoverable | Phase B adds printer enrollment/settings/default/test/presence/queue/requeue plus branch-aware receipt printing | Implemented baseline; physical print acknowledgement and richer agent installer UX remain future work |
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
- Device enrollment/revocation API, customer display token API, API-token API, billing/plan API, and platform support controls. Printer/print-job APIs are now surfaced through the Phase B Printers workspace.
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

### 4. Fast manager approval at POS — discount baseline implemented in Phase B

Granular permissions exist for discount override, refund/void, inventory adjustment, shift close override, and settings/user management. Phase B now provides the first in-context supervisor approval path for over-threshold POS discounts without transferring the manager's permission to the cashier.

Implemented flow: owner enrolls/rotates a six-digit approval PIN for an active owner/manager in Team → cashier triggers a protected discount → app-owned Manager approval overlay defaults to email + approval PIN, with account password as explicit fallback → server issues a two-minute, one-use approval grant bound to that business, cashier, permission, and exact discounted cart → original Hold/Pay retries automatically → audit records the cashier sale plus a separate approving-manager row.

The approval PIN is stored only as an Argon2id hash on the business membership and is never returned by membership APIs. The grant token is separately opaque and hashed at rest; it cannot be replayed on a different cart and is consumed on use. Wrong PIN/password does not reveal whether an account or role exists, approval attempts keep the existing server rate limit, PIN/hash fields are redacted from log context, and credentials are not persisted in browser storage. Equivalent in-context approval for void/refund/other protected actions remains explicit follow-up work rather than being marked complete.

### 5. POS discounts — implemented baseline in Phase B

The POS now exposes an app-owned Sale discounts dialog for fixed-PHP order and per-line discounts. Discount values travel through draft, hold/resume, payment, receipt, reporting/refund line totals, and remain server-authoritative. A resumed held draft restores its saved discounts and stays locked against client-side editing.

The existing override policy remains authoritative: order discounts above 10% or line discounts above 20% require `discount.override`. The cashier never receives that permission; an over-threshold attempt transitions into the one-use manager approval dialog. Discounted offline checkout is blocked so approval-sensitive discounts are never queued for later sync failure.

### 6. Active branch/register context must be authoritative — implemented in Phase A

The shared shell now uses a server-backed session branch context instead of hard-coded `Main branch`. Branch selection persists on the authenticated session, rejects foreign/inactive branches, clears on business switch, falls back to All branches when the stored branch becomes invalid, and scopes POS registers plus inventory queries.

Further branch-assignment policy for staff/devices remains a separate domain decision and is not inferred client-side.

### 7. Device fleet UI should use the API that already exists — implemented in Phase A2

At audit start, GET /devices and revoke APIs existed while the Sync page said a device fleet list was unavailable and only exposed enrollment.

Implemented baseline: owners/managers can view the business device fleet; other staff see the server-authorized subset. Device Fleet owns registration, active/revoked state, current-browser marker, revoke confirmation, and session-impact handling. Sync is now focused on offline replay/conflict recovery. Last-activity telemetry is not yet modeled.

### 8. Navigation / information architecture — implemented baseline in Phase A2

At audit start, Categories, Registers, Expenses, and Transfers were implemented routes but were not first-class shell navigation.

Implemented baseline: role-aware grouped navigation now exposes Categories, Registers, Expenses, Transfers, Team, Devices, Branches, Printers, Administration / Help, and existing primary workflows. The Administration landing links only to implemented destinations and can restart the system tour. Broader business settings such as payments, API tokens, billing, and security sessions remain future work.

### 9. Purchasing and replenishment

The schema has no supplier/vendor or purchase-order model. For a serious retail POS this is the largest inventory lifecycle gap.

Required baseline: suppliers → purchase order → partial/full receiving → stock/cost update → receiving discrepancy → supplier return/cancel → PO history. Reorder levels should be able to create purchasing suggestions.

### 10. Returns/exchanges at the register — cash baseline implemented in Phase B

Owners and managers can now open a completed/partially-refunded cash sale, choose exact remaining return quantities, search active replacement products, review the estimated return/replacement/net values, and complete the exchange from the transaction detail. The backend revalidates historical refundable value, current replacement price/tax, current stock, open shift, and refund thresholds before committing.

Each exchange links an approved refund to a completed replacement sale and persists the relationship in exchange history. The original sale links to the replacement transaction, while the replacement sale exposes the original receipt and a direct backlink, so the exchange remains traceable from either side. The shift records the gross cash refund and gross replacement sale, so their combined effect equals the customer-facing net collect/refund difference while sales/refund reporting remains consistent with the existing domains. Exchange execution is idempotent and PostgreSQL-wrapped in one transaction, so refund, replacement, inventory, cash, audit, and exchange linkage roll back together on failure.

This baseline intentionally accepts only cash-settled source sales. Card, GCash, Maya, QR Ph, bank-transfer, or mixed-tender exchanges are not simulated because provider-side refund/exchange settlement is not yet modeled.

## P1 — high-value retail capabilities

- Product variants (size/color/etc.) and optionally bundles/kits/composite products.
- Barcode label printing and richer scanner-driven receiving/counting.
- Full/partial physical inventory counts with variance review and approval.
- Gift cards and store credit; loyalty points/rewards if customer retention is in product scope.
- SMS receipt delivery remains future provider work; email plus secure share-link delivery is implemented.
- Physical printer acknowledgement/agent installer polish remains future work; enrollment, branch/default configuration, presence, test prints, receipt queueing, and requeue are implemented.
- Low-stock notification center / replenishment inbox instead of relying only on inventory/report views.
- Required customer/contact fields configured per business when a workflow needs them.
- Separate workforce clock-in/time-tracking PINs if NexPOS will own attendance operations; the new approval PIN is intentionally scoped only to protected POS authorization.
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

Phase A closes the hidden-route gap with role-aware grouped navigation and adds a dedicated Administration / Help landing. Phase B now exposes Held sales and Discounts in the cashier workspace, direct cash exchanges from sale detail, receipt delivery from the recorded receipt, and printer administration from both navigation and Administration / Help. Remaining discoverability work is deeper help/settings coverage for future domains and completion of workflows such as purchasing.

### Validation consistency

The app-owned validation cleanup is now complete for audited forms, and the strict premium UI audit reports zero findings. New cashier dialogs, including Held sales and Sale discounts, follow the same app-owned modal/inline-validation contract rather than browser-native validation bubbles.

### Help / administration ownership

Phase A added a dedicated Administration / Help landing with Team, Devices, Branches, Registers, system-tour restart, and a route back to POS. Phase B now adds Printers. Payment configuration, API tokens, business/receipt settings, billing, and security sessions should be added only when those management surfaces are implemented.

## Recommended delivery phases

### Phase A — usability completion

Implemented baseline: first-run role-aware tour, grouped navigation, authoritative active branch context, Administration / Help landing, Device Fleet UI, and Team UI. Standardizing app-owned validation across older management forms remains an explicit follow-up rather than being marked complete.

Verification on 2026-09-30: web unit/component 144/144, API 441/441, PostgreSQL 135/135, typecheck/lint/build passed, production dependency audit reported no known vulnerabilities, and the complete Playwright desktop/tablet/mobile matrix passed 90/90 after updating stale E2E assumptions for the 7-step owner tour, the Device Fleet route, and branch-card visibility.

### Phase B — cashier workflow completion

Implemented baselines: Held-sale queue/resume, fixed-PHP POS line/order discounts with server-enforced override thresholds, business-scoped six-digit owner/manager approval PIN enrollment with password fallback, one-use approval grants for over-threshold discounts, direct cash-settled exchanges with linked return/replacement transactions, email/secure-link receipt delivery, and printer enrollment/branch/default/test/queue/requeue management. Remaining Phase B work: approval expansion to other protected actions, provider-backed electronic-tender exchanges, SMS receipt delivery/provider integration, physical-print acknowledgement/agent installer polish, and broader receipt-template/settings UX.

Receipt/printer verification on 2026-10-01: validation 75/75, web unit/component 167/167, API 463/463, PostgreSQL 141/141, typecheck/lint/build passed, strict premium UI audit reported zero findings, production dependency audit reported no known vulnerabilities, the focused desktop/tablet/mobile receipt+printer matrix passed 6/6, and the final complete Playwright matrix passed 108/108. During verification, one real mobile race was found and fixed: if printer data arrived after the receipt print dialog opened, the native select could visually show the default printer while React still held an empty selection, leaving Queue receipt disabled. Three unrelated 5-second navigation assertions also proved load-sensitive under the parallel dev-server run; each case passed independently and the waits were hardened before the clean 108/108 rerun.

Approval-PIN verification on 2026-09-30: validation 73/73, web unit/component 163/163, API 455/455, PostgreSQL 138/138, typecheck/lint/build passed, strict premium UI audit reported zero findings, production dependency audit reported no known vulnerabilities, PIN persistence/logging anti-pattern scan was clean, and the complete desktop/tablet/mobile Playwright matrix passed 102/102. Browser coverage includes Team PIN enrollment, wrong-PIN recovery, successful PIN approval with automatic sale retry, and confirmation that neither the owner password nor approval PIN appears in browser storage.

Exchange verification on 2026-09-30: validation 72/72, web unit/component 162/162, API 453/453, PostgreSQL 137/137, typecheck/lint/build passed, strict premium UI audit reported zero findings, production dependency audit reported no known vulnerabilities, and the complete desktop/tablet/mobile Playwright matrix passed 102/102. The live browser flow covers return selection, replacement search, net collection preview, transaction completion, original-to-replacement navigation, and the replacement-to-original receipt backlink.

Manager-approval verification on 2026-09-30: validation 70/70, web unit/component 159/159, API 447/447, PostgreSQL 136/136, typecheck/lint/build passed, strict premium UI audit reported zero findings, production dependency audit reported no known vulnerabilities, approval anti-pattern grep was clean, and the complete desktop/tablet/mobile Playwright matrix passed 99/99. The browser test covers wrong-manager-credential recovery, successful one-use owner approval, automatic retry of the original cashier payment, and confirmation that the manager password is absent from browser storage.

Discount verification on 2026-09-30: web unit/component 155/155, API 443/443, PostgreSQL 135/135, typecheck/lint/build passed, strict premium UI audit reported zero findings, production dependency audit reported no known vulnerabilities, and the complete desktop/tablet/mobile Playwright matrix passed 99/99. Browser coverage includes both an exactly-at-threshold discounted sale and a cashier over-threshold denial from the authoritative server.

### Phase C — inventory lifecycle

Suppliers/vendors, purchase orders, receiving, supplier returns, physical counts, barcode labels, replenishment alerts/suggestions, variants/bundles.

### Phase D — retention and integrations

Gift cards/store credit, loyalty, omnichannel/e-commerce connectors, accounting connectors, richer customer engagement.

## Audit rule for future work

Do not add a feature only as an API or hidden route. Every operational capability should have a discoverable entry point, a complete beginning-to-end workflow, permission/error/loading/empty states, and browser verification on the form factors where store staff will use it.
