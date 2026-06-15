# AGENTS.md

## Role

Act as a pragmatic software engineering agent for the `meta-pm-agent` monorepo. Understand the existing architecture before making changes, follow established patterns, and keep edits focused on the requested outcome.

## Goal

Deliver correct, maintainable changes that integrate with the current pnpm workspace, Turbo build graph, TypeScript configuration, and application boundaries. Complete implementation and appropriate verification whenever the local environment permits.

## Importants

- Use `pnpm` v11.3.0, as enforced by the root `packageManager` field.
- The workspaces are `apps/*` and `packages/*`.
- Turbo orchestrates builds. `pnpm build` runs `turbo run build` with `dependsOn: ["^build"]`, so packages build before apps.
- Build shared packages before running app development scripts because package entry points reference `dist/`, not raw TypeScript. Run `pnpm build` at least once before `pnpm dev`.
- Never commit `dist/`; generated build output is ignored by Git.
- Root and Node.js apps/packages use TypeScript 6.0.3. Keep `ignoreDeprecations: "6.0"` in the base config because of the `baseUrl` deprecation.
- `apps/web` uses TypeScript 5.8.3 with its own `baseUrl`, `paths`, and `noEmit: true`. Do not upgrade its TypeScript version.
- `packages/shared`, `packages/database`, and `apps/agent-runtime` use TypeScript project references and `composite: true`. Follow this pattern when adding an importable shared package.
- Keep `"types": ["node"]` in `packages/database/tsconfig.json`; pnpm strict isolation does not expose `@types/node` automatically.
- `apps/agent-runtime/src/graph.ts` currently has LangGraph typed-state API errors caused by an `@langchain/langgraph` version mismatch. Package-level `tsc` may fail there, while `tsx` development mode ignores those errors.
- Only `apps/web` has ESLint configured (`eslint-config-next`). Root Turbo lint and typecheck tasks currently have no active scripts.

## Constraint

- Preserve package and application boundaries:

```text
apps/
  agent-runtime/   LangGraph-based PM agent (Node.js, composite TypeScript)
  api/             Hono HTTP API server (port 3001, SSE streaming)
  web/             Vite + React + Ant Design 5 frontend (TypeScript 5.8.3, light theme)
  worker/          BullMQ Redis worker
packages/
  shared/          Shared types, Zod schemas, DTOs, and agent state/graph/runtime types
  database/        Prisma client singleton exported from dist/
```

- Use `.env` for local configuration. Copy `.env.example` and provide:
  - PostgreSQL/Prisma: `DATABASE_URL`
  - Redis/BullMQ: `REDIS_HOST`, `REDIS_PORT`, and related values
  - LLM runtime: `OPENAI_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- Run Prisma commands from `packages/database`: `pnpm db:generate`, `pnpm db:push`, or `pnpm db:migrate`.
- Ensure `prisma generate` runs before building `@repo/database`; `allowBuilds` in `pnpm-workspace.yaml` handles this installation requirement.
- Preserve the `/api/chat` SSE contract. It returns `text/event-stream` and typed events such as `start`, `text`, `thinking`, `question-form-start`, `question-form-complete`, `compress-start`, `compress-complete`, `todo-update`, `tool-call`, `tool-result`, `finish`, and `error`.
- Do not assume server-side thread persistence. The API currently streams directly, while the frontend manages threads and messages with `localStorage` and the sidebar.
- Do not change dependency versions, generated files, unrelated modules, or repository-wide configuration unless the task requires it.

## Workflow

1. Read the relevant source, configuration, and package scripts before editing.
2. Check the working tree and preserve unrelated user changes.
3. Identify the smallest coherent change that follows existing repository patterns.
4. Update shared types or schemas before consumers when a contract changes.
5. Build required shared packages before running apps or tests that import them.
6. Run the narrowest useful verification first, then broaden it according to the change's risk.
7. Account for the known `apps/agent-runtime/src/graph.ts` type errors when interpreting TypeScript failures.
8. Review the final diff for accidental changes, generated artifacts, secrets, and contract regressions.

## Output

- Summarize what changed and why.
- List the verification commands run and their results.
- Report any tests or checks that could not run, including the concrete blocker.
- Call out remaining risks, assumptions, migrations, or required environment setup.
- Reference changed files directly and keep the final response concise.
