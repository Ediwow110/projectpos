# Phase A Usability Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NexPOS immediately understandable and operable for first-time users by completing role-aware guidance, authoritative branch context, discoverable navigation, Team management, Device Fleet, and Administration/Help surfaces.

**Architecture:** Reuse the existing server-authoritative session, membership, device, branch, and tour-preference domains. The shared AppShell owns cross-route branch/help/navigation context; domain pages remain thin clients over existing APIs. New behavior is added through focused UI modules and contract/E2E tests, while concurrent PayMongo diagnostics remain isolated from Phase A commits.

**Tech Stack:** Next.js 15 App Router, React 19, TanStack Query, NestJS, PostgreSQL/Prisma, Vitest, Playwright, TypeScript, Tailwind/CSS utilities.

**Spec:** `docs/superpowers/specs/2026-09-30-phase-a-usability-completion-design.md`

## Global Constraints

- Server authorization remains authoritative; role strings in the browser never grant access.
- Do not hard-code `Main branch` or fabricate location/device activity.
- Close, Skip, and Finish permanently suppress automatic first-run tour display per user; manual restart never resets that preference.
- Tour content must be role-appropriate and skip unavailable targets safely.
- Existing membership/device APIs are canonical; do not add parallel storage models.
- Temporary staff passwords are display-once values and must never enter localStorage, logs, analytics, or persistent client state.
- Use app-owned dialogs/forms; no `alert()`, `confirm()`, or `prompt()`.
- Preserve existing POS checkout, PayMongo, offline sync, shift, report, and permission behavior.
- Do not stage or commit unrelated PayMongo diagnostic files or smoke scripts with Phase A work.

## Review Focus

1. **Missing/archived active branch:** authenticated workspace must fall back to an explicit All branches/unassigned state without stale scoped data.
2. **Tour target hidden by role or responsive layout:** tour must continue without a broken spotlight or focus trap.
3. **Temporary Team credential:** must be shown exactly once after member creation and disappear on navigation/reload without persistence.
4. **Device revocation of the current device:** UI must explain the session impact and handle the resulting auth state cleanly.
5. **Concurrent dirty workspace:** every commit must stage only the task-owned files and must not absorb unrelated PayMongo/audit/smoke edits.

---

### Task 1: Reconcile and verify the existing first-run tour slice

**Files:**
- Modify: `apps/web/src/components/GuidedTour.tsx`
- Modify: `apps/web/src/components/GuidedTour.test.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/api/src/tenant/nest/tenant.service.ts`
- Modify: `apps/api/src/tenant/nest/tenant.controller.ts`
- Modify: `apps/api/src/tenant/nest/tenant.service.test.ts`
- Modify: `apps/api/test/workspace-tour.contract.test.ts`
- Modify: `apps/api/src/common/db.port.ts`
- Modify: `apps/api/src/common/memory.db.ts`
- Modify: `apps/api/src/common/pg/pg-tenants.ts`
- Modify: `apps/api/src/common/pg/pg.db.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Modify/Create as already present: `packages/database/prisma/migrations/0020_workspace_tour_seen/migration.sql`
- Modify: `e2e/interaction-feedback.spec.ts`

**Interfaces:**
- Consumes: authenticated `/api/v1/me` profile and existing role strings.
- Produces: `workspaceTourSeen: boolean`, `POST /api/v1/me/tour/seen`, `guidedTourStepsForRole(role)`, and AppShell auto-open/manual-restart behavior.

- [ ] **Step 1: Write/strengthen failing component tests for role-specific step sets and missing target behavior**

Add tests in `GuidedTour.test.tsx` asserting:

```ts
expect(guidedTourStepsForRole("cashier").some((step) => step.target === "products")).toBe(false);
expect(guidedTourStepsForRole("inventory").some((step) => step.target === "inventory")).toBe(true);
expect(guidedTourStepsForRole("owner").some((step) => step.target === "pos")).toBe(true);
```

Add an interaction test proving a step whose `data-tour` target is absent still renders the dialog and allows Next/Finish.

- [ ] **Step 2: Run the focused web test and verify RED**

Run:

```bash
pnpm --filter @pos/web test -- GuidedTour.test.tsx
```

Expected: the new missing-target/role assertions fail against any incomplete concurrent implementation.

- [ ] **Step 3: Complete `GuidedTour` and persistence integration**

Keep `guidedTourStepsForRole(role?: string): GuidedTourStep[]` as the role filter. Ensure:

- `manager` receives the owner/manager operational path but not owner-only administration copy;
- absent targets use a non-spotlight dialog instead of throwing/stalling;
- index resets when role/step count changes;
- Escape invokes the same persisted dismissal path as Close/Skip;
- AppShell passes the authenticated role to `GuidedTour`.

Keep the backend preference idempotent:

```ts
markWorkspaceTourSeen(userId: string): Promise<{ workspaceTourSeen: true }>
```

- [ ] **Step 4: Run component/API persistence tests and verify GREEN**

Run:

```bash
pnpm --filter @pos/web test -- GuidedTour.test.tsx
pnpm --filter @pos/api test -- workspace-tour.contract.test.ts
pnpm --filter @pos/api exec vitest run test/pg/pg-tenants.test.ts --config vitest.pg.config.ts
```

Expected: all pass.

- [ ] **Step 5: Add browser coverage for target absence and cashier role**

In `e2e/interaction-feedback.spec.ts`, add:

- cashier first landing contains POS/Shifts/Sales guidance but not Team/Products-owner setup wording;
- narrow viewport hidden target does not prevent Next/Finish;
- reload after Skip has no automatic tour;
- manual Restart still opens the tour.

- [ ] **Step 6: Run the interaction-feedback E2E on all projects**

Run:

```bash
pnpm exec playwright test e2e/interaction-feedback.spec.ts
```

Expected: desktop, tablet, mobile all pass.

- [ ] **Step 7: Commit only tour-owned files**

```bash
git add apps/web/src/components/GuidedTour.tsx apps/web/src/components/GuidedTour.test.tsx apps/web/src/components/AppShell.tsx apps/api/src/tenant/nest/tenant.service.ts apps/api/src/tenant/nest/tenant.controller.ts apps/api/src/tenant/nest/tenant.service.test.ts apps/api/test/workspace-tour.contract.test.ts apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/common/pg/pg-tenants.ts apps/api/src/common/pg/pg.db.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0020_workspace_tour_seen/migration.sql e2e/interaction-feedback.spec.ts
git diff --cached --check
git commit -m "feat: add role-aware workspace tour"
```

---

### Task 2: Finish authoritative active-branch session context

**Files:**
- Modify: `apps/api/src/common/db.port.ts`
- Modify: `apps/api/src/common/pg/pg-tenants.ts`
- Modify: `apps/api/src/common/pg/pg.db.ts`
- Modify: `apps/api/src/common/request-context.ts`
- Modify: `apps/api/src/common/session.guard.ts`
- Modify: `apps/api/src/auth/nest/auth.service.ts`
- Modify: `apps/api/src/tenant/nest/tenant.service.ts`
- Modify: `apps/api/src/tenant/nest/tenant.controller.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create/Modify as already present: `packages/database/prisma/migrations/0021_session_active_branch/migration.sql`
- Modify: `packages/validation/src/auth.schema.ts`
- Modify: `apps/web/src/lib/workspace-branch.ts`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/pos/page.tsx`
- Modify: `apps/web/src/app/inventory/page.tsx`
- Modify: `apps/web/src/lib/use-pos-data.ts`
- Test: `apps/api/test/business-switch.contract.test.ts`
- Test: `apps/api/test/pg/pg-tenants.test.ts`
- Test: `apps/web/src/lib/pos-view.test.ts`
- Test: `apps/web/src/lib/inventory-view.test.ts`
- Test: `e2e/branch-scope.spec.ts`

**Interfaces:**
- Consumes: existing `Session`, `Branch`, register branch ids, branch-aware inventory/report APIs.
- Produces: `RequestAuth.activeBranchId`, `/api/v1/me.activeBranchId`, `/api/v1/me.activeBranchName`, and `POST /api/v1/me/active-branch`.

- [ ] **Step 1: Write/confirm failing contract tests for active-branch state**

Tests must cover:

- login starts with `activeBranchId: null`;
- setting an active branch persists on the session;
- selecting an inactive/foreign branch is rejected;
- switching business clears active branch;
- guard clears a branch that was archived after selection.

- [ ] **Step 2: Run focused API/PG tests and verify RED**

Run:

```bash
pnpm --filter @pos/api test -- business-switch.contract.test.ts
pnpm --filter @pos/api exec vitest run test/pg/pg-tenants.test.ts --config vitest.pg.config.ts
```

Expected: any incomplete active-branch cases fail before finalizing implementation.

- [ ] **Step 3: Complete session persistence and request-context projection**

Use:

```ts
interface RequestAuth {
  userId: string;
  businessId: string;
  role: string;
  sessionId: string;
  activeBranchId: string | null;
  authenticatedAt: Date;
}
```

Add/update session persistence for `activeBranchId: string | null`. `SessionGuard` validates that the stored branch belongs to the active business and is active; stale values are cleared.

- [ ] **Step 4: Complete Tenant API branch selection**

Keep:

```ts
setActiveBranch(
  userId: string,
  businessId: string,
  sessionId: string,
  branchId: string | null,
  requestId: string,
): Promise<{ activeBranchId: string | null; activeBranchName: string | null }>
```

Expose `POST /api/v1/me/active-branch` behind CSRF and validation. `null` means All branches.

- [ ] **Step 5: Add web helper tests for branch scoping**

`workspace-branch.ts` must provide deterministic helpers such as:

```ts
branchScopeLabel(activeBranchName: string | null): string
registersForBranch(registers: RegisterRow[], activeBranchId: string | null): RegisterRow[]
```

Tests assert:

- null branch => “All branches” and all active registers;
- selected branch => only registers for that branch;
- selected register is cleared when it falls outside the new branch scope.

- [ ] **Step 6: Wire branch context through AppShell/POS/dashboard/inventory**

AppShell shows a real branch selector using active branches returned by `GET /branches`. On selection:

- post active branch;
- update `["me"]`;
- invalidate non-profile queries;
- retain branch error text on failure.

Dashboard, POS and inventory use the server-backed active branch rather than independent local selectors.

- [ ] **Step 7: Run branch E2E**

Run:

```bash
pnpm exec playwright test e2e/branch-scope.spec.ts
```

Expected assertions:

- branch names appear instead of `Main branch`;
- selecting Branch B scopes POS registers and inventory;
- selecting All branches restores unscoped view;
- archived/foreign branch cannot persist.

- [ ] **Step 8: Commit only branch-context files**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/pg/pg-tenants.ts apps/api/src/common/pg/pg.db.ts apps/api/src/common/request-context.ts apps/api/src/common/session.guard.ts apps/api/src/auth/nest/auth.service.ts apps/api/src/tenant/nest/tenant.service.ts apps/api/src/tenant/nest/tenant.controller.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0021_session_active_branch/migration.sql packages/validation/src/auth.schema.ts apps/web/src/lib/workspace-branch.ts apps/web/src/components/AppShell.tsx apps/web/src/app/page.tsx apps/web/src/app/pos/page.tsx apps/web/src/app/inventory/page.tsx apps/web/src/lib/use-pos-data.ts apps/api/test/business-switch.contract.test.ts apps/api/test/pg/pg-tenants.test.ts apps/web/src/lib/pos-view.test.ts apps/web/src/lib/inventory-view.test.ts e2e/branch-scope.spec.ts
git diff --cached --check
git commit -m "feat: add active branch workspace scope"
```

---

### Task 3: Finalize grouped navigation and add Administration / Help

**Files:**
- Modify: `apps/web/src/lib/workspace-navigation.ts`
- Create: `apps/web/src/lib/workspace-navigation.test.ts`
- Modify: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/app/admin/AdminHelpActions.tsx`
- Modify: `apps/web/src/components/GuidedTour.tsx`
- Test: `e2e/navigation-discoverability.spec.ts`

**Interfaces:**
- Consumes: authenticated role, existing route paths, AppShell `setShowTour(true)`.
- Produces: `workspaceNavigationForRole(role)`, `flattenedWorkspaceNavigation(role)`, discoverable `/admin`, and a Help restart action.

- [ ] **Step 1: Write failing navigation tests**

Assert:

```ts
expect(flattenedWorkspaceNavigation("owner").map((item) => item.href)).toEqual(
  expect.arrayContaining(["/categories", "/registers", "/expenses", "/transfers", "/team", "/devices", "/admin"]),
);
expect(flattenedWorkspaceNavigation("cashier").map((item) => item.href)).not.toContain("/team");
```

Also assert no duplicate hrefs per role.

- [ ] **Step 2: Run focused test and verify RED**

```bash
pnpm --filter @pos/web test -- workspace-navigation.test.ts
```

- [ ] **Step 3: Complete grouped navigation definitions**

Add canonical items:

- `/devices` → Devices;
- `/admin` → Administration / Help.

Keep low-frequency owner/admin routes out of cashier navigation.

- [ ] **Step 4: Create `/admin` landing**

The page uses AppShell and shared premium cards. Cards link only to implemented destinations:

- Team;
- Devices;
- Branches;
- Registers;
- Help / Restart system tour.

`AdminHelpActions` owns the client-side “Restart tour” action. Do not create dead cards for future printers/payment/receipt settings.

- [ ] **Step 5: Expose a shared restart mechanism**

Refactor AppShell/GuidedTour only enough so the Administration Help action can trigger the same in-memory tour open behavior without resetting `workspaceTourSeen`.

Preferred minimal interface:

```ts
window.dispatchEvent(new CustomEvent("nexpos:restart-tour"));
```

AppShell listens while mounted and sets `showTour(true)`. Keep this event internal to the web app; do not persist it.

- [ ] **Step 6: Add navigation/browser discoverability coverage**

`e2e/navigation-discoverability.spec.ts` verifies:

- owner can reach Categories, Registers, Transfers, Expenses, Team, Devices, Admin via visible navigation;
- cashier does not see Team/Admin management entries;
- mobile can reach lower-frequency routes via the compact navigation/menu;
- Admin Help restart opens the tour.

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @pos/web test -- workspace-navigation.test.ts GuidedTour.test.tsx
pnpm exec playwright test e2e/navigation-discoverability.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/workspace-navigation.ts apps/web/src/lib/workspace-navigation.test.ts apps/web/src/components/AppShell.tsx apps/web/src/app/admin/page.tsx apps/web/src/app/admin/AdminHelpActions.tsx apps/web/src/components/GuidedTour.tsx e2e/navigation-discoverability.spec.ts
git diff --cached --check
git commit -m "feat: improve workspace navigation and help"
```

---

### Task 4: Add owner-facing Team management UI

**Files:**
- Create: `apps/web/src/app/team/page.tsx`
- Create: `apps/web/src/lib/team-view.ts`
- Create: `apps/web/src/lib/team-view.test.ts`
- Modify: `apps/web/src/lib/workspace-navigation.ts`
- Test: `e2e/team-management.spec.ts`

**Interfaces:**
- Consumes:
  - `GET /api/v1/memberships -> { items: TeamMember[] }`
  - `POST /api/v1/memberships`
  - `POST /api/v1/memberships/:id/deactivate`
- Produces: `/team` management screen and display-once temporary credential state.

- [ ] **Step 1: Write failing Team view tests**

Define in `team-view.ts`:

```ts
export interface TeamMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  deactivatedAt: string | null;
}

export function teamRoleLabel(role: string): string;
export function canDeactivateMember(currentUserId: string, member: TeamMemberRow): boolean;
```

Tests cover manager/cashier/inventory labels and prevent presenting self-deactivation as the normal happy path.

- [ ] **Step 2: Run Team helper tests and verify RED**

```bash
pnpm --filter @pos/web test -- team-view.test.ts
```

- [ ] **Step 3: Build the Team page**

Use `AppShell`, `PageHeader`, `DataTableFrame`, `Modal`, and `ConfirmDialog`.

Required page states:

- loading;
- API error/403;
- empty;
- populated member list;
- creating member;
- plan-limit/server validation;
- successful creation;
- deactivate confirmation.

Create-member form fields:

- name;
- email;
- role: manager/cashier/inventory.

Use `noValidate` and app-owned inline validation.

- [ ] **Step 4: Implement display-once temporary password**

On a `201` response containing `tempPassword`, store it only in React component state and render a modal/banner:

- identifies the newly added member;
- displays the credential once;
- provides a Copy button via `navigator.clipboard.writeText`;
- Close clears the state.

Do not store the password in query cache, localStorage, URL, logs, or persistent storage.

- [ ] **Step 5: Add E2E coverage**

`e2e/team-management.spec.ts`:

- owner creates a cashier and sees the temporary credential once;
- reload does not reproduce the credential;
- owner deactivates the member after confirmation;
- cashier direct navigation to `/team` gets the app-owned forbidden/error state and has no management controls.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @pos/web test -- team-view.test.ts
pnpm exec playwright test e2e/team-management.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/team/page.tsx apps/web/src/lib/team-view.ts apps/web/src/lib/team-view.test.ts apps/web/src/lib/workspace-navigation.ts e2e/team-management.spec.ts
git diff --cached --check
git commit -m "feat: add team management workspace"
```

---

### Task 5: Add Device Fleet UI and separate device management from Sync

**Files:**
- Create: `apps/web/src/app/devices/page.tsx`
- Create: `apps/web/src/lib/device-view.ts`
- Create: `apps/web/src/lib/device-view.test.ts`
- Modify: `apps/web/src/app/sync/page.tsx`
- Modify: `apps/web/src/lib/workspace-navigation.ts`
- Test: `e2e/device-fleet.spec.ts`

**Interfaces:**
- Consumes:
  - `GET /api/v1/devices -> { items: DbDevice[] }`
  - `POST /api/v1/devices`
  - `POST /api/v1/devices/:id/revoke` with `Idempotency-Key`.
- Produces: `/devices` route and corrected Sync copy.

- [ ] **Step 1: Write failing device presentation tests**

Define:

```ts
export function deviceStatusLabel(revokedAt: string | null): "Active" | "Revoked";
export function isCurrentDevice(deviceId: string, currentDeviceId: string | null): boolean;
```

Test active/revoked/current states.

- [ ] **Step 2: Run helper tests and verify RED**

```bash
pnpm --filter @pos/web test -- device-view.test.ts
```

- [ ] **Step 3: Build `/devices`**

Show:

- label;
- abbreviated id;
- Active/Revoked status;
- “This device” if id matches `localStorage["pos-device-id"]`;
- revoke action when active.

Owners/managers see the fleet returned by the API; lower roles see only the API-authorized subset.

Do not show “online”, “last seen”, or device health unless returned by the API.

- [ ] **Step 4: Implement revoke confirmation and session-impact copy**

Before revoking:

> Revoking this device ends sessions bound to it. If this is the current device, you may need to sign in again.

Generate a unique idempotency key with `crypto.randomUUID()`.

If revoking the current device causes the next authenticated query to return 401/403, clear the active sync scope and route to `/login`.

- [ ] **Step 5: Correct the Sync page**

Remove:

> “The current API supports enrolling this device. It does not return a device fleet list…”

Keep Sync focused on replay/conflicts. Replace the enrollment panel with a compact Device management card/link to `/devices`, or retain enrollment only if it is still useful while making Fleet ownership clearly `/devices`.

- [ ] **Step 6: Add E2E**

`e2e/device-fleet.spec.ts`:

- enroll a device;
- fleet displays it;
- mark current device using local storage when appropriate;
- revoke a non-current device and see Revoked;
- current-device revoke path explains impact and handles sign-out if session is revoked;
- cashier cannot revoke another user's device.

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @pos/web test -- device-view.test.ts
pnpm exec playwright test e2e/device-fleet.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/devices/page.tsx apps/web/src/lib/device-view.ts apps/web/src/lib/device-view.test.ts apps/web/src/app/sync/page.tsx apps/web/src/lib/workspace-navigation.ts e2e/device-fleet.spec.ts
git diff --cached --check
git commit -m "feat: add device fleet management"
```

---

### Task 6: Phase A integration verification and UX hardening

**Files:**
- Modify only files required by failures found during verification.
- Update: `UX-CONTRACT.md` if the new navigation/help/branch contracts are not already reflected.
- Update: `docs/audits/2026-09-29-deep-pos-system-audit.md` with implemented Phase A status.

**Interfaces:**
- Consumes: all Phase A tasks.
- Produces: verified Phase A branch ready for deployment.

- [ ] **Step 1: Run focused full unit/contract suites**

```bash
pnpm --filter @pos/web test
pnpm --filter @pos/api test
pnpm --filter @pos/api test:pg
```

Expected: zero failures.

- [ ] **Step 2: Run type/lint/build gates**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expected: zero failures. If the unrelated PayMongo diagnostic test still causes the known typecheck failure, resolve that concurrent change in its own commit before Phase A completion rather than excluding it from the final gate.

- [ ] **Step 3: Run strict premium UI audit**

Run the frontend-design-premium project audit in strict mode against the repository root and fix all blocking findings in Phase A-owned UI.

Expected: zero blocking findings.

- [ ] **Step 4: Run complete Playwright matrix**

```bash
pnpm e2e
```

Expected: desktop/tablet/mobile all pass, including:

- first-run tour;
- branch scope;
- navigation discoverability;
- Team;
- Devices;
- critical register-to-close;
- offline replay/conflict;
- roles;
- payment uncertainty;
- modal accessibility;
- security headers.

- [ ] **Step 5: Run dependency and diff checks**

```bash
pnpm audit --prod
git diff --check
git status --short
```

Expected:

- no known production dependency vulnerabilities;
- no whitespace errors;
- only intentionally retained unrelated workspace files remain dirty/untracked.

- [ ] **Step 6: Update audit/UX documentation**

Mark these findings as implemented:

- first-run role-aware tour;
- real active branch context;
- grouped navigation;
- Team UI;
- Device Fleet UI;
- Administration/Help.

Do not mark Held Sales, POS discounts, manager approval, exchanges, or purchasing as complete.

- [ ] **Step 7: Commit verification/documentation**

```bash
git add UX-CONTRACT.md docs/audits/2026-09-29-deep-pos-system-audit.md
git diff --cached --check
git commit -m "docs: record phase a usability completion"
```

- [ ] **Step 8: Push and verify Render deployment**

```bash
git push origin main
```

Verify both Render services deploy the exact final commit. Confirm:

- migration 0020/0021 status as applicable;
- API `/healthz` = 200;
- API `/readyz` = 200;
- web `/login` = 200;
- no new Render error logs after rollout.

- [ ] **Step 9: Production smoke**

Using the disposable QA workspace:

- sign in;
- switch branch;
- verify shell context;
- restart/close tour;
- open Team and Devices as owner;
- navigate Categories/Registers/Expenses/Transfers from visible UI;
- ensure no `Main branch` hard-code appears;
- verify POS still loads scoped registers and can create a draft.

Do not create live payment charges for this Phase A smoke.
