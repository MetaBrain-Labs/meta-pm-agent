# Contributing

This is a single-user local preview. Read AGENTS.md and STRUCTURE.md before changing code.

1. Use Node.js >=22.13 and pnpm 11.3.0; install with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env`, configure your own PostgreSQL and model credentials.
3. Generate Prisma Client, initialize an empty development database with `pnpm --filter @repo/database db:init`, then run `pnpm build`.
4. Run `pnpm --filter @repo/agent-runtime test` and `pnpm --filter @repo/api test`. For cross-package changes also run `pnpm build`.
5. Database integration tests require an isolated database and `RUN_DB_INTEGRATION=1`; never run them against production data.

All model-facing instructions and schema descriptions must be English. Preserve SSE, agent, graph, persistence and frontend boundaries. Use Simplified Chinese JSDoc for business responsibilities as described in AGENTS.md.

Explain the problem, resulting behavior and verification in each pull request. Keep dependency changes scoped. Never include `.env`, generated output, runtime snapshots, real customer information or provider keys. Root lint is not a substitute for builds and tests.

Contributions are submitted under Apache-2.0 unless explicitly agreed otherwise. You must have permission to contribute the code and preserve third-party notices. Report vulnerabilities privately; see SECURITY.md.
