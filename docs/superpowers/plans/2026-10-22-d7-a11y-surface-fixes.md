# D7 accessibility surface fixes - Implementation Plan

> Agentic worker: execute task by task with superpowers:test-driven-development (RED-GREEN-REFACTOR).

**Goal:** Close the eight D7 findings that are not permission gates, on top of the deployed build
`8214954`.

**Scope:** F-D7-01, F-D7-02, F-D7-03, F-D7-05, F-D7-06, F-D7-07, F-D7-08, F-D7-11. Nothing else.

**Branch:** `codex/d7-a11y-surface-fixes-20261022` at `8214954`.
**Worktree:** `G:\Vscode\POS\.worktrees\nexpos-d7-role-gates-20261022`

**Source blueprint:** `docs/superpowers/audits/2026-10-20-frontend/REPORT.md` section 7
(Accessibility, Transaction UX, Release and environment) and
`NexPOS_Staging_QA_D7_Roles_POS01_6d783bc_2026-10-22.txt` section 6.

---

## Why these eight, and what they have in common

Every one of them is a statement the operator has to read or act on, and every one of them was
measured on the live staging build rather than inferred. Two of them (F-D7-01, F-D7-11) are also
the audit's structural items: a page with no recovery path, and a page with two h1s.

The design system already has the answer for most of this and the repo enforces it:

- `apps/web/src/lib/atlas-contrast.test.ts` enumerates every `text-[...]` foreground in the shared
  primitives and gates it at 4.5:1. Its own comment records the precedent:
  "Primary buttons carry the brand coral. The label is small semibold text, so WCAG AA needs
  4.5:1 on the resting fill AND on hover - white on coral measures 3.26:1, which is why the label
  is an ink tone here rather than white." The workspace avatar is the same pairing that was
  already fixed on the primary button and was missed.
- `--color-atlas-muted-strong` (#53615a) is the documented text token for muted labels and clears
  4.5:1 on both the surface and the canvas. `--color-atlas-accent-strong` (#a8452f) is the
  documented text accent. The literals still in the shell - `#84786e` and `#758078` - are not
  tokens and are not on the approved text list.
- `apps/web/src/lib/atlas-a11y-contract.test.ts` is the house pattern for this kind of fix: a
  source contract for the smallest scoped change, with the comment "the rendered contrast and hit
  areas are also checked in Playwright against the real browser". This plan follows it: a source
  contract AND a rendered browser gate.

**Global constraints**
- No assertion may be weakened or deleted.
- Do not introduce a new colour. Use the existing tokens and the ink-on-coral pairing that the
  primary button already uses.
- Do not change the shared `PageHeader` eyebrow (10px). It is a structural label on every page,
  it was not one of the measured findings, and changing it is a global design change rather than
  a scoped fix. Stated as a deliberate boundary.
- Keep every control at or above the 24px minimum target; primary controls stay at 44px.
- No new runtime dependency, no server change, no migration, no environment variable.

---

## Task 1: The workspace shell chrome (F-D7-06, F-D7-07, F-D7-08)

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/AtlasWorkspaceDestinations.tsx`
- Create: `apps/web/src/lib/atlas-shell-a11y-contract.test.ts`
- Create: `e2e/atlas-shell-accessibility.spec.ts`

**Measured violations to close**

| Site | Now | Fix |
|---|---|---|
| Avatar initial (two sizes) | white on coral, 3.26:1, 11px | ink `#17130f` on coral, 5.67:1, 12px |
| Branch scope line ("manager - All branches") | `#84786e` on white, 4.29:1, 8px | `--color-atlas-muted-strong`, 6.5:1, 12px |
| Nav group labels (Sell, Catalog & stock, ...) | `#758078` on canvas, 3.85:1, 10px | `--color-atlas-muted-strong`, 12px |
| "Active branch" selects (two) | 8px/9px/10px text, 16px tall | 12px text, 32px tall |
| Date, "Today", role chip, status chip, sign-out, footer, "More", mobile nav button | 9-11px | 12px |

- [ ] **Step 1: Write the failing source contract**

  `apps/web/src/lib/atlas-shell-a11y-contract.test.ts` asserts, over the shell source:
  - no `text-[8px]`, `text-[9px]`, `text-[10px]` or `text-[11px]` remains in the shell chrome
  - no `text-white` remains on the coral avatar
  - `#84786e` and `#758078` are gone from the shell
  - `--color-atlas-muted-strong` is used for the muted labels
  - every `select` with `aria-label="Active branch"` carries a min-height class

  It must also assert that it actually read something, the way
  `atlas-contrast.test.ts` does with its recount, so a scan that stops matching cannot pass.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the failing browser gate**

  `e2e/atlas-shell-accessibility.spec.ts` signs in as a manager and measures the RENDERED shell
  header and workspace destinations:
  - every visible text node computes to at least 12px
  - every visible text node measures at least 4.5:1 against its resolved opaque background
  - every visible control measures at least 24x24
  It must resolve the background by walking up to the first opaque ancestor, and it must fail
  loudly if it collects no nodes.

- [ ] **Step 4: Fix the source**

  As tabulated above. The avatar becomes `text-[#17130f]` on the same coral fill, which is the
  pairing `PrimaryButton` already uses and the contrast contract already documents.

- [ ] **Step 5: Run the contract, the browser gate and the existing suites**

---

## Task 2: The sign-in controls (F-D7-02, F-D7-03)

**Files:**
- Modify: `apps/web/src/app/globals.css` (`.atlas-eyebrow` 11px -> 12px)
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/register/page.tsx`
- Modify: `apps/web/src/lib/atlas-shell-a11y-contract.test.ts`

- [ ] **Step 1: Write the failing tests**
  - The source contract gains: `.atlas-eyebrow` must not be 11px, and the password visibility
    toggle must not be smaller than 44px with an 11px label.
  - The browser gate gains the sign-in page: the toggle's box is at least 44px and its label at
    least 12px.

- [ ] **Step 2: Watch them fail**

- [ ] **Step 3: Fix the source**
  - `.atlas-eyebrow { font-size: 12px }` in globals.css. It is used in four places, all of them
    auth or setup eyebrows, so one token change covers F-D7-03.
  - The Show/Hide button on both auth pages becomes a real control: `min-h-11` (44px), a 12px
    label, and the input's right padding grows so the label is not covered.

- [ ] **Step 4: Run the tests**

---

## Task 3: The 404 recovery path and the inventory headings (F-D7-01, F-D7-05, F-D7-11)

**Files:**
- Create: `apps/web/src/app/not-found.tsx`
- Modify: `apps/web/src/components/AtlasInventorySafeguards.tsx`
- Modify: `apps/web/src/app/inventory/access/page.tsx`
- Modify: `apps/web/src/components/AtlasInventoryWorkbench.tsx`
- Create: `apps/web/src/app/not-found.test.tsx`
- Modify: `apps/web/src/lib/atlas-shell-a11y-contract.test.ts`

- [ ] **Step 1: Write the failing tests**
  - `not-found.test.tsx`: the 404 page renders an h1, and it offers a way back to the workspace
    and to sign in, with 44px hit areas.
  - The source contract gains: `apps/web/src/app/not-found.tsx` must exist and contain a link to
    `/`; `AtlasInventoryWorkbench` must not render an h1; `AtlasInventorySafeguards` must accept a
    heading level.
  - A browser gate for the inventory surfaces: exactly one visible h1 on /inventory for the
    inventory role, and exactly one on /inventory/access.

- [ ] **Step 2: Watch them fail**

- [ ] **Step 3: Fix the source**
  - `not-found.tsx` follows the house failure-page pattern from `app/error.tsx`, but it is a
    PUBLIC page, so it uses the Atlas entry surface rather than the cream error card, and it
    offers a real recovery path instead of a retry: back to the workspace, or to sign in.
  - Revision during the full-suite verification: the first approach made the safeguards block
    render the h1 on /inventory/access. The pre-existing e2e contract
    (`e2e/atlas-v4-inventory.spec.ts:22`) asserts that the block title "Restricted action" is a
    level-2 heading, and its intent is right - the four sibling inventory pages all own their h1
    through the shared PageHeader and keep the safeguards block at h2. So /inventory/access now
    does the same: a PageHeader ("Manager-protected adjustments", the label the inventory
    workbench already links with) owns the h1, the safeguards block stays h2, and the
    `headingLevel` prop came back out of the component.
  - `AtlasInventoryWorkbench`'s heading stays the page's h1, and for the inventory role the
    `PageHeader` renders as `titleAs="h2"`, leaving exactly one h1 on /inventory for that role.

- [ ] **Step 4: Run the tests**

---

## Task 4: Verification gate

- [ ] **Step 1** `pnpm test` in apps/web, and `pnpm test` at the repo root.
- [ ] **Step 2** `pnpm typecheck`, `pnpm lint` (0 errors, the one pre-existing warning).
- [ ] **Step 3** The four audit contract files still pass 53/53.
- [ ] **Step 4** The new browser gates pass, and the whole e2e suite passes.
- [ ] **Step 5** Re-measure the live staging shell with the same harness that found the
      violations, after the deploy, and confirm the counts are zero.
- [ ] **Step 6** Record the evidence. Do not claim a pass that was not observed.

## Out of scope

- The `PageHeader` eyebrow at 10px and every other 10-11px label outside the shell chrome.
- Any change to the API, the data model, or the permission model.
- F-D7-04, F-D7-09 and F-D7-10. They were fixed, merged and deployed as `8214954`.
