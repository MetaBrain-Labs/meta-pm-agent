# Meta PM Agent v0.1.0 — Initial Open-Source Preview

The first public, open-source preview of Meta PM Agent: an AI-assisted product-management workspace that turns a conversation into structured requirements, a dependency-aware execution DAG, a persistent product knowledge graph, and a PRD artifact.

This is a **single-user, same-machine, loopback-only local preview**, published as a pre-release. Read [Known limitations](KNOWN_LIMITATIONS.md) before running it, and [SECURITY.md](SECURITY.md) for the trust boundary.

## Highlights

- **Conversation to structured requirements.** A Pre-Orchestrator classifies casual chat, new products, project evolution, clarification, and interrupted-workflow continuation; a Request analysis step surfaces gaps and conflicts before planning starts.
- **A real planning graph.** Request analysis feeds an Orchestrator and a Planner SubAgent that builds a dependency-aware DAG, resolved by up to ten parallel Executor domains and closed by a Critique pass.
- **Ten PM Executor domains.** Product strategy, market research, GTM, product discovery, product execution, marketing growth, data analytics, AI shipping, toolkit, and interface craft, each with its own profile, prompts, and skills.
- **A persistent product knowledge graph.** Structured nodes, relations, decisions, risks, open questions, task/source provenance, lifecycle state, and supplement-round corrections — persisted per workspace rather than kept as chat memory.
- **Auditable PRD generation.** A separate document workflow drafts sections, runs cross-section consistency checks, scores each draft with three independent reviewers, retries within bounds, and exports Markdown.
- **Recoverable execution.** PostgreSQL checkpoints, form-based human-in-the-loop resume, completed-task replay, and server-side cancellation.

## What's new

### Product surface

- Define v0.1 as a loopback-only, single-user local-directory release. Cloud sync, attachments, account identity, pin/archive, duplicate sidebar graph access, MRD/BRD controls and human-approval claims are hidden rather than shown as inert UI.
- Add local workspace rename/path update/soft removal and conversation rename/soft deletion APIs and UI. Active runs block destructive management operations; removed records remain in PostgreSQL and local directories are never changed.
- Fix the existing Ant Design 6 Divider title placement build blocker and make a Prisma proxy mock compatible with Node's test API.

### Runtime, data, and models

- Canonicalize new and built-in model profiles to `deepseek-flash`, normalize legacy V4 IDs, and update the built-in high-peak estimate to ¥0.04/¥2/¥8 per million cache-hit input/cache-miss input/output tokens.
- Tracked runtime SQL for model profiles, token usage, PRD artifacts/runs and optional context snapshots. Empty local setup uses `db:init`; existing databases use additive `db:upgrade`. Circular document constraints are created after both tables exist.
- Legacy structured graph writes default the unused content column instead of failing on a newly initialized database.
- Root `pnpm dev` starts only Web and API. The Worker remains source-visible as an experimental scaffold and Redis is not part of the v0.1 normal setup.

### Security and supply chain

- Loopback-only API binding and explicit local browser-origin rejection, including chat preflight tests.
- Apache-2.0 project license and NOTICE, preserved upstream skill licenses, complete 84-file skill inventory and per-file adaptation notices.
- Remove tokenizer assets without established standalone redistribution terms; provider usage remains available through the existing null fallback. Current generated PNG icons were separately confirmed by the owner as project assets under Apache-2.0.

### Documentation, CI, and community

- Node.js >=22.13 / pnpm 11.3.0 setup guidance, first model-profile configuration, external data-flow and provider-cost documentation.
- CI with disposable PostgreSQL 16, dummy model credentials, builds, tests, repeated database upgrades and redacted secret auditing.
- Community/security templates, synthetic product walkthrough, known limitations and explicit publication gates.
- Rebrand the repository README as **Meta PM Agent** with product screenshots, and align every package version to `0.1.0`.

## Known limitations

- Single-user trusted local preview. No authentication, account profile, tenant isolation, team collaboration, or cloud deployment/sync; API host and browser origins are restricted to loopback.
- PRD is the only exposed document kind, and the internal `humanReview` compatibility stage is an automatic quality pass — it does not wait for a person.
- Model Usage Profiles support the enumerated DeepSeek IDs, not arbitrary OpenAI-compatible models. Built-in pricing is a dated estimate; provider billing is authoritative.
- Without durable PostgreSQL checkpoints, product workflows fall back to process-local memory and cannot recover across a restart.
- The Worker is an experimental scaffold with no v0.1 business producer; Redis is not required.
- Core tables use Prisma `db:push` for empty local setup and runtime tables use tracked additive SQL — this is not a complete versioned production migration system.
- Root Turbo `lint`/`typecheck` coverage is limited; builds and focused tests are the meaningful validation gates.

The full list is in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Upgrade and database notes

- **New installation:** use an empty development database and run `pnpm --filter @repo/database db:generate` followed by `pnpm --filter @repo/database db:init`.
- **Existing database:** back it up, then run `pnpm --filter @repo/database db:upgrade`. It adds local soft-delete columns and missing runtime tables, normalizes legacy DeepSeek model IDs, updates cached-token/PRD constraints, widens `message.type`, and defaults the legacy graph `content` column. It never removes local files or business data, and conflicting schemas fail instead of being overwritten.
- The supported schema is `public`. Tracked SQL lives at `packages/database/sql/20260914_runtime_tables.sql`; PostgresSaver initializes its own checkpoint tables independently.
- A real first-install test exposed `message.type varchar(20)` rejecting `conversation_confirmation` and Executor identifiers (PostgreSQL 22001). The Prisma schema now uses `text`, and the tracked upgrade SQL widens existing columns without truncating data.

## Acknowledgements

Third-party dependencies and adapted skill material retain their original licenses; see [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<details>
<summary><strong>Preparation verification (2026-09-14)</strong></summary>

<br>

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

</details>

<details>
<summary><strong>Follow-up validation (2026-09-15)</strong></summary>

<br>

A real first-install test exposed `message.type varchar(20)` rejecting the unchanged `conversation_confirmation` and Executor identifiers (PostgreSQL 22001). The core Prisma schema now uses text for this field; the tracked upgrade SQL widens existing columns without truncating data. No public DTO or Agent identifiers were changed.

The repository-backed PostgreSQL regression test reproduced 22001 before upgrading the isolated test database. After applying the tracked SQL with the existing pg client (Prisma CLI execution was blocked by sandbox spawn EPERM), both database tests passed: runtime table/artifact writes and complete confirmation/all-ten-Executor message-type round trips. Test fixtures were rolled back. Previously failed stream output is not automatically backfilled; repeat the manual chat scenario.

The v0.1 local-release closure build passed all six packages after the CRUD/UI/model changes, with the existing Vite large-chunk warnings. CRUD/database integration coverage and legacy-model normalization assertions were added; normal test commands and real clean-clone/CI acceptance remain publication gates rather than claimed passes.

</details>

<details>
<summary><strong>Publication status and remaining gates</strong></summary>

<br>

- Screenshots in this repository are real captures of a running local preview with synthetic requirements, redacted by the maintainer. See [assets/screenshots/README.md](assets/screenshots/README.md) for the capture scope and the open items (one capture still contains a private test directory path and legacy model IDs; a demo GIF has not been produced).
- No demo video/GIF is shipped yet, and the marketing hero is a brand illustration rather than a product screenshot or architecture diagram.
- Green remote CI, a clean-clone end-to-end model workflow, and database initialization on a disposable PostgreSQL service have not been accepted from the preparation environment.
- Private vulnerability reporting and remote ref freshness still need maintainer verification.

Complete [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before treating this preview as a stable release.

</details>

## Publishing this release

Package versions are `0.1.0` and this document is the release body. After your own review and explicit approval, run:

```bash
git switch main
git add -A
git commit -m "docs: rebrand README as Meta PM Agent, add product visuals, and align versions to 0.1.0"
git push origin main
git tag -a v0.1.0 -m "Meta PM Agent v0.1.0 — Initial Open-Source Preview"
git push origin v0.1.0
gh release create v0.1.0 \
  --title "Meta PM Agent v0.1.0 — Initial Open-Source Preview" \
  --prerelease \
  --notes-file RELEASE_NOTES.md \
  --verify-tag
```

Without the GitHub CLI: open **Releases → Draft a new release**, choose the existing tag `v0.1.0`, paste this file as the description, and select **Set as a pre-release**.

After the release exists, the README release badge resolves to `v0.1.0`. Before then it reports that no release is published, which is expected.

**Full changelog:** [`b3df643...v0.1.0`](https://github.com/MetaBrain-Labs/meta-pm-agent/commits/v0.1.0)
