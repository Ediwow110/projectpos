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
