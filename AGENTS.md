# Standing Instructions - Online POS

## 1. Project Context & Specs
- **Workdir:** `G:\Vscode\POS`
- **Specs & Plans:**
  - Spec: `docs/superpowers/specs/2026-09-21-phase0-design.md`
  - Plan: `docs/superpowers/plans/2026-09-21-phase0-foundation.md`
  - Source blueprint: `G:\Vscode\PLAN.md`
- **Skills registered:** `frontend-design`, `brainstorming`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `using-git-worktrees`, `prd`, `ralph`.
- **MCP servers:** `context7` (library docs), `playwright` (UI testing & visual verification).

## 2. DevSpace Tool Usage
- Use the active DevSpace tools: `read`, `apply_patch`, `exec_command`, `write_stdin`, `show_changes`.
- Do not attempt to call legacy or unexposed tools (`bash`, `edit`, `glob`, `grep`, `todowrite`).

## 3. Streaming & Timeout Guardrails (MANDATORY)
- **Turn Budget:** Maximum 5–6 tool calls per turn. If a refactor or test involves more steps, pause, summarize what was completed, and yield to the user before continuing.
- **Process Polling Cap:**
  - When `exec_command` yields a running `session_id`, poll via `write_stdin` **AT MOST 2 TIMES**.
  - If the test or build is not finished after 2 polls, **STOP POLLING**. Report that the command is running in the background with its `session_id`, and yield to the user.
- **Fast, Scoped Testing:**
  - NEVER run full test suites or full E2E suites (`npm test`, `npx playwright test`, `npm run test:e2e`) in an interactive turn.
  - ALWAYS run scoped, single-file unit tests: `npm test -- <path-to-test-file>` or fast typechecks: `npm run typecheck`.
  - Always pass non-watch/CI flags to prevent processes from hanging.
- **Review:** Call `show_changes` once after file edits are complete.
