# UX Contract

## Product context

- Audience: retail owners, managers, cashiers, and inventory staff.
- Primary jobs: complete sales safely; manage catalog/inventory/customers; reconcile shifts; review reports; manage branches, billing, and sync health.
- Target market(s): current repository behavior is PHP/Philippine retail oriented.
- Active locales: English UI with en-PH numeric/currency formatting.
- Language/content register: concise operational English; user-entered content is preserved.
- Timezone/calendar policy: API timestamps remain authoritative; UI uses browser/local display where existing routes already do so.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| POS/payment state and idempotency | docs/superpowers/specs/2026-09-23-phase4-pos-payments-design.md | Domain/API spec | 2026-09-26 |
| Register/shift reconciliation | docs/superpowers/specs/2026-09-23-phase5-registers-shifts-design.md | Domain/API spec | 2026-09-26 |
| Dashboard/report semantics | docs/superpowers/specs/2026-09-23-phase7-dashboard-reports-design.md | Domain/API spec | 2026-09-26 |
| Offline queue/provisional receipts | docs/superpowers/specs/2026-09-24-phase9b-offline-design.md | Domain/API spec | 2026-09-26 |
| Billing/entitlements | docs/superpowers/specs/2026-09-24-phase10-saas-design.md | Domain/API spec | 2026-09-26 |
| Premium visual migration | docs/superpowers/specs/2026-09-25-premium-ui-implementation-design.md | UI implementation spec | 2026-09-26 |

## Visual contract

- Project DESIGN.md: DESIGN.md
- Token ownership model: DESIGN.md records intent; runtime CSS/components are canonical implementation.
- Runtime design-system/token source: apps/web/src/app/globals.css, apps/web/src/components/ui.tsx, apps/web/src/components/premium.tsx, apps/web/src/components/AppShell.tsx.
- Mapping/export/adapters: direct CSS/Tailwind token mapping; no generated export step.
- Token drift gate: visual QA against Figma plus tests/typecheck/build; old navy/blue shell colors are disallowed in migrated shell code.
- Supported themes: light management shell; dark POS operational workspace.
- Design-context owner/review policy: system-level visual changes update DESIGN.md and runtime tokens/components together.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | native select styled by .field / .field-dark | DESIGN.md + route API contract | native | keyboard + route tests |
| Date | native date inputs where used | route/report API contract | native | locale + browser verification |
| Form | route-owned React forms using shared .field styles and server validation | domain/API specs | create / edit | unit + route/E2E where present |
| Scrollbar | apps/web/src/app/globals.css | DESIGN.md | geometry exceptions | computed/browser review |
| CRUD | existing route + apiFetch service behavior | domain/API specs | return / stay per existing flow | route/integration tests |

No global toast provider is currently canonical. Status, warnings, errors, payment uncertainty, and sync outcomes remain visible inline near the owning workflow.

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | labeled action | stronger contrast | coral focus ring | pressed by browser | readable, no action | geometry preserved | nearby inline error |
| Icon button | icon + accessible name | stronger contrast | coral focus ring | pressed | muted | n/a | n/a |
| Input | warm border | darker warm border | coral ring | n/a | browser disabled | preserve value | inline/server message |
| Secret input | masked | n/a | coral ring | show/hide explicit | n/a | n/a | auth alert |
| Search | explicit placeholder | n/a | coral ring | query/filter | disabled only when workflow requires | loading state nearby | query error nearby |
| Table/list | warm dividers | link/row affordance only | focus on interactive children | n/a | n/a | loading state replaces/annotates data | inline error/empty state |

## Dataset navigation

- Admin tables: retain authoritative API pagination/cursors.
- Exploratory lists: current route search/filter contracts remain authoritative.
- URL state: existing routes may use local state; migration does not invent shareable URL state.
- Page size: controlled by current API/route defaults.
- Empty/no-results/error/loading treatment: explicit text state inside the owning premium panel/table.
- Back/scroll restoration: browser/Next.js default unless a route already owns it.
- Selection scope: no canonical bulk-selection workflow is currently established.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Complete sale | POS Pay | processing state, duplicate action disabled | receipt/current POS | completed + receipt link | unknown remains PAYMENT_UNKNOWN; no blind retry | payment context remains available | Phase 4 spec |
| Hold / resume sale | POS Hold / Held sales | hold/resume mutation pending; saved draft remains authoritative | POS | held/resumed inline status | offline resume blocked; branch mismatch requires switch; resume failure leaves current cart untouched | Held sales dialog / restored POS cart | Phase B held-sales baseline |
| Offline sale | POS Pay while offline | queued locally | POS + Sync follow-up | provisional receipt + pending-sync copy | Sync page/retry queue | stays in POS context | Phase 9b spec |
| Close shift | Close shift action | mutation pending | shift history/detail | expected/count/variance snapshot shown | server error with counted values preserved where possible | close form/result | Phase 5 spec |
| Search/filter | field/filter change + Apply where present | route/query loading | same route | updated list/chart | inline query error | control retains focus | route implementation |
| Create/edit catalog | route form action | mutation pending | existing route behavior | updated list/detail | server validation/error | form remains usable | catalog specs |

## Navigation and responsive behavior

- Route document title policy: root metadata identifies NexPOS; route-specific title expansion may be added later.
- Route error / 403 behavior: existing API error/permission handling remains authoritative.
- Breadcrumb/tab/route-state policy: role-aware grouped shell navigation owns top-level routes; report tabs own report subroutes. Owner-only Team/Administration management is not shown to roles that cannot use those operations.
- Sidebar/drawer/bottom-sheet transformation: persistent sidebar at xl; compact top navigation below xl; POS tablet remains full-width with bottom cart tray.
- Responsive table strategy: horizontal scroll before destructive column compression.
- Truncation/full-value access: IDs/data use mono; interactive links expose full authoritative record on detail routes.
- Focus restoration and sticky-obstruction policy: sticky topbar must not obscure focused primary controls; modals keep focusable controls visible.

## Workspace branch context

- The authenticated session is the source of truth for `activeBranchId`; the shell never invents a branch name.
- `null` means All branches. Selecting a branch persists it through the authenticated API and invalidates branch-sensitive workspace queries.
- A foreign, inactive, or later-archived branch cannot remain authoritative; server validation rejects or clears it.
- Switching businesses clears the active branch before the new workspace is projected.
- POS register choices and inventory queries follow the active session branch. Client role strings never grant branch access.

## First-run guidance and help

- After required owner onboarding is complete, each user receives one shared-workspace guided tour on their first authenticated landing.
- The tour is optional: Close, Skip, and Finish all permanently suppress automatic display for that user. The server-backed user preference is authoritative across devices; local storage is only a resilience fallback when the preference write cannot reach the API.
- A user can manually restart the tour at any time from the shared shell Help / Restart tour control. Manual restart does not reset the persisted first-run preference.
- The tour is role-aware and task-oriented. Owners/managers, cashiers, and inventory staff receive different guidance, and the tour must never fabricate permissions or imply that a role can perform an unavailable action. The server remains authoritative.
- Tour overlays are app-owned dialogs, keyboard reachable, reduced-motion safe, responsive to desktop/tablet/mobile, and block accidental interaction with the background while open.
- Administration / Help provides a second durable restart entry point without resetting the persisted first-run preference.

## Team and device administration

- Team management reuses the membership API. New temporary credentials are display-once React state and are never persisted in URL, local storage, query cache, or logs.
- Device Fleet owns device registration/list/revocation. Sync remains focused on offline replay and conflicts.
- Device revocation explains session impact before confirmation. Current-device revocation clears local device identity and follows the server's resulting authentication state.

## Overlays and feedback

- Dialog primitive: route-owned accessible role=dialog overlays until a shared dialog is introduced.
- Destructive confirmation levels: follow existing domain workflow; immutable financial corrections use dedicated server workflows rather than delete.
- Toast placement/duration/deduplication: no global toast owner; use inline persistent status.
- Alert/banner scope and persistence: operational uncertainty remains visible until state changes or user navigates intentionally.
- Tooltip delay/dismissal: not canonical; do not hide required instructions in tooltips.
- Unsaved-changes behavior: current route behavior; not globally standardized.
- Layer/z-index contract: modal/dialog above shell and sticky operational trays.

## Async and resilience

- Mutation default: pessimistic for server mutations; explicit queued mode only for supported offline sale workflows.
- Idempotency and duplicate-submit policy: payment/sale commands reuse authoritative idempotency rules from Phase 4.
- Auto-save/draft recovery: held sale and offline queue behavior only where domain-supported.
- Offline/read-stale/write behavior: cached catalog may be read; offline sale is cash-only and provisional until sync.
- Retry/backoff/timeout behavior: existing sync/reconciliation services remain authoritative.
- Version conflict and multi-tab behavior: no new visual assumption beyond server responses.
- Session expiry/re-authentication: authentication/API behavior remains authoritative.
- Long-running progress and return path: keep pending state close to the originating control.
- Stale-request cancellation/invalidation and pending-state ownership: TanStack Query owns route query lifecycle.
- Dialog/form preservation and retry after mutation failure: payment uncertainty does not discard sale context.

## Validation

- Schema/validation layer: server/domain validation is authoritative; browser constraints supplement it.
- Trigger timing: validate required browser fields on submit; server errors shown after response.
- Error summary/inline policy: workflow-level errors near the affected operation; field errors where API supplies field detail.
- Server error mapping: preserve stable API codes where useful for recovery.
- Sensitive-value handling: no business-sensitive metrics before authentication; permission-sensitive cost/profit stays server-authorized.
- Duplicate-submit prevention: pending controls disable where repeat would be unsafe.
- Resumed held-sale drafts are read-only in the cashier cart until payment or re-hold so the client cannot silently diverge from the authoritative saved draft.

## Permission and clipboard

- Permission UI strategy: hide or disable unavailable affordances where existing route behavior already knows the role; server remains authoritative.
- Clipboard copy policy: no global canonical copy helper yet.
- Disabled-state explanation: important disabled financial actions should have visible nearby reason text when the cause is not obvious.

## Migration status

- Migration ledger location: docs/superpowers/plans/2026-09-25-premium-ui-implementation.md
- Canonical primitives and owners: AppShell, ui.tsx, premium.tsx, charts.tsx, global .field styles.
- Current risk-prioritized slices: POS/payment uncertainty, offline queue, shift reconciliation, report accuracy, pre-auth privacy.
- Legacy import/token enforcement: old blue/navy shell tokens are not allowed in migrated premium shell code.
- Rollout/rollback and removal gates: preserve business logic/API contracts; visual changes may be rolled back independently from domain behavior.

## Verification

- Required static commands: pnpm --filter @pos/web test; pnpm --filter @pos/web typecheck; pnpm --filter @pos/web build.
- Browser/device/locale/theme matrix: 1440px management desktop, 1024px POS tablet, narrow mobile sanity check, English/en-PH formatting.
- Accessibility checks: visible focus, text-backed statuses, accessible chart labels/descriptions, reduced-motion support, dialog labels.
- Component-state/visual regression coverage: compare canonical routes with Figma frames in docs/superpowers/specs/2026-09-25-premium-ui-implementation-design.md.
- Canonical sibling flow used for comparison: Dashboard shell and premium management panels.
- CRUD full-flow evidence: existing route/API tests in apps/web/test plus backend suites.
- Failure-path evidence: payment/offline/sync tests plus src/lib/*-view.test.ts.
