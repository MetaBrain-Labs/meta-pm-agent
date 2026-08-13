# AGENTS.md

## Mission

Act as a pragmatic software-engineering agent for the `meta-pm-agent` monorepo. Understand the existing flow before editing, follow established patterns, keep changes scoped, and finish implementation plus proportionate verification when the environment permits.

## Operating Rules

- Do not invent missing requirements or architecture. Ask when ambiguity would materially change the result; in unattended work, choose the safest reasonable interpretation and record the assumption.
- Prefer the simplest correct solution. Reuse existing code and platform features; avoid speculative abstractions and dependency churn.
- Do not modify unrelated code. Surface adjacent issues without fixing them unless requested.
- Do not commit any code or other repository changes without the user's explicit prior approval.
- State uncertainty. Use a small, safe experiment when it can resolve uncertainty cheaply, and report the hypothesis and result.
- If a clearly better approach avoids serious risk or rework, explain its trade-offs before implementation. Otherwise proceed with the requested reasonable approach.

## Repository Invariants

- Use pnpm `11.3.0`; workspaces are `apps/*` and `packages/*`.
- Turbo owns the build graph. `pnpm build` runs dependency builds first through `dependsOn: ["^build"]`.
- `@repo/shared` and `@repo/database` publish from `dist/`; generate Prisma Client and build shared packages before app development. Never commit generated `dist/` or `tsconfig.tsbuildinfo`.
- Root and Node packages use TypeScript `6.0.3`; keep `ignoreDeprecations: "6.0"`. `apps/web` stays on TypeScript `5.8.3` with its own `baseUrl`, paths, and `noEmit`.
- Preserve TypeScript project references and `composite: true` in `packages/shared`, `packages/database`, and `apps/agent-runtime`. Keep `"types": ["node"]` in `packages/database/tsconfig.json`.
- `apps/web` uses React 19, Vite 6, Tailwind 4, and Ant Design 6. Preserve Ant Design 6 APIs and imports.
- Run Prisma commands from `packages/database`: `pnpm db:generate`, `pnpm db:push`, or `pnpm db:migrate`. `allowBuilds` in `pnpm-workspace.yaml` permits Prisma installation scripts.
- Copy `.env.example` to `.env`. PostgreSQL may be configured with `POSTGRES_*` or `DATABASE_URL`; configure Redis, `OPENAI_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`. `TAVILY_API_KEY` enables Tavily; search otherwise falls back to public indexes.
- Preserve routes `/workplace`, `/chat/:workspaceId`, `/chat/:workspaceId/:threadId`, and `/documents/:workspaceId`.
- Browser folder selection may not expose an absolute path. Keep editable path fields and host-provided `file.path` handling.
- Do not change dependency versions, generated files, unrelated modules, or repository-wide configuration unless required.
- Web ESLint may fail when Next's compiled parser is unavailable. Root Turbo `lint` and `typecheck` currently have no substantive shared tasks; report these limits rather than treating them as successful coverage.

## Application Boundaries

```text
apps/
  agent-runtime/  LangGraph/DeepAgents runtime and tests
  api/            Hono API, SSE, persistence, background document runs
  web/            Vite/React/Ant Design frontend
  worker/         BullMQ/Redis worker scaffold
packages/
  shared/         Zod schemas, DTOs, events, and runtime contracts
  database/       Prisma client and schema
references/       Executor profiles, prompts, and skills
resources/        Generated product-context snapshots; do not commit runtime JSON
```

Keep contracts in `packages/shared`, database access in `packages/database` or API repositories, orchestration in `apps/agent-runtime`, HTTP/persistence coordination in `apps/api`, and browser behavior in `apps/web`.

## LLM-Facing Language

All model-facing instruction prose must be English: system/Agent prompts, routing/planning/execution instructions, tool names and descriptions, `parameters.description`, and schema metadata consumed by a model.

User-facing UI copy and final prose may be localized. Internal comments may be Chinese unless injected into a prompt. Localized output literals may remain localized, but surrounding instructions, tool/schema descriptions, and validation guidance must be English. Treat violations as prompt-validation errors.

## Web Structure

- Keep `apps/web/src/App.tsx` as the provider and page-composition shell. Top-level state/navigation belongs in `hooks/useAppShell.ts`; do not add page JSX, API clients, or SSE readers to `App.tsx`.
- Put browser API calls in `src/api/`, shared constants in `src/constants/`, DTO restoration in `src/mappers/`, route pages in `src/pages/`, history/path helpers in `src/router/`, reusable hooks in `src/hooks/`, and stream/markdown/form helpers in `src/utils/`.
- Put shared components in `src/components/` and reusable modal shells in `src/components/modals/`. Keep page-specific orchestration in its page folder.
- Keep assistant Markdown in `src/utils/markdown.tsx` using `react-markdown` + `remark-gfm`; preserve tables, links, lists, code, emphasis, and citations without `dangerouslySetInnerHTML`.
- `KnowledgeGraphView.tsx` is the shared G6 rendering and lifecycle source for the chat modal and document page. Consumers own filters, details, and actions.

## Chat and Agent Contracts

### Runtime topology

- Pre-Orchestrator runs outside the product LangGraph through Orchestrator's `pre-orchestrator` SubAgent. It handles intent classification, clarification/conflict forms, and interrupted-workflow detection before Conversation Agent routing.
- Conversation Agent handles user-facing chat and structured `<user-input>` production. Once `user-input-complete` is emitted, product planning must enter `apps/agent-runtime/src/graph/workflow.ts`; do not orchestrate later Agents from Conversation Agent.
- The product graph is:

  ```text
  parse_user_input
    -> request_agent
    -> orchestrator_agent
    -> planner_agent (plan/replay compatibility node)
    -> executor_router
    -> executor-* (parallel when dependencies allow)
    -> executor_aggregator
    -> executor_router
    -> orchestrator_agent (Critique)
    -> END
  ```

- Orchestrator owns routing, context-source selection, lifecycle state, Planner SubAgent delegation, and final Critique dispatch. Planner SubAgent creates the DAG inside Orchestrator; the `planner_agent` graph node displays/replays that plan and restored Executor results. Critique is invoked by `orchestrator_agent` after all DAG tasks finish, not registered as a separate graph node.
- Add product-workflow stages as graph nodes/edges, not ad hoc calls. Keep `apps/agent-runtime/src/agents/product-workflow/agent.ts` limited to formatting and exports.
- Shared DeepAgent execution lives in `apps/agent-runtime/src/agents/common/run-agent.ts`. Agent modules supply prompts, schemas/resolvers, tools, SubAgents, model options, and deterministic fallbacks instead of creating new runners.
- Stable product Agent types are `orchestrator`, `planner`, `critique`, and the ten Executor types. Preserve each `agentType` through runtime events, API persistence, and frontend rendering.

### Planning, execution, and recovery

- `TaskExecutionPlan.status` is `"initial"` for a first DAG and `"supplement"` for form-answer corrections/additions.
- The ten Executor domains are product strategy, market research, GTM, product discovery, product execution, marketing growth, data analytics, AI shipping, toolkit, and interface craft. Definitions live in `executor-agent/definitions.ts`; domain skills live at `references/executor/<domain>/skills/<skill>/SKILL.md` and are passed through DeepAgents `skills`.
- Executors receive a working graph copy, write through controlled `kg_file_*` tools, and return structured results. Merge each result once through LangGraph state; do not duplicate tool side effects.
- Preserve completed Executor results on retry/resume. Removing a task for rerun must also invalidate its downstream dependents, while unaffected results stay completed and visible.
- Manual stop/continuation is checkpoint-based. Use the stable `workflow:{conversationId}:{requestFormId}` thread and `PostgresSaver` when configured; only fall back to `MemorySaver` when durable storage is unavailable.
- Confirmation/proposal answers resume the previous Request analysis, Orchestrator decision, DAG, Executor results, Critique issues, and graph through `conversation/workflow-resume.ts`. They are not new product requests; Planner SubAgent should create only the required supplement DAG.
- Deduplicate user-facing proposal questions while preserving every source task, source Agent, and OpenQuestion ID. One accepted answer may close every referenced proposal source.
- Compact user-visible errors to the blocker, affected Agent/task, and next action. Never stream provider stacks, large JSON, or repeated retry internals.

### Knowledge graph and tools

- Runtime state is a structured `ProductKnowledgeGraph`. Executors may create only definition-authorized entity/relation types and must preserve task/source provenance.
- Controlled tools are implemented in `common/knowledge-graph-file-tool.ts`; despite the historical name, they mutate only the current in-memory graph and never grant arbitrary filesystem access.
- Tool authorization is centralized in `common/tool-access.ts`. Conversation may receive user-enabled `web_search`. Executors receive their controlled graph tools by runtime policy; market research, GTM, marketing growth, data analytics, AI shipping, toolkit, and interface craft also receive runtime-managed `web_search`.
- Planner SubAgent receives compact graph context, not unrestricted graph/file tools. DeepAgents default filesystem tools remain excluded by the Harness profile and allowlist middleware.
- Document Agent is the deliberate exception allowed to use built-in `write_todos` and `task`. Other internal DeepAgents helpers must not appear in normal SSE or persistence.
- External search failures return `{ results: [], error }` instead of throwing. Search-backed Evidence nodes must reference verified results; user-input and existing-graph provenance must remain traceable.
- Natural-language semantic judgments—including whether constraints conflict, whether Evidence supports a claim, and whether differently worded concepts are equivalent—belong to the responsible Agent with sufficient compact context. Do not encode them in backend keyword/regex dictionaries or enumerated domain-term lists. Keep deterministic backend validation to exact invariants such as schemas, authorization, provenance presence, relation direction, references, and graph integrity; when an Agent lacks evidence for a semantic judgment, enrich its context or prompt instead of adding semantic matching code.
- Preserve `agentType` on authorized `tool-call`/`tool-result` events. Filter internal helpers, unscoped reads, graph patches, and full graph payloads from user-visible SSE and message persistence.

### SSE and stop behavior

- Preserve `POST /api/chat` as `text/event-stream`. It emits `start`, then typed events such as `agent-status`, `text`, `thinking`, question/user-input/request-analysis/workflow-resume lifecycles, `human-interrupt`, SubAgent events, `tool-call`, `tool-result`, `token-usage`, `conversation-title`, `abort`, and `error`, and terminates with `data: [DONE]`.
- Runtime `reasoning` is mapped to API `thinking`. Keep `agentType`, `parallelAgents`, tool call IDs, and SubAgent identity when forwarding.
- `agent-status` is authoritative for active Agents. Remove `conversation` after `user-input-complete` before later Agent statuses appear.
- Frontend stop must call `/api/chat/stop` before aborting the browser fetch so the server propagates `AbortSignal` to model requests.

## Document Workflows

- Document Agent and its LangGraph are independent of the chat/product graph. Keep implementation/prompts under `agents/document-agent/` and orchestration in `graph/document-workflow.ts`.
- Current PRD stages are:

  ```text
  parseKg -> normalizeGraph -> buildSectionDossiers -> draftSection
    -> crossCheck -> scoreDraft -> rejectScore|aggregateScore
    -> draftSection|humanReview -> exportPrd
  ```

- PRD is the only enabled document kind. Keep MRD/BRD controls disabled until distinct workflows exist.
- Three independent reviewers score each draft. A score spread over `8` rejects the attempt; a reliable draft also needs `85/100`. Try at most three drafts, retain every draft/score history, and after exhausted retries choose according to the existing smallest-spread/weighted logic.
- `humanReview` currently auto-approves; do not claim it waits for a person unless an actual `interrupt()` is added.
- Document runs continue in the API background across page navigation. Only the stop endpoint or server/runtime failure should interrupt them.
- The separate lightweight HITL graph in `human-in-the-loop.ts` owns Question Form `interrupt()`/resume; do not confuse it with the product or document graphs.

## Persistence

- Prisma/PostgreSQL is authoritative for users, workspaces, conversations, messages, request forms/items, tasks/executions, token usage, and the current workspace graph.
- Some runtime repositories use raw SQL tables not modeled in Prisma, including `token_usage`, document runs/artifacts, and optional `product_context_snapshot`. Verify required tables exist before using those features; do not assume `db:push` creates them.
- Persist the user message before Agent execution. Persist Conversation output with `message.type = "conversation"`, Request output with `message.type = "request"`, reasoning in `message.meta.reasoningContent`, structured user input in `message.user_input`, and Request analysis in message/request-form records.
- Do not store chat history in browser `localStorage`; use API restoration. Local storage is only for non-authoritative UI preferences.
- Keep one `product_knowledge_graph` row per workspace, with optional conversation/request-form provenance. Database graph truth is structured `nodes` and `relations`; normalize decisions, risks, and open questions into nodes. Runtime-only summary/lifecycle fields belong in resource snapshots and the optional context-snapshot table, not new graph columns.
- The API archives the cumulative graph after each Executor without incrementing `version`; normal completion or manual stop finalizes the round and increments at most once. Prefer the latest runtime snapshot over Critique prose/model summaries.
- Generated product-context JSON under `resources/product-contexts/` is runtime state and must not be committed or exposed as an Agent filesystem tool.
- Keep Executor patches, full graph Markdown, large tool results, and full product-workflow blocks out of message/request-form payloads. Persist lightweight display metadata there and heavy graph state in graph storage.
- Document runs persist task planning, reasoning, scoring attempts, errors, and status; artifacts persist full Markdown/structured content separately from chat history.
- Preserve request-form states `received`, `conversation_consumed`, `request_agent_running`, `request_analyzed`, `workflow_running`, `pending_user_confirmation`, `completed`, `stopped`, and `failed`. Form decisions must finish all referenced proposal items and store answer metadata.
- When a persisted contract changes, update shared schemas/types, API repositories/services/controllers, frontend types, restoration, and rendering together.

## Frontend Rendering

- Preserve stage order: Conversation reasoning/tools, visible text/form, User Input, Request reasoning/tools, Request Analysis, Orchestrator/Planner DAG, each Executor's reasoning/tools/result, Critique, then confirmation or completion. Show the graph-updated state after an Executor commits.
- Place reasoning and tool cards next to their owning Agent. Render Orchestrator/Planner/Executor/Critique progress through the Planner DAG surface; each Executor keeps its own collapsed `ToolCallsCard`.
- Restored supplement DAGs keep completed nodes completed. Show only new, failed, or invalidated work as active.
- The top-right indicator may show parallel Executors. Every label must scroll to a visible reasoning/loading target; disable stick-to-bottom before jumping.
- Refresh graph availability after every Executor result, not only after the full workflow.
- `UserInputCard`, `RequestAnalysisCard`, and tool details default collapsed.
- The graph modal must survive zero-size initialization and close/reopen. Use the shared `KnowledgeGraphView` for modal and document-page G6 behavior, including dense-graph label reduction.
- Load graph/document data only on `/documents/:workspaceId`; show loading state, update the right detail panel on node selection, and keep full PRD content in a modal/download rather than inline.
- Prefer Tailwind utilities. Do not add CSS/SCSS/Less/CSS-module files, global rules, or inline `<style>` blocks unless explicitly required.

## Source Documentation

Every `.ts` and `.tsx` file must start with a JSDoc file header describing responsibilities and boundaries. Generated functions, business types, classes, services, repositories, controllers, hooks, Agents, graph nodes, and workflow steps require Simplified Chinese JSDoc; important branches/state transitions require concise Chinese comments. Explain business intent, not syntax, and never place Chinese prose inside model-facing prompts.

```ts
/**
 * <模块名称 / 文件职责简述>
 *
 * <详细职责说明>
 *
 * Responsibilities:
 * - <职责>
 *
 * Notes:
 * - <边界说明>
 */
```

## Work and Handoff

1. Read relevant source/config/scripts and all callers of code being changed.
2. Check the working tree and preserve unrelated user changes.
3. Make the smallest coherent change; update shared contracts before consumers.
4. Run the narrowest useful check, then broaden by risk. Build shared packages before apps.
5. Review the diff for accidental edits, secrets, generated output, dependency churn, prompt-language violations, and contract regressions.

Report changed behavior and why, verification commands/results, checks that could not run with their blocker, remaining assumptions/risks/setup, and direct links to changed files.
