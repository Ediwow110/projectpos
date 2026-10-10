# Onboarding and dashboard route audit — 2026-10-10

## Scope and state

- QA checkout: `G:\Vscode\POS-onboarding-staging-20261010`, branch `codex/onboarding-staging-20261010`.
- Primary user checkout remains `G:\Vscode\POS`, branch `codex/local-main-pr20-20261009`; it was not edited.
- The integration branch includes GitHub main `2c3ace096bfa5636e166163d8c6c4110b3b77888`, the existing multirole staging feature, and local onboarding, inventory, and migration-verifier fixes.
- Code integration commit: `99b7c750d4de8cab873a66de46522702b4f218e0`.
- Staging deploy commit: `d859387c8bdf91d72b7f40584c7d693fed81edc2`.
- No production services, accounts, payments, or business data were used or changed.

## Product behavior and fixes

- Required onboarding remains mandatory. `SessionGuard` checks persisted setup state after authentication and role resolution; protected business API requests return HTTP 403 `ONBOARDING_REQUIRED` until required steps are complete. Setup and identity APIs remain available.
- The onboarding wizard explains that required setup must finish before dashboard access. It exposes the dashboard link only after required steps are complete; optional product and employee steps may remain pending or be skipped.
- A completed owner with no sales sees the getting-started empty state without the dead “Continue setup” link.
- Signed-out direct onboarding resolves to login. Invalid onboarding responses show a recoverable error instead of an indefinite spinner.
- `/` remains canonical dashboard route; `/dashboard` is not implemented.
- Inventory setup supports opening stock and damage adjustments with signed movement normalization; zero-stock products remain visible.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Full unit suite | Pass | 138 files, 675 tests; current branch after reconciliation. |
| Typecheck | Pass | All seven workspace packages. |
| Lint | Pass | Current integration tree. |
| Production build | Pass | Next.js generated all 51 static pages and route manifest. |
| Exit contract suite | Pass | 16 files, 68 tests. |
| Phase 0–12 verifiers and Phase 10/11 migration verifiers | Pass | Current integration tree; Phase 11 verifier uses corrected migration boundary and table count. |
| Critical production dependency audit | Pass | No known critical vulnerabilities. |
| Focused onboarding/workspace Playwright | Pass | 36 tests across desktop, tablet, and mobile; isolated local API and unique test owners. |
| PostgreSQL suite | Pass | 17 files, 158 tests; disposable local PostgreSQL 16 container `nexpos-onboarding-pg-20261010`. Container stopped after the run. |
| Render staging | Pass | My Workspace API deploy `dep-db538vad0e5s73e1vh40` and web deploy `dep-db538vg473hc739nfc10` both live at `d859387c8bdf91d72b7f40584c7d693fed81edc2`. API `/readyz` returned HTTP 200 `{"ok":true}`; API logs show 37/37 migrations up to date and Nest started. Fresh browser reached `/login` from signed-out `/onboarding`; login form rendered and no setup spinner remained. The only observed API 401 was expected for signed-out `/api/v1/onboarding`. |

## Remaining release evidence

Staging smoke covered readiness and signed-out routing. Authenticated staging scenarios were not run because no isolated staging owner fixture was available; the full authenticated flow and browser history matrix passed on local disposable API state. Production remains out of scope.

## Phase 22 closeout

The onboarding/dashboard route and API bypass follow-up is verified locally and on staging. Mandatory setup enforcement remains in place, and the audited navigation loops are fixed. This closes the Phase 22 onboarding follow-up; the separate approved omnichannel scope remains recorded in `2026-10-06-phase22-omnichannel.md`.

Phase 23 scope is not defined in the repository roadmap. Do not infer product features; request product priorities before drafting that phase.
