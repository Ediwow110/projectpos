# Phase A — Usability Completion Design

**Date:** 2026-09-30  
**Product:** NexPOS retail operations platform  
**Status:** Design for review  
**Source audit:** `docs/audits/2026-09-29-deep-pos-system-audit.md`

## 1. Goal

Make NexPOS understandable and operable for a first-time owner, manager, cashier, or inventory user without requiring hidden URLs, database-style identifiers, or prior knowledge of the system.

Phase A does not add new transaction domains. It completes discoverability and usability around capabilities that already exist: onboarding state, branches, memberships, devices, navigation, help, and guided assistance.

## 2. Scope

Phase A includes:

1. First-run guided tour that is task-oriented, dismissible, restartable, and persisted per user.
2. Role-aware tour content so users only see workflows relevant to their role.
3. Real active branch/location context in the shared shell.
4. Grouped navigation that exposes existing hidden routes.
5. Team management UI over the existing membership APIs.
6. Device Fleet UI over the existing device list/revoke APIs.
7. A durable Administration / Help ownership area for settings-oriented workflows and tour restart.
8. Consistent route/access/validation behavior for the surfaces touched by this phase.

Phase A explicitly excludes:

- supplier/vendor/purchase-order domain;
- physical stock counts;
- exchange transactions;
- product variants/bundles;
- loyalty/gift cards/store credit;
- omnichannel/e-commerce;
- new billing models;
- restaurant/KDS/table-service features.

Those remain later phases because they introduce new business domains rather than completing existing ones.

## 3. Product principles

### 3.1 Task-oriented guidance

The first-run experience must teach a user how to operate NexPOS, not merely point at menu labels.

The tour sequence is based on a store workflow:

1. Understand current branch/register context.
2. Find or create products.
3. Check inventory availability.
4. Open or verify a shift/register where the user's role allows it.
5. Make a sale in POS.
6. Find completed sales/receipts and supported correction flows.
7. Review reports relevant to the role.
8. Know where Help / Restart tour lives.

The tour may highlight shell controls, but every step must answer “what do I do here?” rather than only “this menu exists.”

### 3.2 Role-aware guidance

Tour steps must be filtered by authenticated role:

- **owner:** branch/location context, products, inventory, registers/shifts, POS, sales, reports, Team, Administration/Help.
- **manager:** branch/location context, POS, sales, shifts, inventory, reports, Help; administration items only where permission allows.
- **cashier:** branch/register context, POS, customer assignment, hold/resume entry point once available, payment, receipts/sales lookup, shift actions allowed to cashier, Help.
- **inventory:** branch/location context, products, inventory, transfers, stock-related reports, Help.

The UI must not advertise an action the role cannot perform. Server permissions remain authoritative.

### 3.3 Do not fake context

The shell must never display the literal text `Main branch` unless that is the actual branch name returned by the authenticated context.

If no active branch is available, the shell must show an explicit neutral state such as “No branch selected” or “Unassigned location” depending on the domain result.

### 3.4 Existing capability must be discoverable

Existing routes and APIs must not remain reachable only by typing URLs.

At minimum, these existing routes must have a discoverable shell entry:

- Categories
- Registers
- Expenses
- Transfers
- Team
- Devices
- Help / Administration

The shell should group navigation by job rather than adding an unbounded flat list.

## 4. Navigation information architecture

### 4.1 Desktop / large tablet

Use grouped navigation:

**Sell**
- Dashboard
- POS
- Sales

**Catalog**
- Products
- Categories
- Inventory

**Operations**
- Registers
- Shifts
- Transfers
- Expenses
- Branches

**Customers**
- Customers

**Reports**
- Sales reports entry point

**Administration**
- Team
- Devices
- Help

Groups may collapse visually, but the current route must remain identifiable and keyboard reachable.

### 4.2 Narrow layouts

Do not force every route into a permanently visible horizontal bar.

For tablet/mobile, expose primary selling routes directly and place lower-frequency operational/admin routes in an app-owned menu/drawer. The control must have an accessible name and preserve the current route indication.

### 4.3 Route ownership

The Administration area is a navigation/home surface, not a replacement for existing domain pages.

It links to:

- Team
- Devices
- Branches
- Registers
- Help / Restart tour
- future printers/receipt/payment settings when those surfaces are implemented.

## 5. Active branch/location context

### 5.1 Source of truth

Authenticated location context must come from server-backed business/session/domain state, never a hard-coded UI label.

The shell profile payload should expose the currently relevant branch context in a stable shape:

```ts
interface ActiveBranchContext {
  id: string | null;
  name: string | null;
}
```

The exact derivation follows existing branch/register/session rules:

1. If an active register/session is bound to a branch, that branch wins.
2. Otherwise use an explicitly selected/assigned branch if the domain already stores one.
3. Otherwise return null; do not invent “Main branch.”

Phase A does not invent a new branch-assignment model if one does not already exist. If no authoritative active branch can be derived, the shell shows a neutral unassigned state and links authorized users to Branches/Registers.

### 5.2 Switching

If the current backend already supports active-business switching but not active-branch switching, Phase A must not fake a branch selector.

Branch switching becomes a separate bounded follow-up unless an existing authoritative endpoint is discovered during implementation.

## 6. First-run guided tour

### 6.1 Persistence

Keep the existing per-user server-backed preference:

- new user: `workspaceTourSeen = false`;
- Close, Skip, or Finish: persist `true`;
- subsequent authenticated landings: do not auto-open;
- manual Restart tour: opens without resetting the persisted preference.

Local storage remains fallback suppression only when the preference write cannot reach the server.

### 6.2 Tour behavior

Requirements:

- app-owned modal/coachmark layer;
- background interaction blocked while open;
- Escape closes and suppresses future automatic display;
- Tab focus remains contained;
- primary action receives initial focus;
- Back/Next/Finish work via keyboard and pointer;
- reduced-motion safe;
- responsive target positioning;
- if a target is unavailable or permission-hidden, the step is skipped rather than showing a broken spotlight;
- no step may navigate away automatically while the user is in the middle of a transactional workflow.

### 6.3 Tour content model

Tour steps must be generated from role/permission-aware data instead of one fixed array.

Example shape:

```ts
interface TourStep {
  id: string;
  title: string;
  body: string;
  target: string | null;
  href?: string;
  roles?: string[];
}
```

The shared tour component receives already-filtered steps.

### 6.4 Durable restart entry points

Keep two restart entry points:

- compact Help / `?` action in the shell;
- Help page / Administration card.

The user must not need to clear browser storage to see the tour again.

## 7. Team management

### 7.1 Existing backend

Use the existing membership endpoints:

- list memberships;
- create membership;
- deactivate membership.

Do not create a parallel user/team storage model.

### 7.2 Team page

Create a first-class `/team` route.

Minimum UI:

- member name/email;
- role;
- active/deactivated state;
- add member action;
- deactivate action with confirmation;
- permission/access explanation;
- loading, empty, error, and plan-limit states;
- temporary credential result must be shown exactly once when the backend returns it, with copy guidance and no persistence into client logs/local storage.

The owner cannot deactivate the final/sole owner if the backend forbids it; the UI maps the stable server error rather than guessing.

### 7.3 Branch assignment

Do not display branch assignment controls until there is an authoritative membership/location assignment model. Mention location access only if the API exposes it.

## 8. Device Fleet

### 8.1 Existing backend

Use the existing device list and revoke endpoints.

Replace current Sync page copy claiming that device fleet listing is unavailable.

### 8.2 Device surface

Either:

- add a dedicated `/devices` route, or
- add a clearly separated Device Fleet section under Administration/Sync.

Preferred Phase A design: dedicated `/devices` route, while Sync remains focused on offline replay/conflict state.

Show:

- label;
- device id abbreviated for display;
- active/revoked state;
- current-device indicator when known;
- last-seen/activity only if the API actually exposes it;
- revoke action;
- explanation of session/sign-in impact.

Do not fabricate online/offline device presence.

## 9. Help / Administration

Create a durable `/admin` or `/settings` landing route. Use `/admin` for this phase to avoid implying every business setting is already editable.

It contains discoverable cards/links for:

- Team
- Devices
- Branches
- Registers
- Help / Restart tour

Future cards may include printers, receipt settings, payment configuration, API tokens, billing, and sessions after their UIs exist.

Help content must include:

- Restart system tour
- short explanation of Sell / Catalog / Operations / Reports
- keyboard/scanner-oriented POS hints already supported by the product
- link back to POS.

## 10. Validation and feedback

For forms touched in Phase A:

- use app-owned validation with `noValidate`;
- preserve user-entered values after failure;
- show an inline field/workflow error;
- focus the first invalid field where practical;
- disable duplicate unsafe submissions while pending;
- do not use browser `alert()`, `confirm()`, or `prompt()`.

Existing untouched forms are not all migrated in this phase; standardizing all management forms remains a later cleanup slice.

## 11. Accessibility

Target: WCAG 2.2 AA.

Required:

- semantic navigation landmarks;
- visible keyboard focus;
- menu/drawer keyboard operation;
- accessible names for icon-only Help actions;
- dialog focus containment and restoration;
- status/error text exposed via appropriate live/alert roles;
- touch targets suitable for tablet/mobile;
- reduced motion respected;
- color not used as the sole state indicator.

## 12. Data / migration impact

The existing uncommitted workspace-tour work introduces `workspaceTourSeen` on users plus migration `0020_workspace_tour_seen`.

Phase A should reuse that work if review confirms:

- migration is additive and backward compatible;
- existing users default to unseen only when intended;
- new users are unseen by default;
- marking seen is idempotent.

No Team or Device schema migration is expected because those APIs already exist.

Active branch context may require only API projection changes if derivable from existing register/branch records. If a new persistent “active branch” setting is required, stop and split that into a separate design rather than silently expanding Phase A.

## 13. Security

- server permissions remain authoritative for all Team, Device, Branch, and Register actions;
- CSRF protection remains required for mutations;
- temporary staff credentials must never be written to logs, analytics, local storage, or persistent client state;
- revoked device/session behavior must remain enforced by the existing server checks;
- tour content must not reveal inaccessible admin capabilities to unauthorized roles;
- no security-sensitive state is inferred solely from client-side role strings.

## 14. Testing strategy

### Unit/component

- role-based tour-step filtering;
- first step / Back / Next / Finish rendering;
- target-missing behavior;
- grouped navigation rendering;
- active branch neutral-state rendering;
- Team and Device row/status helpers.

### API/contract

- `/me` returns tour and branch context correctly;
- tour seen persistence remains per user;
- membership endpoints remain permission-safe;
- device list/revoke remain permission-safe.

### Browser E2E

Run on desktop, tablet, and mobile:

1. first owner landing shows tour once;
2. Skip suppresses future automatic display;
3. manual restart works;
4. cashier gets cashier-relevant steps only;
5. unavailable target does not break tour;
6. Categories/Registers/Expenses/Transfers are discoverable from shell navigation;
7. Team add/deactivate happy and forbidden/limit paths;
8. Device fleet list and revoke flow;
9. no hard-coded `Main branch` appears when branch context differs or is absent;
10. keyboard-only tour/menu operation.

### Regression

Re-run:

- full API tests;
- full web tests;
- PostgreSQL tests for touched families;
- lint;
- typecheck;
- production build;
- full Playwright matrix;
- strict premium UI audit.

Existing unrelated PayMongo diagnostic changes must not be mixed into Phase A commits.

## 15. Rollout

Implement in independently reviewable slices:

1. Tour persistence/content refactor.
2. Branch-context projection and shell replacement.
3. Grouped navigation + Administration/Help landing.
4. Team page.
5. Device Fleet page.
6. Cross-device/browser regression and production deployment verification.

Each slice should be deployable without requiring later slices to function.

## 16. Acceptance criteria

Phase A is complete when:

- a first-time authenticated user gets a task-oriented, role-appropriate tour;
- closing/skipping/finishing it prevents automatic reappearance across devices;
- the user can manually restart it;
- the shell no longer hard-codes `Main branch`;
- existing Categories, Registers, Expenses, and Transfers are discoverable;
- owners can manage Team from a UI backed by existing membership APIs;
- authorized users can see/revoke devices from a real Device Fleet UI;
- Help/Administration has a stable home;
- desktop/tablet/mobile E2E covers these flows;
- no regression is introduced in POS checkout, payments, offline sync, shifts, permissions, or reports.

