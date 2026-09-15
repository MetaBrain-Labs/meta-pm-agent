# v0.1.0-preview.1 — draft prerelease notes

Status: preparation draft, **not published**. Package versions remain unchanged. Final revision, CI URL and actual end-to-end outcomes must be recorded before tagging.

## Changes

- Apache-2.0 project license and NOTICE, preserved upstream skill licenses, complete 84-file skill inventory and per-file adaptation notices.
- Tracked runtime SQL for model profiles, token usage, PRD artifacts/runs and optional context snapshots. Empty local setup uses db:init; existing databases use additive db:upgrade. Circular document constraints are created after both tables exist.
- Legacy structured graph writes default the unused content column instead of failing on a newly initialized database.
- Loopback-only API binding and explicit local browser-origin rejection, including chat preflight tests.
- Node.js >=22.13 / pnpm 11.3.0 setup guidance, first model-profile configuration, external data-flow and provider-cost documentation.
- CI with disposable PostgreSQL 16, dummy model credentials, builds, tests, repeated database upgrades and redacted secret auditing.
- Community/security templates, synthetic product walkthrough, known limitations and explicit publication gates.
- Remove tokenizer assets without established standalone redistribution terms; provider usage remains available through the existing null fallback. Current generated PNG icons were separately confirmed by the owner as project assets under Apache-2.0.
- Fix the existing Ant Design 6 Divider title placement build blocker and make a Prisma proxy mock compatible with Node's test API.

## Preparation verification (2026-09-14)

Environment: Windows, Node.js 24.15.0, pnpm 11.3.0. Starting revision: b3df643 on orch-test. Concurrent owner-authorized icon updates were preserved; generated icon output was not edited.

- `pnpm build`: one complete run passed all six packages, with Vite large-bundle warnings. After concurrent icon updates, final recheck passed TypeScript compilation but Vite could not start its esbuild service (`spawn EPERM`). The earlier build pass is not final browser acceptance.
- Final `pnpm --filter @repo/api build`, `pnpm --filter web exec tsc --noEmit`, release-document link checks and `git diff --check`: passed.
- Normal Runtime/API test commands: blocked by sandbox child-process `spawn EPERM`.
- Alternate local Node test loader (TypeScript transpilation with no test-process isolation, kept in ignored .release-verification): Runtime 233/233 passed. API 57 passed, 2 database tests skipped, 1 fatal-child-process test failed because its subprocess could not run. This does not establish a green normal API suite or CI.
- `python scripts/audit-release.py --fail-on-secrets`: passed after reviewing exact synthetic/documentation credential fingerprints. Latest scan covered 2,502 reachable blobs including local Codex snapshot refs, with no provider-key/private-key pattern hits. Private-path and runtime-path candidates remain review items, not proof of leaked customer data. Reports are redacted and kept in ignored .release-audit.
- Synthetic audit-key detection/redaction, placeholder handling and all 84 skill inventory hashes: passed.
- Fresh publishable-source export without .env/node_modules/dist/.git: frozen lockfile resolved and all 720 packages downloaded; normal lifecycle execution failed with spawn EPERM. A separate install with scripts disabled passed and is **not** a replacement for normal lifecycle-install validation. Prisma Client generation then passed in this isolated source export without a local .env or the original locked DLL.
- Fresh-source build reached clean shared/database/runtime and web TypeScript compilation, then failed at Vite esbuild process creation (`spawn EPERM`); there was no hidden dist/cache copied into that export.
- Disposable PostgreSQL service could not start: Docker daemon unavailable; local PostgreSQL 16 installation lacks postgres.bki and initdb encounters restricted-token errors. Database initialization and integration have not been accepted locally.
- Local browser access denied by permission review. Screenshots, graph/PRD visual acceptance and real-model end-to-end stop/recovery remain unverified.
- Remote ref freshness, GitHub Actions logs/artifacts and private vulnerability-reporting settings could not be verified without working authenticated GitHub access. No Git history was rewritten, no code committed, and no repository visibility changed.

## Remaining release gates

Complete RELEASE_CHECKLIST.md: provenance/history disposition, green real CI/database tests, clean-clone manual model workflow, actual synthetic screenshots and verified private security reporting. See KNOWN_LIMITATIONS.md for product boundaries.

## Follow-up validation (2026-09-15)

A real first-install test exposed `message.type varchar(20)` rejecting the unchanged `conversation_confirmation` and Executor identifiers (PostgreSQL 22001). The core Prisma schema now uses text for this field; the tracked upgrade SQL widens existing columns without truncating data. No public DTO or Agent identifiers were changed.

The repository-backed PostgreSQL regression test reproduced 22001 before upgrading the isolated test database. After applying the tracked SQL with the existing pg client (Prisma CLI execution was blocked by sandbox spawn EPERM), both database tests passed: runtime table/artifact writes and complete confirmation/all-ten-Executor message-type round trips. Test fixtures were rolled back. Previously failed stream output is not automatically backfilled; repeat the manual chat scenario.
