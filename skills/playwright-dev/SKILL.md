---
name: playwright-dev
description: Explains how to develop Playwright - add APIs, MCP tools, CLI commands, and vendor dependencies.
---

# Playwright Development Guide

See [Playwright's CLAUDE.md](https://github.com/microsoft/playwright/blob/main/CLAUDE.md) for monorepo structure, build/test/lint commands, and coding conventions.

## Detailed Guides

- [Library Architecture](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/library.md) — client/server/dispatcher structure, protocol layer, DEPS rules
- [Adding and Modifying APIs](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/api.md) — define API docs, implement client/server, add tests
- [MCP Tools and CLI Commands](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/tools.md) — add MCP tools, CLI commands, config options
- [Vendor Dependencies & Bundling](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/vendor.md) — utilsBundle, coreBundle, babelBundle; adding vendored npm packages; DEPS.list; `check_deps`
- [Updating WebKit Safari Version](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/webkit-safari-version.md) — update the Safari version string in the WebKit user-agent
- [WebView (iOS Safari) Backend](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/webview.md) — `webkit/webview/` against stock Mobile Safari; provisional-target pause/resume; what's upstream vs Playwright patches; local + CI test setup
- [Bisecting Across Published Versions](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/bisect-published-versions.md) — reproduce regressions side-by-side from npm and diff `node_modules/playwright/lib/` between versions
- [Dashboard](https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/dashboard.md) — the UI powering the `playwright cli show` command, and how to work on it
