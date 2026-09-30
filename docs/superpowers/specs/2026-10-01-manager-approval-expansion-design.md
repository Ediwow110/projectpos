# Phase B — Manager Approval Expansion Design

**Date:** 2026-10-01
**Product:** NexPOS retail operations platform
**Status:** Design for review
**Source audit:** `docs/audits/2026-09-29-deep-pos-system-audit.md`

## 1. Goal

Extend the existing business-scoped owner/manager approval-PIN workflow beyond over-threshold POS discounts so staff can complete selected protected operations without handing over the workstation, sharing a manager session, or granting the requester the manager's standing permission.

This phase reuses the current security model:

- six-digit approval PIN with account-password fallback;
- active owner/manager membership in the same business;
- opaque two-minute one-use approval token;
- token verifier stored hashed;
- token bound to the requester, business, permission, and exact action fingerprint;
- credentials kept out of browser storage, URLs, logs, and persisted query state;
- server-side permission and action revalidation at consume time;
- audit records preserving the requester and approver separately.

The first expansion covers:

1. refund approval, including the owner-only refund-threshold override;
2. sale void/cancel;
3. sensitive inventory movement/adjustment;
4. closing another staff member's shift when `shift.close.override` is required.

## 2. Non-goals

This slice does not:

- change role definitions or permanently add permissions to a cashier/inventory user;
- add approval for settings, user management, exports, API tokens, billing, or platform operations;
- bypass refund amount, stock, shift, branch, sale-state, or idempotency validation;
- allow approval while offline;
- persist manager PINs/passwords or approval tokens across reloads;
- extend provider-backed electronic-tender exchanges;
- create a generic “approve anything” token.

Each approval remains tied to one explicit protected action.

## 3. Existing baseline to preserve

The discount workflow already establishes the canonical behavior:

1. requester attempts the protected operation;
2. server returns `FORBIDDEN` when the requester's standing permissions are insufficient;
3. UI opens an app-owned manager approval dialog without discarding the pending task;
4. owner/manager enters email plus either six-digit staff PIN or password fallback;
5. server validates same-business active membership and required permission;
6. server mints a two-minute one-use token bound to an exact fingerprint;
7. UI retries the original action automatically with the token;
8. server consumes the token atomically, revalidates the approver membership/permission, executes the original operation, and writes requester/approver audit context;
9. token is discarded client-side immediately after success or terminal failure.

The expanded workflows must use the same interaction and security contract.

## 4. Approval model

### 4.1 Generic approval request

Introduce a generic manager-approval request contract instead of creating one endpoint per feature.

Recommended API:

`POST /api/v1/approvals/manager`

Request:

```ts
interface ManagerApprovalRequest {
  email: string;
  pin?: string;
  password?: string;
  permission:
    | "discount.override"
    | "sale.refund"
    | "refund.override"
    | "sale.void"
    | "inventory.adjust"
    | "shift.close.override";
  action: ManagerApprovalAction;
}
```

Exactly one of `pin` or `password` is required.

The server derives the action fingerprint from the validated action payload. The client never submits a raw fingerprint.

Response:

```ts
interface ManagerApprovalResponse {
  token: string;
  expiresAt: string;
  approver: {
    id: string;
    name: string;
    role: "owner" | "manager";
  };
}
```

The current discount approval route may remain as a compatibility wrapper during migration, but all new UI should use the generic operation.

### 4.2 Action union

```ts
type ManagerApprovalAction =
  | {
      kind: "discount";
      lines: Array<{ productId: string; qty: number; lineDiscountMinor: number }>;
      orderDiscountMinor: number;
    }
  | {
      kind: "refund";
      saleId: string;
      items: Array<{ saleItemId: string; qty: number }>;
      reason?: string;
    }
  | {
      kind: "sale_void";
      saleId: string;
      reason: string;
    }
  | {
      kind: "inventory_movement";
      productId: string;
      movementType: string;
      qtyDelta: number;
      reason?: string;
      branchId?: string;
    }
  | {
      kind: "shift_close";
      shiftId: string;
      countedCashMinor: number;
      closeNotes?: string;
    };
```

The fingerprint is produced by canonical server serialization after schema validation. Order-sensitive collections such as refund items are normalized before hashing so equivalent payload ordering cannot create a different grant.

### 4.3 Permission mapping

The server enforces the action/permission pairing and rejects arbitrary combinations:

| Action | Required approval permission |
| --- | --- |
| over-threshold discount | `discount.override` |
| refund approval at/below threshold | `sale.refund` |
| refund approval above configured threshold | `refund.override` |
| sale void | `sale.void` |
| inventory movement requiring override | `inventory.adjust` |
| close another actor's shift | `shift.close.override` |

For a refund above the configured threshold, an owner approval for `refund.override` is sufficient for the one action because owners holding `refund.override` also hold `sale.refund`. The consume path may inject both permissions into the service call for that request only.

Managers remain ineligible for `refund.override` because the existing role seed intentionally keeps that permission owner-only.

## 5. Protected workflow behavior

### 5.1 Refund approval

Current sale detail UI already contains request/approve/reject flows.

The current frontend/server permission model has a usability mismatch: cashiers can navigate to Sales but cannot initiate the refund workflow, while the `inventory` role is currently shown refund controls even though its role seed does not include `sale.refund`. Correct that as part of this slice.

Refund initiation rules become:

- owner/manager: keep the existing standing-permission flow;
- cashier: may create a refund request for review without receiving the money-moving `sale.refund` permission;
- inventory role: does not receive refund controls merely because it can open the route;
- any user performing the actual refund approval still needs standing `sale.refund` or an in-context approval grant;
- above the configured threshold, the actual approval requires owner-only `refund.override`.

The refund request itself remains audited and idempotent but is no longer treated as the privileged money-moving step. Rejecting or approving a request remains protected.

Change the approve path so an eligible requester who lacks the required standing permission can request an in-context manager approval rather than receiving a dead-end `FORBIDDEN`.

Flow:

1. requester selects exact refundable quantities and optional reason;
2. client submits refund approval normally;
3. if server returns `FORBIDDEN` because `sale.refund` or `refund.override` is missing, keep the refund modal data intact and open manager approval;
4. approval request uses the exact sale ID, quantities, and reason;
5. on success, retry the same refund with `approvalToken`;
6. server determines whether the threshold requires `sale.refund` or `refund.override`, consumes a matching token, and executes using transient permissions;
7. audit records the requester as the operational actor and the approver in explicit approval metadata.

The server must not trust the client's claim about which refund permission is required.

### 5.2 Sale void/cancel

The backend already exposes `POST /api/v1/sales/:id/void`, but the sale-detail UI does not currently surface a complete void workflow.

Add an app-owned confirmation/modal on eligible sale states. The requester enters a required reason. If standing `sale.void` permission is absent, the same modal remains intact while manager approval is collected, then the exact void action retries automatically.

The approval fingerprint includes sale ID and normalized reason. Changing the reason after approval invalidates the grant.

### 5.3 Inventory movement

The inventory page already records explicit audited movements and the API requires `inventory.adjust`.

Inventory is already a discoverable workspace for cashiers, but the movement form is currently hidden because the cashier role lacks `inventory.adjust`. Make that existing workspace approval-aware rather than granting a permanent permission:

- owner/manager/inventory roles keep the standing-permission movement form;
- cashier may open the same movement form, but the primary action is presented as requiring supervisor approval;
- the cashier never receives `inventory.adjust` outside the exact approved request;
- no other inventory-management surface is unlocked solely because approval exists.

When a visible user attempts a movement without standing `inventory.adjust`, collect manager approval for the exact product, type, quantity, reason, and effective branch, then retry with the token.

Branch context is part of the fingerprint. A token minted for one branch cannot authorize a movement in another branch.

### 5.4 Shift close override

Closing one's own shift continues to use the user's standing `shift.close` behavior and does not require a manager approval.

When the shift was opened by another actor and the service requires `shift.close.override`:

1. preserve counted cash in the existing close dialog;
2. open manager approval after the protected-action response;
3. bind approval to shift ID, counted cash, and close notes;
4. retry once with the token;
5. server consumes the grant only if the shift is still open and the exact close payload still matches.

If the shift was closed or changed before retry, the approval is not reusable.

## 6. API integration pattern

Protected operation schemas gain an optional `approvalToken` field where required:

- refund approval body;
- sale void body;
- inventory movement body;
- shift close body.

Controllers follow one pattern:

1. compute the authoritative required permission from current domain state;
2. if the requester already has it, continue without a token;
3. otherwise require an approval token;
4. compute the canonical server fingerprint for the exact parsed operation;
5. consume the token with business ID, requester ID, required permission, and fingerprint;
6. add only the transient permission(s) needed for this call;
7. pass explicit approval metadata to the domain service for audit;
8. execute the operation.

The approval token is never forwarded deeper than necessary and is never copied into domain records, audit `before/after` payloads, logs, or error text.

## 7. Audit model

Every approved action must preserve:

- requester user ID;
- approver user ID;
- approver role at consume time;
- approved permission;
- protected entity type/id;
- request/correlation ID;
- action-specific reason where the domain already stores one.

The existing `manager.approval.granted` audit entry remains. The protected action's own audit entry gains approval metadata, for example:

```ts
approval: {
  approverId: string;
  permission: string;
}
```

Do not replace the operational actor with the approver. Reports and accountability must still show who performed the action at the terminal.

## 8. Frontend interaction contract

### 8.1 Shared approval dialog

Refactor the existing POS-specific manager approval dialog into a reusable app-owned component while preserving its visual language, masked PIN, password fallback, accessibility, focus behavior, and security copy.

The component receives:

- title/description for the protected action;
- concise action summary;
- required permission label only when useful to advanced users;
- busy/error state;
- approve/cancel handlers.

Credentials remain component-local and are cleared on close, success, and mode switch where appropriate.

### 8.2 Pending action state

Each owning screen keeps the pending operation in component memory only:

- refund quantities/reason;
- void reason;
- inventory movement fields;
- shift counted cash/notes.

No approval-sensitive payload or token is written to URL params, localStorage, sessionStorage, IndexedDB/offline queues, or TanStack persisted caches.

### 8.3 Failure recovery

- Wrong PIN/password: approval dialog remains open with generic credential failure.
- Approval expires/is used/mismatched: original operation stays intact; user can request a fresh approval.
- Domain state changed: close approval dialog, refresh authoritative data where appropriate, and explain that the action must be reviewed again.
- Offline: do not offer approval; show that manager authorization requires an online connection.
- Server error after grant consumption: do not silently mint/reuse another token; keep the domain state authoritative and require a fresh approval only if the operation did not complete.

## 9. Security and abuse controls

Preserve existing credential protections and add:

- approval request rate limiting by business/requester plus approver identifier where practical;
- generic invalid-credential responses that do not reveal whether an email, PIN, password, membership, or permission failed;
- permission/action allow-list on the approval endpoint;
- atomic one-use consume lock;
- revalidation of active membership, owner/manager role, email verification, permission, expiry, requester, and fingerprint at consume time;
- no approval token in query strings or GET routes;
- log redaction for `approvalToken`, `pin`, `password`, and verifier/hash fields;
- anti-replay tests across businesses, requesters, permissions, entities, branches, payload changes, expiry, and concurrent consume.

## 10. UX and discoverability

Use the current NexPOS premium modal/button system and `UX-CONTRACT.md` conventions.

The approval flow is an escalation inside the action the user already started. It must not redirect the requester to Team, Login, or another manager account.

Protected actions must explain the operational consequence first, not the permission implementation. Permission codes may appear as secondary help text where the product already exposes them.

No browser `alert`, `confirm`, or `prompt`.

## 11. Testing contract

### 11.1 Validation

Add schema tests for:

- exactly one PIN/password credential;
- allowed permission/action combinations;
- each action payload;
- optional approval token fields on protected operations;
- rejection of unknown action kinds and arbitrary permissions.

### 11.2 API/unit

Cover:

- mint and consume for each supported permission;
- cross-business and cross-requester rejection;
- fingerprint mismatch after payload edits;
- owner-only refund override;
- manager refund approval at/below threshold;
- sale void approval;
- branch-bound inventory approval;
- own-shift close without override;
- other-actor shift close with one-use approval;
- expiry and concurrent consume;
- audit requester/approver linkage;
- secrets/tokens absent from log context.

### 11.3 Web/component

Cover:

- shared approval dialog PIN/password modes;
- pending action preserved after wrong credential;
- automatic retry after approval;
- token not persisted;
- action-specific copy and summaries;
- offline approval disabled;
- focus restoration and keyboard close behavior.

### 11.4 Browser

Run desktop, tablet, and mobile flows for:

1. cashier refund approval by manager PIN;
2. owner-only over-threshold refund approval;
3. cashier/staff sale void with manager approval;
4. inventory movement with exact branch-bound approval;
5. closing another user's shift with approval;
6. wrong-PIN recovery followed by success;
7. reused/mismatched token rejection;
8. browser storage scan proving PIN/password/token absence.

All existing discount approval, checkout, refund, inventory, shift, receipt/printer, and full critical-path suites must remain green.

## 12. Delivery boundaries

This approval expansion is complete when the four protected workflows are end-to-end discoverable, server-authoritative, audited, responsive, and browser-verified.

After this slice, the agreed sequence remains:

1. provider-backed electronic-tender exchanges;
2. Phase C inventory lifecycle: suppliers/vendors, purchase orders, receiving, supplier returns, physical counts, barcode labels, replenishment, variants/bundles.
