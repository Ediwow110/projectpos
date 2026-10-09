# Onboarding and dashboard route audit — 2026-10-10

## Baseline and isolation

- Local branch: `codex/local-main-pr20-20261009`. The pre-fix HEAD was `47206ad9ff5deba764acc59551b668bd03aa346d`; the local fix commit is recorded below.
- `origin/main` and GitHub main: `2c3ace096bfa5636e166163d8c6c4110b3b77888`. Local branch is three commits ahead and zero behind.
- Browser tests used the repository's `pnpm e2e` runner on `localhost:3100/3101`. `DATABASE_URL` and `E2E_EXTERNAL_SERVERS` were unset, so the API used a disposable in-memory database. Test owners used unique `@example.test` addresses. No production tenant or payment was touched.
- Direct API probes used a separate `createTestApp()` in-memory database. The temporary probe test was removed after recording the responses.

## Results

| Case | Result | Evidence |
| --- | --- | --- |
| Incomplete owner opens `/`, `/inventory`, `/products`, then reloads | Pass | Real browser/API test returns to `/onboarding`; Page Object confirms required-step guidance. |
| Incomplete owner opens `/inventory` in a second tab | Pass | Real browser/API test returns to `/onboarding`. |
| Incomplete owner uses browser Back and Forward | Pass, mocked profile | `workspace-access.spec.ts` returns to the setup page and never renders workspace navigation. |
| Completed owner, no sales, opens `/` | Pass | Dashboard renders `Getting started` and no `Continue setup` link. Tested with mocked overview and a real disposable owner. |
| Signed-out direct `/onboarding` | Pass | Real browser/API test resolves to `/login`; no indefinite setup spinner. |
| Required business, currency/tax, or receipt step is skipped via API | Pass | Contract test returns HTTP 400 `ONBOARDING_REQUIRED_STEP`; real browser checks currency/tax. |
| Optional products and employees are skipped | Pass | Real browser/API test persists both as `skipped` and reaches `/`. |
| Optional step resolves before required currency and receipt | Pass, domain test | `onboarding.test.ts` keeps `currentStep` on the first required pending step and `isOnboardingComplete=false`. |
| Stored required step is incorrectly `skipped` | Pass, domain test | Normalization restores it to `pending` and keeps setup required. |
| Onboarding API returns malformed 200 data | Pass, mocked API | Wizard shows a recoverable error and `Try again`; no wizard content renders. |
| Cached identity receives HTTP 401 or 403 | Pass, mocked API | Workspace routes return to login and clear active sync scope. |
| Previously complete owner becomes incomplete | Pass, mocked API | Refresh redirects from Dashboard to onboarding. |
| Dashboard overview returns HTTP 503 | Pass, mocked API | Dashboard shows the API error and does not render getting-started content or KPI cards. |
| Direct protected API access by incomplete owner | **Fail** | The isolated real API probe returned HTTP 200 for `/api/v1/dashboard/overview?compare=none`, `/api/v1/products`, and `/api/v1/inventory/balances` while `/api/v1/me` reported `onboardingRequired=true`. `SessionGuard` authenticates the owner but does not enforce onboarding state. |
| `/dashboard` alias | Not run | The Next build lists `/` as the dashboard and has no `/dashboard` route. Current links use `/`. |
| PostgreSQL parity | Pass | 157/157 tests passed against a new disposable PostgreSQL 16 container, removed after the run. |
| Staging and production release smoke | Not run | No staging deploy or production account was used. Production account identity was not assumed. |

The direct API result is a workflow bypass for an authenticated owner of the same tenant. It does not show cross-tenant access. The current onboarding contract test explicitly expects HTTP 200 from dashboard overview while a required step remains pending. A server-side onboarding policy would need a separate, reviewed change across protected API routes and setup exceptions; the browser redirect alone does not enforce that policy.

## Verification and release state

- Baseline before the UI fix: targeted desktop Playwright run had 5 pass and 2 fail. The failures were the stale dashboard CTA and signed-out onboarding redirect.
- After the fix: the targeted browser matrix passed 36/36 across desktop, tablet, and mobile. The full local E2E gate passed 237/237.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:exit` (68/68), `pnpm verify`, `pnpm build`, and `pnpm audit --prod --audit-level critical` passed after `pnpm install --frozen-lockfile`.
- PostgreSQL parity passed 157/157 against a new disposable container. Phase verification scripts 0–12 passed. Focused API onboarding contract passed 6/6; focused domain onboarding tests passed 7/7; web onboarding unit tests passed 2/2.
- The real browser onboarding test captured no uncaught page errors. Expected API 400 from the required-step skip is handled in the UI.
- Local CI-equivalent commands passed. GitHub Actions has not run for this local fix. Staging verification is not claimed.
- Phase 22 remains open. The direct API onboarding bypass and staging/release gates need resolution. The repository's `PLAN.md` roadmap ends at Phase 10 and defines no Phase 23 scope; no Phase 23 features are inferred from it.

Local fix commit: `d4005694078b24df0fcfff77360c89697f71622e`. DevSpace-only agent limits were removed in `1aa4e4e`. Neither commit was pushed.

## Server enforcement addendum — 2026-10-10

The direct protected-API failure in the earlier table is the **pre-enforcement baseline**. The local follow-up adds a server-side setup check to `SessionGuard` for session and API-token requests. Incomplete businesses now receive HTTP 403 `ONBOARDING_REQUIRED` on guarded workspace endpoints. Explicit setup and session-management routes stay available so an owner can finish onboarding, confirm a password, switch businesses, or sign out. While setup is pending, business settings writes are limited to currency, tax, and receipt fields; enabling online ordering is blocked. The check reads the business's persisted settings on each protected request; it does not trust a browser flag or a cached session claim.

The isolated API contract now checks 403 on dashboard overview, product listing, inventory balances, and a product write while receipt setup is pending. After all required steps are done, those reads return 200 while optional steps remain pending, and the blocked product was never created. It still verifies that required steps cannot be skipped and optional steps can. A separate contract regresses a previously completed business to pending in its disposable store and verifies both an existing bearer token and session are denied, while `/api/v1/me` reports `onboardingRequired=true`. A PostgreSQL guard test checks the persisted-state transition through `PgDbPort`.

| Follow-up case | Result | Environment and evidence |
| --- | --- | --- |
| Direct dashboard, catalog, and inventory reads while required setup is pending | Pass | Isolated in-memory API contract: HTTP 403 `ONBOARDING_REQUIRED`. |
| Direct product write while required setup is pending | Pass | Isolated in-memory API contract: HTTP 403; subsequent completed-state product list is empty. |
| Unrelated business settings write while setup is pending | Pass | Isolated in-memory API contract: online ordering update returns HTTP 403; tax setting update returns HTTP 200. |
| Existing bearer token and session after setup regresses to pending | Pass | Isolated in-memory API contract: both sales reads return HTTP 403; profile still returns HTTP 200 with `onboardingRequired=true`. |
| Required steps complete, optional steps pending | Pass | Isolated in-memory API contract: dashboard, catalog, and inventory reads return HTTP 200. |
| Persisted PostgreSQL onboarding state | Pass | New `pg-onboarding-guard.test.ts`: pending tax/receipt denies a protected API-token route; completing both allows it. |
| Staging and production server behavior | Not run | No remote deployment or production state change was authorized for this follow-up. |

Existing operational API contracts now request an explicit completed-onboarding test fixture. The fixture marks only the three required steps done in each isolated registration; optional steps remain pending. Production registration and the dedicated incomplete-owner tests continue to create an incomplete business. One Phase 22 security fixture was corrected to merge settings instead of erasing its onboarding state.

Local verification after the server change: focused API contracts 18/18, API suite 668/668, full `pnpm test` 7/7 packages, PostgreSQL parity 158/158 against a fresh disposable PostgreSQL 16 container (removed after the run), full browser E2E 237/237 across desktop/tablet/mobile, and final-code focused onboarding E2E 12/12 desktop. `pnpm typecheck`, `pnpm lint`, `pnpm test:exit` 68/68, `pnpm verify`, `pnpm build`, phase 0–12 checks, Phase 10 and Phase 11 migration verifiers, and the dependency audit also passed. The Phase 11 verifier had a stale migration boundary and table count; the script was corrected and passed on a fresh container. A parallel `pnpm test` attempt hit a 10-second setup timeout in the loyalty contract while E2E ran; the uncontended rerun passed all packages. No GitHub Actions, staging, or production validation is claimed for the follow-up.

Follow-up code commit: `a08cb7fe9e9b07ca702506ba7284ef761f23f82c`. Historical verifier correction: `cccf9a24e49e24daba3f18061d458b5f47f904c4`. GitHub main remained `2c3ace096bfa5636e166163d8c6c4110b3b77888` on the final read-only check. Neither follow-up commit was pushed.

Remaining limits: the full browser run used the local in-memory API, while PostgreSQL parity was a separate disposable database run; PostgreSQL-backed browser E2E and staging are not claimed. The current onboarding API records required-step completion but does not validate underlying tax or receipt configuration fields, as the wizard itself explains. Phase 22 therefore remains open pending release validation and a product decision on those field-level requirements. The repository still has no verified Phase 23 scope.
