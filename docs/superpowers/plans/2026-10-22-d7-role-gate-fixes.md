# D7 Role-Gate Fixes - Implementation Plan

> Agentic worker: execute task by task with superpowers:test-driven-development (RED-GREEN-REFACTOR).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server's own permission list the web app's single source of truth for
authorization, closing the three role-gate findings the D7 staging QA raised on build 6d783bc.

**Scope:** F-D7-04 (SEV-2), F-D7-09 (SEV-3), F-D7-10 (SEV-3). Nothing else.

**Tech Stack:** TypeScript, Next.js App Router, TanStack Query, Vitest, React 18 static render.

**Branch:** `codex/d7-role-gate-fixes-20261022` at `6d783bc` (the deployed commit).
**Worktree:** `G:\Vscode\POS\.worktrees\nexpos-d7-role-gates-20261022`

**Source blueprint:** `docs/superpowers/audits/2026-10-20-frontend/REPORT.md` section 7, plus
`NexPOS_Staging_QA_D7_Roles_POS01_6d783bc_2026-10-22.txt` sections 4, 5 and 6.

---

## Root cause (established by investigation, not assumption)

The web app re-derives authorization three different ways, while the server's actual authority
is `ROLE_SEED` in `apps/api/src/tenant/seed.ts` plus per-membership denials, and is already
exposed to the client as `permissions` on `GET /api/v1/me`
(`apps/api/src/auth/nest/tenant.controller.ts`). The client never reads it.

| Finding | Root cause | Site |
|---|---|---|
| F-D7-04 | The onboarding surface never learns the session's permissions. It only treats GET /api/v1/onboarding returning 401/403 as unauthorized, but that endpoint has no role guard, so it returns 200 for every member. The page then renders the owner editor for any role, including an editable tax form and an enabled "Save & continue". | `apps/web/src/app/onboarding/page.tsx` |
| F-D7-09 | The gift-card list query's error state is never rendered. Only `isLoading` and `data.length === 0` are handled, so a 403 renders as "Cards 0 / Active cards 0 / Outstanding liability PHP 0.00 / No gift cards have been issued." | `apps/web/src/app/gift-cards/page.tsx` |
| F-D7-10 | The workspace navigation keeps hand-maintained per-role item lists that duplicate the server's permission model. The cashier list includes gift-cards, but `gift_card.manage` is withheld from the cashier, so the API refuses the read with 403. | `apps/web/src/lib/workspace-navigation.ts` |

Server-side enforcement already exists and was verified on staging: `patchSettings` and
`patchOnboarding` both throw FORBIDDEN without `settings.write`, and `settings.write` is
owner-only for manager, cashier and inventory. These findings are therefore a client-side
authorization-surface defect, not a privilege escalation. The server stays the authority; the
client must stop contradicting it.

**Global constraints**
- No assertion may be weakened. No existing test may be deleted or skipped.
- The server's permission list is the source of truth. Do not add a second hand-maintained
  role-to-permission table in the web app.
- `GET /api/v1/me` is already cached by TanStack Query under the key `["me"]`, and `AppShell`
  already queries it. Reading `permissions` from that query costs no extra request.
- Fail CLOSED on a write surface: if the permission list is unknown, the owner-only editor must
  not render. Fail OPEN only where a missing permission list cannot expose a write.
- No new runtime dependency.

---

## Task 1: A shared permission helper

**Files:**
- Create: `apps/web/src/lib/role-permissions.ts`

- [ ] **Step 1: Write the failing test**

  Create `apps/web/src/lib/role-permissions.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { hasPermission } from "./role-permissions";

  describe("hasPermission", () => {
    it("grants a permission the server listed", () => {
      expect(hasPermission(["settings.write", "gift_card.manage"], "settings.write")).toBe(true);
    });

    it("refuses a permission the server did not list", () => {
      expect(hasPermission(["gift_card.manage"], "settings.write")).toBe(false);
    });

    it("refuses everything when the server sent no permission list", () => {
      expect(hasPermission(undefined, "settings.write")).toBe(false);
      expect(hasPermission([], "settings.write")).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run it and watch it fail**

  ```powershell
  Set-Location G:\Vscode\POS\.worktrees\nexpos-d7-role-gates-20261022\apps\web
  pnpm exec vitest run src/lib/role-permissions.test.ts
  ```

  Expected: FAIL - the module does not exist.

- [ ] **Step 3: Write the minimum implementation**

  `apps/web/src/lib/role-permissions.ts`:

  ```ts
  /**
   * The API is the authority on what a session may do: GET /api/v1/me returns the
   * effective permission list, which already accounts for the role seed and for
   * per-membership denials. The web app reads that list instead of re-deriving
   * authorization from a role name, so the two cannot drift apart.
   */
  export function hasPermission(granted: readonly string[] | undefined, required: string): boolean {
    return granted?.includes(required) === true;
  }
  ```

- [ ] **Step 4: Run it and watch it pass**

  Expected: 3 passed.

---

## Task 2: The nav must not offer a destination the server refuses

**Files:**
- Modify: `apps/web/src/lib/workspace-navigation.ts`
- Modify: `apps/web/src/lib/workspace-navigation.test.ts`
- Modify: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: Write the failing test**

  Append to `apps/web/src/lib/workspace-navigation.test.ts`:

  ```ts
  it("hides a destination the server refuses for this session", () => {
    const withoutGiftCards = workspaceNavigationForRole("cashier", ["pos.read", "sale.create"]);
    const hrefs = withoutGiftCards.flatMap((group) => group.items).map((item) => item.href);

    expect(hrefs).not.toContain("/gift-cards");
  });

  it("keeps a destination the server granted for this session", () => {
    const withGiftCards = workspaceNavigationForRole("cashier", ["gift_card.manage"]);
    const hrefs = withGiftCards.flatMap((group) => group.items).map((item) => item.href);

    expect(hrefs).toContain("/gift-cards");
  });

  it("keeps every owner destination when the owner holds every permission", () => {
    const hrefs = workspaceNavigationForRole("owner", ["settings.write", "gift_card.manage"])
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toContain("/gift-cards");
    expect(hrefs).toContain("/onboarding");
  });
  ```

- [ ] **Step 2: Run it and watch it fail**

  Expected: FAIL - `workspaceNavigationForRole` ignores its second argument.

- [ ] **Step 3: Write the minimum implementation**

  In `apps/web/src/lib/workspace-navigation.ts`, add after the `ITEMS` map:

  ```ts
  /**
   * Destinations the API decides per session. The session's own permission list is
   * the only authority here: a hand-written per-role list drifted once already and
   * offered a cashier a surface the API answers with 403.
   */
  const PERMISSION_GATED: Record<string, string> = {
    "/gift-cards": "gift_card.manage",
    "/onboarding": "settings.write",
  };
  ```

  The map is keyed by href rather than by an item key, so the item shape stays
  unchanged and no new field has to be threaded through the navigation types.

  Extract the existing per-role lists into a local `navigationGroupsForRole(role)` and
  filter on the permission list:

  ```ts
  export function workspaceNavigationForRole(role?: string, permissions?: readonly string[]): WorkspaceNavigationGroup[] {
    const groups = navigationGroupsForRole(role);
    if (permissions === undefined) return groups;
    return groups
      .map((entry) => ({
        label: entry.label,
        items: entry.items.filter((item) => {
          const required = PERMISSION_GATED[item.href];
          return required === undefined || permissions.includes(required);
        }),
      }))
      .filter((entry) => entry.items.length > 0);
  }
  ```

  `flattenedWorkspaceNavigation` keeps its signature and gains the same optional
  `permissions` argument.

  Verified while implementing: the only surface that offered a cashier "Gift cards" was
  the AppShell workspace navigation, which now filters. `AtlasCashierNavigation` carries
  its own four links and never named gift cards, and `AtlasWorkspaceDestinations` is
  rendered only for owner, manager, inventory and approval rails, all of which either
  hold `gift_card.manage` or never list that destination. No extra threading is needed.

- [ ] **Step 4: Pass the session's permissions in**

  In `apps/web/src/components/AppShell.tsx`, add `permissions: string[]` to the `/api/v1/me`
  response type and pass them to the navigation:

  ```tsx
  const navigationGroups = workspaceNavigationForRole(currentRole, shellMe.data?.permissions);
  ```

- [ ] **Step 5: Run the navigation and AppShell tests**

  ```powershell
  pnpm exec vitest run src/lib/workspace-navigation.test.ts src/components/AppShell.test.tsx
  ```

  Expected: all pass, including the pre-existing role-list assertions, which must not change.

---

## Task 3: The owner-only setup surface must refuse a session without the permission

**Files:**
- Modify: `apps/web/src/app/onboarding/page.tsx`
- Modify: `apps/web/src/app/onboarding/page.test.tsx`

- [ ] **Step 1: Write the failing test**

  The existing test file mocks `@tanstack/react-query` with a `useQuery` keyed on
  `queryKey[0]`. Extend that mock so a `["me"]` query returns the session, then add:

  ```tsx
  it("refuses business-settings editing for a session without settings.write", () => {
    fixture.permissions = ["pos.read", "sale.create"];
    fixture.role = "manager";
    fixture.data.currentStep = "taxCurrency";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("You do not have access to business setup");
    expect(html).not.toContain("Save &amp; continue");
    expect(html).not.toContain("Tax rate (%)");
  });

  it("refuses business-settings editing when the server sent no permission list", () => {
    fixture.permissions = undefined;
    fixture.role = "manager";
    fixture.data.currentStep = "taxCurrency";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("You do not have access to business setup");
    expect(html).not.toContain("Save &amp; continue");
  });
  ```

  In the mock, the `["me"]` branch returns `{ role: fixture.role, permissions: fixture.permissions }`,
  and `beforeEach` resets `fixture.permissions = ["settings.write"]` and `fixture.role = "owner"`
  so every pre-existing test keeps its owner session.

- [ ] **Step 2: Run it and watch it fail**

  Expected: FAIL - the page renders the editor for a manager.

- [ ] **Step 3: Write the minimum implementation**

  In `apps/web/src/app/onboarding/page.tsx`:

  - import `hasPermission` from `../../lib/role-permissions`
  - add a session query, reusing the cached `["me"]` key:

    ```ts
    const session = useQuery({
      queryKey: ["me"],
      queryFn: () => apiFetch<{ role: string; permissions?: string[] }>("/api/v1/me"),
      retry: false,
    });
    ```

  - compute the gate and render the refusal BEFORE the editor, next to the existing
    `unauthorized` branch:

    ```ts
    const mayEditSettings = hasPermission(session.data?.permissions, "settings.write");
    ```

    ```tsx
    if (!mayEditSettings) {
      return (
        <main role="status" className="atlas-entry grid min-h-screen place-items-center p-6 text-center">
          <div className="max-w-md space-y-3">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">You do not have access to business setup.</p>
            <p className="text-sm text-[var(--color-atlas-muted-strong)]">
              Business settings are changed by the owner. Ask an owner to make this change.
            </p>
            <a href="/" className="inline-block text-sm font-semibold text-[var(--color-atlas-accent-strong)]">← Back to workspace</a>
          </div>
        </main>
      );
    }
    ```

  The refusal must sit after the `query.isLoading` guard and before any editor markup, so a
  signed-out visitor is not told they lack permission.

- [ ] **Step 4: Run the onboarding tests**

  Expected: all pass, including the 13 pre-existing owner cases, which must not change.

---

## Task 4: A refused read must not look like an empty register

**Files:**
- Create: `apps/web/src/app/gift-cards/page.test.tsx`
- Modify: `apps/web/src/app/gift-cards/page.tsx`

- [ ] **Step 1: Write the failing test**

  Create `apps/web/src/app/gift-cards/page.test.tsx` with the same static-render pattern used
  in `apps/web/src/app/onboarding/page.test.tsx`, mocking `@tanstack/react-query` so that the
  `["gift-cards"]` query can be made to fail with an `ApiError` carrying status 403, and the
  `["me"]` query returns a cashier session:

  ```tsx
  it("states that the session may not read gift cards instead of showing an empty register", () => {
    fixture.cardsError = { status: 403, code: "FORBIDDEN", message: "Forbidden" };

    const html = renderToStaticMarkup(<GiftCardsPage />);

    expect(html).toContain("You do not have access to gift cards");
    expect(html).not.toContain("No gift cards have been issued.");
    expect(html).not.toContain("Outstanding liability");
  });

  it("states that the register could not be loaded when the read failed for another reason", () => {
    fixture.cardsError = { status: 500, code: "SERVER", message: "Boom" };

    const html = renderToStaticMarkup(<GiftCardsPage />);

    expect(html).toContain("Could not load gift cards");
    expect(html).not.toContain("No gift cards have been issued.");
  });
  ```

- [ ] **Step 2: Run it and watch it fail**

  Expected: FAIL - the page renders the empty register.

- [ ] **Step 3: Write the minimum implementation**

  In `apps/web/src/app/gift-cards/page.tsx`:

  - widen the `Me` interface to carry the server's permission list:

    ```ts
    interface Me { role: string; businessName?: string; permissions?: string[] }
    ```

  - replace the hand-written role list for issuing with the server's permission:

    ```ts
    const canIssue = hasPermission(me.data?.permissions, "gift_card.manage");
    ```

  - render the refused and failed states instead of zeros. The summary metric cards and the
    register table must not render when the read failed, so a refused read cannot present
    zeros as truth:

    ```tsx
    {cards.isError ? (
      <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4">
        <p role="alert" className="text-sm font-medium text-[#c43e3e]">
          {cards.error instanceof ApiError && cards.error.status === 403
            ? "You do not have access to gift cards."
            : "Could not load gift cards."}
        </p>
        {cards.error instanceof ApiError && cards.error.status === 403 ? (
          <p className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">Gift-card balances are limited to roles that manage stored value.</p>
        ) : (
          <button type="button" onClick={() => void cards.refetch()} className="mt-3 text-sm font-semibold text-[var(--color-atlas-accent-strong)]">Try again</button>
        )}
      </Panel>
    ) : null}
    ```

    and wrap the summary section and the register so they only render when
    `!cards.isError`.

- [ ] **Step 4: Run the gift-card tests**

  ```powershell
  pnpm exec vitest run src/app/gift-cards/page.test.tsx
  ```

  Expected: 2 passed.

---

## Task 5: Verification gate

**Files:** none modified.

- [ ] **Step 1: Run the web test suite**

  ```powershell
  Set-Location G:\Vscode\POS\.worktrees\nexpos-d7-role-gates-20261022\apps\web
  pnpm test
  ```

  Expected: every file passes, no test skipped or deleted.

- [ ] **Step 2: Typecheck and lint**

  ```powershell
  pnpm typecheck
  pnpm lint
  ```

  Expected: exit 0, no new warning.

- [ ] **Step 3: Re-run the specific contract tests that cover the audit findings**

  ```powershell
  pnpm exec vitest run src/lib/atlas-contrast.test.ts src/lib/atlas-a11y-contract.test.ts src/lib/pos-checkout-feedback.test.ts src/components/PosPaymentWorkspace.test.tsx
  ```

  Expected: 53 passed.

- [ ] **Step 4: Confirm the diff is scoped**

  ```powershell
  git -C G:\Vscode\POS\.worktrees\nexpos-d7-role-gates-20261022 diff --stat 6d783bc
  ```

  Expected: only the files named in this plan, plus the new files.

- [ ] **Step 5: Record the evidence**

  Write the commands and outcomes into the QA record. Do not claim a pass that was not observed.

---

## Out of scope

- The other D7 findings (F-D7-01 404 recovery, F-D7-02 Show toggle target, F-D7-03 11px
  labels, F-D7-05 missing H1, F-D7-06 contrast, F-D7-07 12px floor, F-D7-08 Active branch
  target, F-D7-11 double H1). Each needs its own change and its own review.
- Any server-side change. The server already enforces these rules correctly.
- Any deployment, push, PR or merge. Those need owner approval.
