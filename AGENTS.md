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
- `apps/agent-runtime/src/graph.ts` has historically had LangGraph typed-state API errors caused by an `@langchain/langgraph` version mismatch. Account for this when interpreting package-level TypeScript failures.
- `apps/web` has ESLint configured through `eslint-config-next`; local lint may fail if Next's compiled parser package is unavailable. Root Turbo lint and typecheck tasks currently have no active scripts.

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
- Preserve the `/api/chat` SSE contract. It returns `text/event-stream` and typed events such as `start`, `text`, `thinking`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `todo-update`, `tool-call`, `tool-result`, `step-finish`, `finish`, and `error`.
- Preserve the workspace/chat routes and their current split: `/workplace` for the workspace homepage, `/chat/:workspaceId` for workspace detail, and `/chat/:workspaceId/:threadId` for a specific conversation.
- The API persists account, workspace, conversation, message, and request-form data through Prisma/PostgreSQL. The frontend may keep localStorage caches for responsiveness, but persisted data should be loaded through the API (`/api/account`, `/api/workspaces`, `/api/chats`, `/api/chats/:id/messages`).
- When changing persisted chat/workspace contracts, update the API schemas, repositories, services, routes, and the frontend types together.
- Browser directory selection cannot reliably expose a full absolute path in standard web contexts. Preserve editable path fields and host-provided `file.path` handling where available.
- `apps/agent-runtime` filters internal DeepAgent/environment noise such as `No files found in /` before emitting user-visible `text`. Do not reintroduce internal tool/environment noise into normal assistant output.
- Do not change dependency versions, generated files, unrelated modules, or repository-wide configuration unless the task requires it.

## Styling Rules

### Tailwind First

- Use Tailwind CSS for all styling by default.
- Do not create `.css`, `.scss`, `.sass`, `.less`, or CSS Module files unless explicitly requested.
- Prefer Tailwind utility classes over custom CSS.
- Prefer Tailwind arbitrary values (`w-[320px]`, `max-h-[calc(100vh-72px)]`) instead of creating custom CSS classes.
- Prefer Tailwind state variants (`hover:`, `focus:`, `disabled:`, `group-hover:`) instead of writing CSS selectors.
- Prefer Tailwind responsive utilities (`sm:`, `md:`, `lg:`, `xl:`) instead of media queries.

### Exceptions

Custom CSS is allowed only when:

1. Tailwind cannot express the required styling.
2. Complex keyframe animations are required.
3. Third-party libraries require custom stylesheet overrides.
4. The user explicitly requests CSS/SCSS.

### Forbidden

Unless explicitly requested, do not:

- Create `*.css`
- Create `*.module.css`
- Create `*.scss`
- Create `*.sass`
- Create `*.less`
- Add inline `<style>` blocks
- Add global stylesheet rules

When styling React/Vue components, always attempt a Tailwind-only implementation first.

## Code Comment Rules

### Mandatory Comments

All generated backend code, frontend functions, classes, services, repositories, hooks, agents, workflows, and utilities MUST include comments.

### Class Comments

Every class must have a JSDoc comment.

Example:

```ts
/**
 * 专门处理其他流式输出
 */
export class StreamOutputHandler {}
```

### Method / Function Comments

Every public method, exported function, React Hook, and business function must have a JSDoc comment.

Example:

```ts
/**
 * 获取当前工作区的产品上下文
 */
export async function getProductContext() {}
```

```ts
/**
 * 初始化 Request Agent 工作流
 */
function createRequestWorkflow() {}
```

### Inline Comments

Important business logic, branches, state transitions, workflow nodes, and complex calculations should use single-line comments.

Example:

```ts
// 加载工作区上下文
const context = await loadWorkspaceContext();

// 校验需求分析结果完整性
validateAnalysis(result);
```

### Comment Language

- Use Simplified Chinese comments.
- Comments should describe business intent rather than implementation details.
- Avoid meaningless comments such as:

```ts
// 定义变量
const data = {};
```

### Required Coverage

Comments are required for:

- Classes
- Interfaces
- Types with business meaning
- Exported functions
- React Hooks
- Services
- Repositories
- Controllers
- Agent implementations
- LangGraph nodes
- Workflow steps

### Preferred Format

Use JSDoc for classes and functions:

```ts
/**
 * 注释内容
 */
```

Use single-line comments for logic blocks:

```ts
// 注释内容
```

### Workflow Documentation

Every Agent node, workflow node, and graph transition must include a comment explaining its responsibility.

Example:

```ts
/**
 * 分析用户需求并生成结构化需求表单
 */
const requestAgentNode = async () => {};
```

```ts
// 将需求分析结果交给 Planner Agent
graph.addEdge("request-agent", "planner-agent");
```

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
