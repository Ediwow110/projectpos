# Manager Approval Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse NexPOS's existing short-lived one-use owner/manager approval grant to authorize exact refund, sale-void, inventory-movement, and foreign-shift-close actions without granting the requester standing manager permissions.

**Architecture:** Add one validated manager-approval action union plus one server policy service that resolves the authoritative permission and fingerprint for an exact action. A generic approval endpoint mints the existing hashed one-use grant, while each protected controller independently resolves the same requirement and consumes the token before adding only the transient permission needed for that call. The web reuses one shared approval dialog/client and keeps pending action payloads in component memory so the original operation can retry without persisting credentials or tokens.

**Tech Stack:** TypeScript 5.6, Zod 3, NestJS 11, Next.js 15 App Router, React 19, TanStack Query, PostgreSQL/Prisma DbPort, Vitest 3, Supertest, Playwright 1.63, Tailwind/CSS utilities.

**Spec:** `docs/superpowers/specs/2026-10-01-manager-approval-expansion-design.md`

## Global Constraints

- Reuse the current business-scoped six-digit approval PIN and password fallback; do not create a second credential system.
- Approval tokens remain opaque, two-minute, one-use, stored only as token hashes, and bound to business, requester, permission, and exact action fingerprint.
- Server authorization is authoritative. Browser role checks only control presentation.
- The server derives/canonicalizes fingerprints from validated action payloads; the client never submits a raw fingerprint.
- Manager PINs, passwords, approval tokens, token hashes, and approval-PIN hashes must not enter URLs, browser storage, persisted query state, logs, or audit snapshots.
- The requester remains the operational actor. The approving owner/manager is recorded separately in approval metadata.
- Above-threshold refund approval remains owner-only because `refund.override` is owner-only in the existing role seed.
- Cashier refund requests are review requests, not money-moving authorization; approval/rejection remain protected.
- A cashier may see another user's open shift only as a close-only supervisor-approval candidate; foreign shift detail, cash movement, and closed history remain inaccessible.
- Approval is online-only. Do not enqueue protected approval actions in the offline sale/sync queue.
- Use app-owned modal/dialog primitives; no browser `alert()`, `confirm()`, or `prompt()`.
- Preserve existing POS discount approval behavior and the current `/api/v1/sales/discount-approval` compatibility route.
- No database migration is expected: the existing manager-approval grant record already stores arbitrary permission and fingerprint strings.
- Do not stage or commit the pre-existing unrelated `apps/web/src/components/Modal.tsx` React import or diagnostic/tooling files unless a task explicitly requires them.

## Review Focus

1. **Refund threshold changes between mint and consume:** consume must resolve current authoritative requirements again; a token minted for `sale.refund` must not authorize a now-owner-only `refund.override` action.
2. **Same requester asks a manager to approve their own refund request:** separation of duties is satisfied only by a distinct consumed approver grant; the cashier's standing identity must not become the approver.
3. **Branch changes between inventory approval and retry:** the effective branch is fingerprinted, so a token for one branch must fail on another.
4. **Foreign open shift visibility for cashiers:** show enough identity to request a close approval, but never expose the foreign shift report, cash ledger, cash-movement controls, or closed-shift history.
5. **Grant consumed but protected mutation races/fails:** never silently reuse the consumed token; refresh authoritative state and require a fresh approval only when the action is still pending.

---

### Task 1: Define the manager-approval contracts and protected-operation token fields

**Files:**
- Create: `packages/validation/src/approvals.schema.ts`
- Create: `packages/validation/test/approvals.schema.test.ts`
- Modify: `packages/validation/src/index.ts`
- Modify: `packages/validation/src/refunds.schema.ts`
- Modify: `packages/validation/src/inventory.schema.ts`
- Modify: `packages/validation/src/shifts.schema.ts`
- Modify: `packages/validation/src/sales.schema.ts`
- Modify: `packages/validation/test/refunds.schema.test.ts`
- Modify: `packages/validation/test/inventory.schema.test.ts`
- Modify: `packages/validation/test/shifts.schema.test.ts`
- Modify: `packages/validation/test/sales.schema.test.ts`

**Interfaces:**
- Produces: `ManagerApprovalPermission`, `ManagerApprovalAction`, `managerApprovalRequestSchema`, `managerApprovalTokenSchema`, and `voidSaleSchema`.
- Produces operation bodies with optional `approvalToken?: string` for refund approval, sale void, inventory movement, and shift close.
- Consumes: existing `refundItemSchema`, movement types, and money-minor validation.

- [ ] **Step 1: Write failing validation tests**

Add tests asserting:

```ts
expect(managerApprovalRequestSchema.parse({
  email: "manager@example.com",
  pin: "482615",
  permission: "sale.void",
  action: { kind: "sale_void", saleId: "sale-1", reason: "Duplicate order" },
}).permission).toBe("sale.void");

expect(() => managerApprovalRequestSchema.parse({
  email: "manager@example.com",
  pin: "482615",
  password: "secret",
  permission: "sale.void",
  action: { kind: "sale_void", saleId: "sale-1", reason: "Duplicate order" },
})).toThrow();

expect(() => managerApprovalRequestSchema.parse({
  email: "manager@example.com",
  pin: "482615",
  permission: "inventory.adjust",
  action: { kind: "sale_void", saleId: "sale-1", reason: "Duplicate order" },
})).toThrow();
```

Also assert every protected operation accepts a valid `approvalToken` and rejects a short/empty token, and that `voidSaleSchema` requires a trimmed reason of at least three characters.

- [ ] **Step 2: Run validation tests and verify RED**

Run:

```bash
pnpm --filter @pos/validation test -- approvals.schema.test.ts refunds.schema.test.ts inventory.schema.test.ts shifts.schema.test.ts sales.schema.test.ts
```

Expected: FAIL because the manager-approval schema and operation token fields do not yet exist.

- [ ] **Step 3: Implement the schemas**

Create:

```ts
export type ManagerApprovalPermission =
  | "discount.override"
  | "sale.refund"
  | "refund.override"
  | "sale.void"
  | "inventory.adjust"
  | "shift.close.override";

export type ManagerApprovalAction = z.infer<typeof managerApprovalActionSchema>;
```

Use a discriminated action union for `discount`, `refund`, `sale_void`, `inventory_movement`, and `shift_close`. Validate exactly one of PIN/password and reject permission/action combinations outside the spec's allow-list. Export a shared token schema with the current 20-160 character bounds.

- [ ] **Step 4: Run validation tests and verify GREEN**

Run the Step 2 command.

Expected: all focused validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/approvals.schema.ts packages/validation/src/index.ts packages/validation/src/refunds.schema.ts packages/validation/src/inventory.schema.ts packages/validation/src/shifts.schema.ts packages/validation/src/sales.schema.ts packages/validation/test/approvals.schema.test.ts packages/validation/test/refunds.schema.test.ts packages/validation/test/inventory.schema.test.ts packages/validation/test/shifts.schema.test.ts packages/validation/test/sales.schema.test.ts
git diff --cached --check
git commit -m "feat: define protected action approval contracts"
```

---

### Task 2: Centralize authoritative approval requirement and fingerprint resolution

**Files:**
- Create: `apps/api/src/auth/nest/manager-approval-policy.service.ts`
- Create: `apps/api/src/auth/nest/manager-approval-policy.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Reuse: `apps/api/src/refunds/refund-math.ts`
- Reuse: `apps/api/src/sales/idempotency.ts`

**Interfaces:**
- Consumes: `DbPort`, `ManagerApprovalAction`, refund math, business settings, sale/refund/shift/product/branch reads.
- Produces:

```ts
export interface ManagerApprovalRequirement {
  permission: ManagerApprovalPermission;
  fingerprint: string;
  requireDistinctApprover: boolean;
}

resolveRequirement(
  businessId: string,
  requesterId: string,
  action: ManagerApprovalAction,
): Promise<ManagerApprovalRequirement | null>
```

- `null` means the exact action does not require a manager override for that requester (for example, closing their own shift).

- [ ] **Step 1: Write failing policy tests**

Cover:

- discount action resolves `discount.override` with order-insensitive normalized lines;
- refund at/below configured threshold resolves `sale.refund`;
- refund above threshold resolves `refund.override`;
- a non-owner requester approving a refund request they originally created resolves `requireDistinctApprover: true` even when their role already holds `sale.refund`;
- owner self-approval preserves the existing owner exception with `requireDistinctApprover: false`;
- already-refunded quantity and invalid sale-item quantities fail instead of minting a grant for an impossible refund;
- sale void resolves `sale.void` and fingerprints normalized reason;
- inventory movement fingerprints product/type/qty/reason/effective branch;
- own shift close returns `null`;
- another actor's open shift resolves `shift.close.override`;
- foreign/missing business entities fail with `NOT_FOUND`/validation rather than producing a fingerprint.

For Review Focus #1, change the refund threshold between two calls and assert the resolved permission changes from `sale.refund` to `refund.override`.

- [ ] **Step 2: Run policy tests and verify RED**

```bash
pnpm --filter @pos/api test -- manager-approval-policy.service.test.ts
```

Expected: FAIL because the policy service does not exist.

- [ ] **Step 3: Implement `ManagerApprovalPolicyService`**

Canonicalize optional text with trimming/null-equivalence before hashing. Sort refund items and discount lines deterministically. For refunds, compute authoritative remaining refundable quantity/value from recorded sale lines and prior refund items, then compare against `refundApprovalThresholdMinor`.

The service may read the requester's current business membership only to resolve separation-of-duties state for requested refunds. It does not grant access itself; controllers still compare standing permissions and consume grants.

- [ ] **Step 4: Register the provider and run tests GREEN**

```bash
pnpm --filter @pos/api test -- manager-approval-policy.service.test.ts
pnpm --filter @pos/api typecheck
```

Expected: focused tests and API typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/nest/manager-approval-policy.service.ts apps/api/src/auth/nest/manager-approval-policy.service.test.ts apps/api/src/app.module.ts
git diff --cached --check
git commit -m "feat: resolve exact manager approval requirements"
```

---

### Task 3: Add the generic manager-approval mint endpoint

**Files:**
- Create: `apps/api/src/auth/nest/approval.controller.ts`
- Create: `apps/api/test/manager-approval.contract.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/log-context.ts` only if the new payload introduces a sensitive key not already covered
- Reuse: `apps/api/src/auth/nest/auth.service.ts`

**Interfaces:**
- Consumes: `managerApprovalRequestSchema`, `ManagerApprovalPolicyService.resolveRequirement`, `AuthService.mintManagerApproval`.
- Produces: `POST /api/v1/approvals/manager` returning `{ token, expiresAt, approver: { id, name, role } }`.

- [ ] **Step 1: Write failing HTTP contract tests**

Add cases proving:

- cashier can mint an exact `sale.void` approval with the owner's correct PIN;
- wrong PIN returns generic `AUTH_INVALID_CREDENTIALS`;
- requester who already holds the resolved permission cannot mint an unnecessary grant unless `requireDistinctApprover` is true for that exact action;
- claimed permission mismatching the policy-resolved requirement returns `FORBIDDEN`;
- cross-business approver credentials fail generically;
- rate limit is requester/business scoped;
- response never contains password/PIN/hash material;
- log-context serialization redacts `approvalToken`, `pin`, `password`, `token`, and `tokenHash`.

- [ ] **Step 2: Run contract test and verify RED**

```bash
pnpm --filter @pos/api test -- manager-approval.contract.test.ts
```

Expected: 404/failing assertions because the endpoint is absent.

- [ ] **Step 3: Implement `ApprovalController`**

Use:

```ts
@Post("approvals/manager")
@UseGuards(SessionGuard, CsrfGuard)
async createManagerApproval(...): Promise<void>
```

Resolve the authoritative requirement first. Require the request's permission to equal that requirement. Reject `null` actions and already-granted cases only when `requireDistinctApprover` is false; a same-requester refund review may mint a grant specifically to satisfy the second-person rule. Apply the existing five-attempt/minute approval brake per business/requester, then call `AuthService.mintManagerApproval` with the policy fingerprint.

Keep `/api/v1/sales/discount-approval` working unchanged for current POS clients.

- [ ] **Step 4: Run contract/security tests GREEN**

```bash
pnpm --filter @pos/api test -- manager-approval.contract.test.ts auth.approval.test.ts logging.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/nest/approval.controller.ts apps/api/src/app.module.ts apps/api/test/manager-approval.contract.test.ts apps/api/src/common/log-context.ts
git diff --cached --check
git commit -m "feat: add generic manager approval endpoint"
```

---

### Task 4: Integrate approval grants with refund request/approval and sale void

**Files:**
- Modify: `apps/api/src/sales/nest/sales.controller.ts`
- Modify: `apps/api/src/sales/nest/sales.service.ts`
- Modify: `apps/api/src/sales/sale-lifecycle-service.ts`
- Modify: `apps/api/src/sales/nest/sales.service.test.ts`
- Modify: `apps/api/src/refunds/nest/refund.controller.ts`
- Modify: `apps/api/src/refunds/nest/refund.service.ts`
- Modify: `apps/api/src/refunds/nest/refund.service.test.ts`
- Modify: `apps/api/test/sales.contract.test.ts`
- Modify: `apps/api/test/refund.contract.test.ts`

**Interfaces:**
- Consumes: Task 1 operation schemas and Task 2 policy service.
- Produces protected calls that accept one optional `approvalToken`.
- Produces shared approval audit context:

```ts
export interface AppliedManagerApproval {
  approverId: string;
  permission: ManagerApprovalPermission;
}
```

- [ ] **Step 1: Write failing backend tests for cashier refund request and consumed approval**

Tests must prove:

- cashier may submit `refund-request`; inventory role remains forbidden;
- cashier cannot approve a requested refund without a token;
- cashier can approve their own previously requested refund only when a distinct owner/manager grant is consumed;
- manager may approve at/below threshold with standing `sale.refund`;
- manager above threshold is denied until an owner `refund.override` token is consumed;
- a `sale.refund` token fails after the threshold changes so the action now requires `refund.override`;
- reused, expired, wrong-sale, wrong-items, or edited-reason token fails;
- successful protected refund audit keeps `actorId` as requester and includes approver ID/permission in `after.approval`.

- [ ] **Step 2: Run refund tests and verify RED**

```bash
pnpm --filter @pos/api test -- refund.service.test.ts refund.contract.test.ts sales.contract.test.ts
```

Expected: new cashier request/approval cases fail.

- [ ] **Step 3: Implement refund request/approval authorization**

Change refund request authorization to explicit selling roles (`owner|manager|cashier`) rather than requiring `sale.refund`. Keep reason/idempotency/state validation unchanged.

In `RefundController.approve`, build the exact `refund` action, call `resolveRequirement`, and:

- continue with standing permission only when present **and** `requireDistinctApprover` is false;
- otherwise require/consume the matching approval token;
- for `refund.override`, add transient `sale.refund` and `refund.override` for this call only;
- pass `AppliedManagerApproval` to `RefundService.approveRefund`.

Update the separation-of-duties check so the same requester may complete a requested refund only when a distinct consumed approver is present. The approver never replaces the requester as actor.

- [ ] **Step 4: Add failing sale-void tests**

Cover:

- cashier void is forbidden without grant;
- matching `sale.void` grant succeeds once;
- changing sale ID/reason invalidates the grant;
- completed sales remain non-voidable even with grant;
- audit contains requester plus approval metadata.

- [ ] **Step 5: Run void tests RED**

```bash
pnpm --filter @pos/api test -- sales.service.test.ts sales.contract.test.ts
```

Expected: approval-token void cases fail.

- [ ] **Step 6: Implement protected sale void**

Parse `voidSaleSchema`, resolve a `sale_void` requirement, consume the token only when standing `sale.void` is missing, and pass approval metadata through `SalesService.voidSale` / `SalesLifecycleService.voidSale` into the action audit `after.approval`.

- [ ] **Step 7: Run focused API tests GREEN**

```bash
pnpm --filter @pos/api test -- refund.service.test.ts refund.contract.test.ts sales.service.test.ts sales.contract.test.ts manager-approval.contract.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/sales/nest/sales.controller.ts apps/api/src/sales/nest/sales.service.ts apps/api/src/sales/sale-lifecycle-service.ts apps/api/src/sales/nest/sales.service.test.ts apps/api/src/refunds/nest/refund.controller.ts apps/api/src/refunds/nest/refund.service.ts apps/api/src/refunds/nest/refund.service.test.ts apps/api/test/sales.contract.test.ts apps/api/test/refund.contract.test.ts
git diff --cached --check
git commit -m "feat: approve protected refund and void actions"
```

---

### Task 5: Integrate approval grants with inventory movement and foreign-shift close

**Files:**
- Modify: `apps/api/src/inventory/nest/inventory.controller.ts`
- Modify: `apps/api/src/inventory/nest/inventory.service.ts`
- Modify: `apps/api/src/inventory/nest/inventory.service.test.ts`
- Modify: `apps/api/test/inventory.contract.test.ts`
- Modify: `apps/api/src/shifts/nest/shift.controller.ts`
- Modify: `apps/api/src/shifts/nest/shift.service.ts`
- Modify: `apps/api/src/shifts/nest/shift.service.test.ts`
- Modify: `apps/api/test/shift.contract.test.ts`
- Modify: `packages/validation/src/shifts.schema.ts`
- Modify: `packages/validation/test/shifts.schema.test.ts`

**Interfaces:**
- Consumes: Task 2 policy service and Task 4 `AppliedManagerApproval`.
- Produces approval-aware inventory movement and shift close.
- Produces `GET /api/v1/shifts?status=OPEN&includeCloseCandidates=true` semantics for cashier close-only candidates while preserving foreign detail denial.

- [ ] **Step 1: Write failing inventory approval tests**

Cover:

- cashier movement denied without token;
- exact owner/manager `inventory.adjust` grant succeeds once;
- changed qty/type/product/reason fails;
- branch A grant fails on branch B;
- insufficient stock/product-not-tracked/domain validation still wins after approval;
- audit keeps requester as actor with `after.approval`.

- [ ] **Step 2: Run inventory tests RED**

```bash
pnpm --filter @pos/api test -- inventory.service.test.ts manager-approval.contract.test.ts
```

Expected: approval-aware movement tests fail.

- [ ] **Step 3: Implement inventory approval consumption**

In `InventoryController.recordMovement`, compute the effective branch exactly once (`body.branchId ?? auth.activeBranchId ?? null`) and use that same value for both policy action and service input. Remove the early hard guard only for this endpoint; if standing `inventory.adjust` is absent, require and consume a matching token.

Pass approval metadata to `InventoryService.recordMovement` and attach it to the existing `inventory.adjust` audit entry.

- [ ] **Step 4: Write failing shift visibility/approval tests**

Cover:

- cashier default/history query continues to exclude foreign closed shifts;
- `status=OPEN&includeCloseCandidates=true` returns own and foreign open candidates;
- cashier still receives `FORBIDDEN` on foreign `GET /shifts/:id`;
- foreign cash-movement endpoint remains denied by existing permission/state behavior;
- cashier closes own shift without approval;
- cashier foreign close fails without grant and succeeds once with exact `shift.close.override` grant;
- changed counted cash/notes/shift ID invalidates grant;
- shift closing between mint and consume returns authoritative closed-state error and the token is not reusable;
- audit includes requester and approval metadata.

- [ ] **Step 5: Run shift tests RED**

```bash
pnpm --filter @pos/api test -- shift.service.test.ts manager-approval.contract.test.ts
```

Expected: candidate visibility and approval-token tests fail.

- [ ] **Step 6: Implement close-candidate listing and protected close**

Extend `shiftsQuerySchema`/service options with `includeCloseCandidates`. For cashier:

- when false/default, preserve current own-shift filtering;
- when true, only allow the broader result for `status=OPEN`;
- do not change `getShift` foreign-detail denial.

In `ShiftController.closeShift`, resolve the exact `shift_close` action. If requirement is `null`, close normally. If the requester lacks `shift.close.override`, require/consume token and pass transient permission plus approval metadata to `ShiftService.closeShift`.

- [ ] **Step 7: Run focused API tests GREEN**

```bash
pnpm --filter @pos/api test -- inventory.service.test.ts shift.service.test.ts manager-approval.contract.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/inventory/nest/inventory.controller.ts apps/api/src/inventory/nest/inventory.service.ts apps/api/src/inventory/nest/inventory.service.test.ts apps/api/test/inventory.contract.test.ts apps/api/src/shifts/nest/shift.controller.ts apps/api/src/shifts/nest/shift.service.ts apps/api/src/shifts/nest/shift.service.test.ts apps/api/test/shift.contract.test.ts apps/api/test/manager-approval.contract.test.ts packages/validation/src/shifts.schema.ts packages/validation/test/shifts.schema.test.ts
git diff --cached --check
git commit -m "feat: approve inventory and foreign shift actions"
```

---

### Task 6: Build one reusable approval dialog/client and preserve the POS discount wrapper

**Files:**
- Create: `apps/web/src/components/ManagerApprovalDialog.tsx`
- Create: `apps/web/src/components/ManagerApprovalDialog.test.tsx`
- Modify: `apps/web/src/components/PosManagerApprovalDialog.tsx`
- Modify: `apps/web/src/components/PosManagerApprovalDialog.test.tsx`
- Create: `apps/web/src/lib/manager-approval.ts`
- Create: `apps/web/src/lib/manager-approval.test.ts`

**Interfaces:**
- Produces:

```ts
export type ManagerApprovalCredentials =
  | { email: string; pin: string; password?: never }
  | { email: string; password: string; pin?: never };

export type ManagerApprovalApiCall = <T>(
  path: string,
  options?: { csrfToken?: string; init?: RequestInit },
) => Promise<T>;

authorizeManagerAction(
  input: {
    permission: ManagerApprovalPermission;
    action: ManagerApprovalAction;
    credentials: ManagerApprovalCredentials;
  },
  deps?: { api?: ManagerApprovalApiCall },
): Promise<ManagerApprovalResponse>
```

- Produces a generic `ManagerApprovalDialog` with action-specific title, description, summary, busy/error, and approve/cancel props.
- `PosManagerApprovalDialog` remains a compatibility adapter so the existing POS page does not need a broad rewrite.

- [ ] **Step 1: Write failing shared component/client tests**

Assert:

- default mode is masked six-digit numeric PIN;
- password fallback is masked and has show/hide accessible labels;
- invalid email/PIN stays local;
- action title/summary is rendered without hard-coded discount-only copy;
- credential mode switch clears credential-specific local error/state;
- generic client posts only `email + one credential + permission + action` to `/api/v1/approvals/manager`;
- response token is returned but helper performs no storage writes.

- [ ] **Step 2: Run focused web tests RED**

```bash
pnpm --filter @pos/web test -- ManagerApprovalDialog.test.tsx manager-approval.test.ts PosManagerApprovalDialog.test.tsx
```

Expected: new shared modules are missing.

- [ ] **Step 3: Implement shared dialog/client and POS adapter**

Keep credentials component-local. Clear PIN/password when switching modes and on unmount/close through normal React state lifecycle. Do not add any storage layer.

Use the existing premium `Modal`, `GhostButton`, and `PrimaryButton` primitives and preserve current PIN/password security copy.

- [ ] **Step 4: Run focused tests GREEN**

Run the Step 2 command.

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ManagerApprovalDialog.tsx apps/web/src/components/ManagerApprovalDialog.test.tsx apps/web/src/components/PosManagerApprovalDialog.tsx apps/web/src/components/PosManagerApprovalDialog.test.tsx apps/web/src/lib/manager-approval.ts apps/web/src/lib/manager-approval.test.ts
git diff --cached --check
git commit -m "feat: share manager approval UI and client"
```

---

### Task 7: Complete sale-detail refund and void approval UX

**Files:**
- Create: `apps/web/src/components/SaleRefundDialog.tsx`
- Create: `apps/web/src/components/SaleRefundDialog.test.tsx`
- Create: `apps/web/src/components/SaleVoidDialog.tsx`
- Create: `apps/web/src/components/SaleVoidDialog.test.tsx`
- Create: `apps/web/src/lib/sale-protected-actions.ts`
- Create: `apps/web/src/lib/sale-protected-actions.test.ts`
- Modify: `apps/web/src/app/sales/[id]/page.tsx`
- Modify: `apps/web/src/lib/sales.ts`

**Interfaces:**
- Consumes: Task 6 `ManagerApprovalDialog` and `authorizeManagerAction`.
- Produces exact pending action state for refund approval and sale void without persisting it.

- [ ] **Step 1: Write failing sale-action helper/component tests**

Cover:

- owner/manager can request/approve/reject according to standing UI role;
- cashier can request refund, but inventory role sees no refund controls;
- cashier with a `REFUND_REQUESTED` sale gets “Approve with supervisor” rather than a dead end;
- void is offered only for backend-voidable non-completed states;
- refund/void payload builders include `approvalToken` only on the retried protected request;
- editing refund quantities/reason or void reason produces a different approval action.
- refund permission preview chooses `refund.override` only when the selected recorded refund value exceeds the currently loaded `refundApprovalThresholdMinor`; otherwise it chooses `sale.refund`.

- [ ] **Step 2: Run focused web tests RED**

```bash
pnpm --filter @pos/web test -- SaleRefundDialog.test.tsx SaleVoidDialog.test.tsx sale-protected-actions.test.ts
```

Expected: modules do not yet exist/new assertions fail.

- [ ] **Step 3: Extract the current refund modal and add void modal**

Move the existing inline refund form out of the page into `SaleRefundDialog` without changing its authoritative quantity behavior. Add `SaleVoidDialog` with required reason and consequence copy.

- [ ] **Step 4: Integrate attempt → approval → exact retry**

For protected approval/retry:

1. keep the pending action payload in React state;
2. submit the action normally;
3. on relevant `FORBIDDEN`, verify online state and open `ManagerApprovalDialog`;
4. mint exact grant;
5. retry the preserved payload once with `approvalToken`;
6. clear credentials/token/pending approval state after success;
7. on mismatch/expiry/used grant, preserve the domain form values but require fresh approval.

For refunds, compute the permission claim from recorded sale-line refund value plus the currently loaded business `refundApprovalThresholdMinor`: `sale.refund` at/below the threshold and `refund.override` above it. This is presentation/request shaping only. The generic approval endpoint and the protected refund endpoint both resolve the authoritative requirement again; if settings/refundable state changed, preserve selected quantities, refresh authoritative sale/business data, and require the user to review/request a fresh approval.

- [ ] **Step 5: Run focused web + API contract tests GREEN**

```bash
pnpm --filter @pos/web test -- SaleRefundDialog.test.tsx SaleVoidDialog.test.tsx sale-protected-actions.test.ts
pnpm --filter @pos/api test -- refund.contract.test.ts sales.contract.test.ts manager-approval.contract.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/SaleRefundDialog.tsx apps/web/src/components/SaleRefundDialog.test.tsx apps/web/src/components/SaleVoidDialog.tsx apps/web/src/components/SaleVoidDialog.test.tsx apps/web/src/lib/sale-protected-actions.ts apps/web/src/lib/sale-protected-actions.test.ts apps/web/src/app/sales/[id]/page.tsx apps/web/src/lib/sales.ts
git diff --cached --check
git commit -m "feat: add supervisor approval to refunds and voids"
```

---

### Task 8: Complete inventory and shift approval UX

**Files:**
- Create: `apps/web/src/components/InventoryMovementForm.tsx`
- Create: `apps/web/src/components/InventoryMovementForm.test.tsx`
- Create: `apps/web/src/lib/inventory-operations.ts`
- Create: `apps/web/src/lib/inventory-operations.test.ts`
- Modify: `apps/web/src/app/inventory/page.tsx`
- Create: `apps/web/src/lib/shift-operations.ts`
- Create: `apps/web/src/lib/shift-operations.test.ts`
- Modify: `apps/web/src/app/shifts/page.tsx`
- Modify: `apps/web/src/lib/shifts.ts`

**Interfaces:**
- Consumes: Task 6 shared approval client/dialog.
- Produces approval-aware inventory movement and shift close clients.
- Produces cashier open-shift cards that distinguish `own` vs `supervisor approval required` without linking foreign detail.

- [ ] **Step 1: Write failing inventory web tests**

Cover:

- owner/manager/inventory keep normal “Record movement” behavior;
- cashier sees the same movement inputs with supervisor-approval explanation;
- pending product/type/qty/reason survives wrong PIN;
- retry body adds token but does not alter branch or movement fields;
- offline cashier receives inline “manager approval requires connection” and no approval dialog.

- [ ] **Step 2: Run inventory web tests RED**

```bash
pnpm --filter @pos/web test -- InventoryMovementForm.test.tsx inventory-operations.test.ts
```

Expected: new approval-aware modules are absent.

- [ ] **Step 3: Implement inventory UI**

Extract the current movement panel into `InventoryMovementForm`. Keep app-owned validation and current movement-type options. For cashier, attempt exact movement and escalate only on `FORBIDDEN`; for standing roles, behavior stays direct.

- [ ] **Step 4: Write failing shift web tests**

Cover:

- own open shift card keeps cash movement, close, and report controls;
- foreign open candidate for cashier hides expected-cash detail, cash movement, and report link;
- foreign candidate presents a close action labeled as supervisor approval;
- counted cash remains after wrong PIN;
- approved retry contains the exact shift ID/count/notes plus token;
- offline approval attempt is blocked locally.

- [ ] **Step 5: Run shift web tests RED**

```bash
pnpm --filter @pos/web test -- shift-operations.test.ts shift-view.test.ts
```

Expected: foreign close-candidate/approval assertions fail.

- [ ] **Step 6: Implement shift UI**

Include `userId` in the page's existing `/me` view model. Query open shifts with `includeCloseCandidates=true`; keep recent history on the existing default query so cashier history remains own-only.

Render foreign cashier candidates as limited cards. The close form uses the same counted-cash validation, but never offers cash movement or a foreign report link.

- [ ] **Step 7: Run focused web/API tests GREEN**

```bash
pnpm --filter @pos/web test -- InventoryMovementForm.test.tsx inventory-operations.test.ts shift-operations.test.ts shift-view.test.ts
pnpm --filter @pos/api test -- inventory.service.test.ts shift.service.test.ts manager-approval.contract.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/InventoryMovementForm.tsx apps/web/src/components/InventoryMovementForm.test.tsx apps/web/src/lib/inventory-operations.ts apps/web/src/lib/inventory-operations.test.ts apps/web/src/app/inventory/page.tsx apps/web/src/lib/shift-operations.ts apps/web/src/lib/shift-operations.test.ts apps/web/src/app/shifts/page.tsx apps/web/src/lib/shifts.ts
git diff --cached --check
git commit -m "feat: approve inventory and shift actions in context"
```

---

### Task 9: Browser matrix, security scan, premium UI audit, and regression verification

**Files:**
- Create: `e2e/manager-approval-expansion.spec.ts`
- Modify: `UX-CONTRACT.md`
- Modify: `docs/audits/2026-09-29-deep-pos-system-audit.md`
- Modify only if failures require it: task-owned production/test files from Tasks 1-8

**Interfaces:**
- Consumes: all prior tasks.
- Produces: desktop/tablet/mobile end-to-end proof plus updated audit/UX contract status.

- [ ] **Step 1: Write failing Playwright scenarios before relying on manual verification**

The new spec must cover:

1. cashier creates a refund request, wrong manager PIN preserves the request form, correct PIN approves the exact refund;
2. manager over the configured refund threshold requires owner PIN and succeeds with exact owner grant;
3. cashier voids an eligible sale after manager approval and cannot reuse the token;
4. cashier inventory movement is approved for the active branch; switching branch before retry invalidates the grant;
5. cashier sees another actor's open shift as close-only, cannot open its report, and closes it only after manager approval;
6. wrong PIN → success recovery for at least one non-discount action;
7. browser storage scan after all flows finds none of the manager email's password/PIN/approval token;
8. existing over-threshold POS discount approval still works.

- [ ] **Step 2: Run focused E2E and verify RED/GREEN through implementation fixes**

```bash
pnpm exec playwright test e2e/manager-approval-expansion.spec.ts
```

Expected: desktop, tablet, and mobile projects all pass after fixes.

- [ ] **Step 3: Run security anti-pattern scans**

Run:

```bash
git grep -n -E "localStorage|sessionStorage|indexedDB|URLSearchParams" -- apps/web/src | findstr /i "approval pin password token" || exit /b 0
git grep -n -E "console\.(log|debug|info|warn|error).*approval|console\.(log|debug|info|warn|error).*pin|console\.(log|debug|info|warn|error).*password" -- apps packages || exit /b 0
```

Expected: no manager credential/token persistence or logging introduced by this plan.

- [ ] **Step 4: Run frontend-design-premium strict verification on the changed UI**

Follow the installed `frontend-design-premium` verification checklist and run its strict project audit against the repository root. Compare the new dialogs/forms/cards with the existing POS discount approval modal and sibling Inventory/Shifts/Sales surfaces. Fix all blocking findings.

Expected: zero blocking premium-UI findings for changed surfaces.

- [ ] **Step 5: Run complete unit/API/PostgreSQL/type/lint/build verification**

```bash
pnpm test
pnpm --filter @pos/api test:pg
pnpm typecheck
pnpm lint
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 6: Run the complete Playwright matrix**

```bash
pnpm e2e
```

Expected: all configured desktop/tablet/mobile tests pass with zero failures.

- [ ] **Step 7: Update UX contract and deep audit**

Document:

- generic manager approval action contract;
- refund request/approval role behavior;
- sale void, inventory movement, and foreign shift-close approval behavior;
- one-use exact-action token failure recovery;
- verification totals/date;
- remaining Phase B work (provider-backed electronic-tender exchange, SMS receipt delivery, physical printer acknowledgement/agent polish, broader receipt settings).

- [ ] **Step 8: Commit verification/docs**

```bash
git add e2e/manager-approval-expansion.spec.ts UX-CONTRACT.md docs/audits/2026-09-29-deep-pos-system-audit.md
git diff --cached --check
git commit -m "test: verify manager approval expansion"
```

---

## Completion Contract

The phase is complete only when:

- all four protected workflows are discoverable and usable end-to-end;
- every one-use grant is resolved and consumed against current authoritative action state;
- no credential/token persistence or logging regression is found;
- requester/approver audit linkage is verified;
- the focused approval E2E passes on desktop/tablet/mobile;
- validation, web, API, PostgreSQL, typecheck, lint, build, premium UI audit, and the full Playwright matrix are green;
- unrelated pre-existing workspace changes remain unstaged/unmodified by this plan.
