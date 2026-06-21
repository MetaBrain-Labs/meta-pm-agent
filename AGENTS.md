# AGENTS.md

## Role

Act as a pragmatic software engineering agent for the `meta-pm-agent` monorepo. Understand the existing architecture before making changes, follow established patterns, and keep edits focused on the requested outcome.

## Goal

Deliver correct, maintainable changes that integrate with the current pnpm workspace, Turbo build graph, TypeScript configuration, database persistence model, SSE contract, and application boundaries. Complete implementation and appropriate verification whenever the local environment permits.

## Important Rules

- Use `pnpm` v11.3.0, as enforced by the root `packageManager` field.
- The workspaces are `apps/*` and `packages/*`.
- Turbo orchestrates builds. `pnpm build` runs `turbo run build` with `dependsOn: ["^build"]`, so packages build before apps.
- Build shared packages before running app development scripts because package entry points reference `dist/`, not raw TypeScript. Run `pnpm build` at least once before `pnpm dev`.
- Never commit `dist/`; generated build output is ignored by Git.
- Root and Node.js apps/packages use TypeScript 6.0.3. Keep `ignoreDeprecations: "6.0"` in the base config because of the `baseUrl` deprecation.
- `apps/web` uses TypeScript 5.8.3 with its own `baseUrl`, `paths`, and `noEmit: true`. Do not upgrade its TypeScript version.
- `apps/web` currently uses React, Vite, and Ant Design 6. Preserve the Ant Design 6 imports and component APIs when working on the frontend.
- `packages/shared`, `packages/database`, and `apps/agent-runtime` use TypeScript project references and `composite: true`. Follow this pattern when adding an importable shared package.
- Keep `"types": ["node"]` in `packages/database/tsconfig.json`; pnpm strict isolation does not expose `@types/node` automatically.
- `apps/agent-runtime/src/graph/workflow.ts` owns the LangGraph main graph. Account for historical LangGraph typed-state API/version issues when interpreting package-level TypeScript failures.
- `apps/web` has ESLint configured through `eslint-config-next`; local lint may fail if Next's compiled parser package is unavailable. Root Turbo lint and typecheck tasks currently have no active scripts.

## Boundaries

Preserve package and application boundaries:

```text
apps/
  agent-runtime/   LangGraph/DeepAgents PM runtime (Node.js, composite TypeScript)
  api/             Hono HTTP API server (port 3001, SSE streaming, Prisma persistence)
  web/             Vite + React + Ant Design 6 frontend (TypeScript 5.8.3, light theme)
  worker/          BullMQ Redis worker
packages/
  shared/          Shared types, Zod schemas, DTOs, and agent state/graph/runtime types
  database/        Prisma client singleton exported from dist/
```

- Use `.env` for local configuration. Copy `.env.example` and provide `DATABASE_URL`, Redis settings, `OPENAI_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`. Configure `TAVILY_API_KEY` when the `web_search` tool should use Tavily; otherwise the runtime falls back to free public indexes without extra search dependencies.
- Run Prisma commands from `packages/database`: `pnpm db:generate`, `pnpm db:push`, or `pnpm db:migrate`.
- Ensure `prisma generate` runs before building `@repo/database`; `allowBuilds` in `pnpm-workspace.yaml` handles this installation requirement.
- Preserve the workspace/chat routes and their current split: `/workplace`, `/chat/:workspaceId`, and `/chat/:workspaceId/:threadId`.
- Browser directory selection cannot reliably expose a full absolute path in standard web contexts. Preserve editable path fields and host-provided `file.path` handling where available.
- Do not change dependency versions, generated files, unrelated modules, or repository-wide configuration unless the task requires it.

## Web Structure Rules

- Keep `apps/web/src/App.tsx` as the application shell. It should wire providers, top-level state, routes, and page selection, but avoid accumulating page JSX, API clients, SSE readers, or DTO mapping logic.
- Place browser-side API calls in `apps/web/src/api/`.
- Place shared UI constants and local preference keys in `apps/web/src/constants/`.
- Place DTO-to-view-model restoration logic in `apps/web/src/mappers/`.
- Place route-level page implementations in `apps/web/src/pages/<page-name>/`, for example `pages/workplace/` and `pages/chat/`.
- Place path parsing and history helpers in `apps/web/src/router/`.
- Keep stream reducers, markdown helpers, and structured block parsers in `apps/web/src/utils/`.
- Keep shared React view components in `apps/web/src/components/`, reusable modal views in `apps/web/src/components/modals/`, and reusable hooks in `apps/web/src/hooks/`.
- Prefer moving logic into these focused modules before adding more code to `App.tsx`.
- Keep assistant markdown rendering in `apps/web/src/utils/markdown.tsx`; preserve support for standard pipe tables, links, lists, code blocks, and inline emphasis without using `dangerouslySetInnerHTML`.

## Chat And Agent Contracts

- Preserve the `/api/chat` SSE contract. It returns `text/event-stream` and typed events such as `start`, `text`, `thinking`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `request-analysis-start`, `request-analysis-complete`, `todo-update`, `tool-call`, `tool-result`, `step-finish`, `finish`, and `error`.
- Preserve `/api/chat/stop`. The frontend stop action must call this endpoint before aborting the browser fetch so the API can abort the server-side runtime and propagate `AbortSignal` to model provider requests.
- `thinking` events may include `agentType`. Preserve this field when forwarding or transforming stream events.
- Conversation Agent stream chunks use `agentType: "conversation"`.
- Request Agent stream chunks use `agentType: "request"`.
- After Conversation Agent emits `user-input-complete`, subsequent planning must flow through `apps/agent-runtime/src/graph/workflow.ts`. Do not directly wire Request Agent, ProductDirector, Planner, or Executor orchestration inside Conversation Agent.
- Product workflow routing is LangGraph-owned: `parse_user_input -> request_agent -> product_workflow`. Add future workflow stages as graph nodes/edges instead of ad hoc calls from individual agents.
- `POST /api/chat` may include `enabledTools`, currently `["web_search"]`. Validate tool names through shared schemas before passing them to the runtime.
- Runtime tool visibility is centrally managed in `apps/agent-runtime/src/agents/common/tool-access.ts`. Today `web_search` is only authorized for the Conversation Agent; future agent permissions should be added there instead of directly wiring tools inside individual agents.
- `web_search` is implemented in `apps/agent-runtime/src/agents/common/web-search-tool.ts`. Search backend/network failures must return structured tool results with `results: []` and an `error` field, not throw, so tool failures do not terminate the SSE stream.
- Preserve `agentType` on `tool-call` and `tool-result` events so the frontend can attribute future agent tool usage correctly.
- When adding future agents, assign a stable `agentType` and use it consistently across runtime events, API persistence, and frontend rendering.
- `apps/agent-runtime` filters internal DeepAgent/environment noise such as `No files found in /` before emitting user-visible `text`. Do not reintroduce internal tool/environment noise into normal assistant output.

## Persistence Rules

- The API persists account, workspace, conversation, message, and request-form data through Prisma/PostgreSQL.
- Persisted data should be loaded through the API: `/api/account`, `/api/workspaces`, `/api/chats`, and `/api/chats/:id/messages`.
- Do not persist chat message history in browser `localStorage`. Local browser storage is only acceptable for non-authoritative UI preferences such as the active workspace id.
- User messages are persisted before agent execution.
- Conversation Agent assistant output must be persisted with `message.type = "conversation"`.
- Request Agent assistant output must be persisted with `message.type = "request"`.
- Agent reasoning must be persisted in `message.meta.reasoningContent`.
- Conversation Agent structured user-input data is stored in `message.user_input`.
- Request Agent analysis must be written to the request message content and to request-form items.
- `request_form.status` must be updated as the request advances through processing states. Current statuses include `received`, `conversation_consumed`, `request_agent_running`, `request_analyzed`, `workflow_running`, `pending_user_confirmation`, `completed`, `stopped`, and `failed`.
- `request_form_item.status` must also move with user-visible decisions. When a user submits a proposal confirmation form, mark the matching `decision` item and all referenced `proposal` items as `finish`, and persist the answer metadata in each item's `payload`.
- Proposal aggregation must preserve source identity. Identical question text from different `source_task_id`/`source_agent` pairs represents distinct pending proposal confirmations and must not be collapsed or hidden by a hard result cap.
- When changing persisted chat/workspace contracts, update API schemas, repositories, services, routes/controllers, frontend types, and restoration/rendering logic together.

## Frontend Display Rules

- Reasoning should appear near the stage it belongs to.
- Conversation Agent reasoning appears with the conversation assistant message.
- Request Agent reasoning appears after "用户输入整理" and before "Request Agent 分析".
- Future agents should follow the same `agentType`-based placement pattern.
- Tool-call details, including `web_search` results, should render through `ToolCallsCard` as a collapsed card near the related assistant message.
- "用户输入整理" and "Request Agent 分析" cards should default to collapsed.
- Prefer Tailwind utilities for new styling. Do not create new CSS/SCSS/Less/CSS Module files unless explicitly requested or unavoidable.
- Do not add global stylesheet rules or inline `<style>` blocks unless the task explicitly requires it.

## Code Comment Rules

All generated backend code, frontend functions, classes, services, repositories, hooks, agents, workflows, and utilities must include comments.

- Use Simplified Chinese comments.
- Use JSDoc for classes, interfaces/types with business meaning, exported functions, public methods, React hooks, services, repositories, controllers, agent implementations, LangGraph nodes, and workflow steps.
- Use single-line comments for important business logic, branches, state transitions, graph transitions, and complex calculations.
- Comments should describe business intent rather than implementation mechanics.
- Avoid meaningless comments such as `// 定义变量`.

Example:

```ts
/**
 * 获取当前工作区的产品上下文。
 */
export async function getProductContext() {}

// 将需求分析结果交给 Planner Agent。
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
8. Review the final diff for accidental changes, generated artifacts, secrets, dependency churn, and contract regressions.

## Output

- Summarize what changed and why.
- List the verification commands run and their results.
- Report any tests or checks that could not run, including the concrete blocker.
- Call out remaining risks, assumptions, migrations, or required environment setup.
- Reference changed files directly and keep the final response concise.
