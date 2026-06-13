# AGENTS.md

## Package manager
- Use `pnpm` (v11.3.0, enforced via `packageManager` field).
- Workspaces: `apps/*` and `packages/*`.

## Build system
- Turbo orchestrates tasks. `pnpm build` runs `turbo run build` with `dependsOn: ["^build"]`, so packages build before apps.
- **Shared packages must be built first** before running app dev scripts (`tsx`), because their `package.json` `main` points to `dist/` output, not raw TS source. Run `pnpm build` at least once before `pnpm dev`.
- `dist` is in `.gitignore` — build artifacts are never committed.

## TypeScript
- **TS 6.0.3** in root and Node.js apps/packages. `ignoreDeprecations: "6.0"` in base config required due to `baseUrl` deprecation.
- **`apps/web` uses TS 5.8.3** (Vite + React), with its own `baseUrl`/`paths` override and `noEmit: true`. Do not upgrade its TS version.
- **Project references**: `packages/shared`, `packages/database`, and `apps/agent-runtime` are `composite: true`. Apps reference them via `references` in tsconfig. When adding a new shared package or making an existing one importable, follow this pattern.
- **`packages/database`** needs `"types": ["node"]` in tsconfig for `process.env` access — pnpm strict isolation means `@types/node` isn't auto-visible.
- `apps/agent-runtime/src/graph.ts` has LangGraph API type errors (`@langchain/langgraph` version mismatch on typed state graphs). `tsc` will fail on this package until fixed; `tsx` (dev mode) ignores it.

## Project structure
```
apps/
  agent-runtime/   LangGraph-based PM agent (Node, composite ts)
  api/             Hono HTTP API server (port 3001, SSE streaming)
  web/             Vite + React + Ant Design 5 frontend (TS 5.8.3, light theme)
  worker/          BullMQ Redis worker
packages/
  shared/          Shared types, Zod schemas, DTOs, agent state/graph/runtime types
  database/        Prisma client singleton, exports from dist/
```

## Environment
- PostgreSQL (Prisma): `DATABASE_URL` in `.env`
- Redis (BullMQ worker): `REDIS_HOST`, `REDIS_PORT`, etc. in `.env`
- LLM (agent-runtime): `OPENAI_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` in `.env`
- Copy `.env.example` to `.env` and fill in values.

## Prisma
- Run from `packages/database`: `pnpm db:generate`, `pnpm db:push`, `pnpm db:migrate`.
- `prisma generate` must run before building `@repo/database` (handled by `allowBuilds` in `pnpm-workspace.yaml`).

## API
- The API uses **SSE streaming** for `/api/chat`. Responses are streamed as `text/event-stream` with typed events (`start`, `text`, `thinking`, `question-form-start`, `question-form-complete`, `compress-start`, `compress-complete`, `todo-update`, `tool-call`, `tool-result`, `finish`, `error`, etc.).
- Threads and messages: API currently streams directly without server-side thread persistence. Threads are managed on the frontend via localStorage + sidebar.

## Linting
- Only `apps/web` has eslint configured (`eslint-config-next`). No root-level lint or typecheck scripts are active (turbo tasks exist but are empty).
