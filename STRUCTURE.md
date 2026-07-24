# meta-pm-agent Structure

## Overview

`meta-pm-agent` is a pnpm/Turborepo monorepo for an AI-assisted product-management workspace. It combines a LangGraph/DeepAgents runtime, a Hono API with SSE and PostgreSQL persistence, a Vite/React frontend, and a BullMQ worker scaffold.

| Layer | Main technology | Responsibility |
| --- | --- | --- |
| Agent runtime | LangGraph, LangChain, DeepAgents | Conversation, Request, Orchestrator, Planner SubAgent, ten Executors, Critique, Document Agent |
| API | Hono (port 3001) | HTTP/SSE, abort propagation, persistence, background document runs |
| Web | React 19, Vite 6 (port 3000), Ant Design 6, Tailwind 4, G6 | Workspace, chat, workflow, graph, and document UI |
| Database | PostgreSQL, Prisma, raw SQL repositories | Durable application, graph, token, and document data |
| Worker | BullMQ, Redis | Queue-worker scaffold |
| Build | pnpm 11.3.0, Turbo, TypeScript | Node packages use TS 6.0.3; web uses TS 5.8.3 |

All LLM-facing instructions, tool descriptions, and schema descriptions are English. User-facing UI may be localized.

## Repository Layout

```text
meta-pm-agent/
├─ apps/
│  ├─ agent-runtime/
│  │  ├─ src/
│  │  │  ├─ agents/
│  │  │  │  ├─ common/
│  │  │  │  │  ├─ run-agent.ts
│  │  │  │  │  ├─ tool-access.ts
│  │  │  │  │  ├─ knowledge-graph-file-tool.ts
│  │  │  │  │  ├─ web-search-tool.ts
│  │  │  │  │  └─ middleware and run-summary helpers
│  │  │  │  ├─ conversation/
│  │  │  │  ├─ request/
│  │  │  │  ├─ document-agent/
│  │  │  │  └─ product-workflow/
│  │  │  │     ├─ common/
│  │  │  │     ├─ orchestrator-agent/
│  │  │  │     │  ├─ pre-orchestrator-subagent/
│  │  │  │     │  └─ planner-subagent/
│  │  │  │     ├─ executor-agent/
│  │  │  │     └─ critique-agent/
│  │  │  ├─ graph/
│  │  │  │  ├─ workflow.ts
│  │  │  │  ├─ state.ts
│  │  │  │  ├─ workflow-checkpointer.ts
│  │  │  │  ├─ human-in-the-loop.ts
│  │  │  │  ├─ document-workflow.ts
│  │  │  │  ├─ document-workflow-state.ts
│  │  │  │  └─ nodes/
│  │  │  ├─ assets/
│  │  │  ├─ utils/
│  │  │  ├─ config.ts
│  │  │  ├─ index.ts
│  │  │  └─ types.ts
│  │  └─ test/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ controllers/
│  │  │  ├─ repositories/
│  │  │  ├─ schemas/
│  │  │  ├─ services/
│  │  │  ├─ utils/
│  │  │  ├─ app.ts
│  │  │  ├─ env.ts
│  │  │  └─ index.ts
│  │  └─ test/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ api/
│  │  │  ├─ components/
│  │  │  │  ├─ modals/
│  │  │  │  ├─ ChatApp.tsx
│  │  │  │  ├─ KnowledgeGraphView.tsx
│  │  │  │  └─ PlannerExecutionCard.tsx
│  │  │  ├─ constants/
│  │  │  ├─ hooks/
│  │  │  ├─ mappers/
│  │  │  ├─ pages/
│  │  │  │  ├─ chat/
│  │  │  │  ├─ documents/
│  │  │  │  └─ workplace/
│  │  │  ├─ router/
│  │  │  ├─ theme/
│  │  │  ├─ utils/
│  │  │  ├─ App.tsx
│  │  │  ├─ main.tsx
│  │  │  └─ types.ts
│  │  └─ package.json
│  └─ worker/
│     └─ src/index.ts
├─ packages/
│  ├─ shared/
│  │  └─ src/{agent,dto,events,schemas}/
│  └─ database/
│     ├─ prisma/schema.prisma
│     ├─ scripts/with-database-url.mjs
│     └─ src/
├─ references/
│  └─ executor/<executor-domain>/{executor.json,prompts,skills}/
├─ resources/
│  └─ product-contexts/
├─ AGENTS.md
├─ AGENTS-zh.md
├─ langgraph.json
├─ langgraph.md
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ turbo.json
```

Generated `dist/`, `.turbo`, `tsconfig.tsbuildinfo`, runtime product-context JSON, and Agent summary output are omitted and must not be committed.

## Package Dependencies

```text
apps/web
  └─ HTTP/SSE via Vite `/api` proxy -> apps/api

apps/api
  ├─ @repo/agent-runtime
  ├─ @repo/database
  └─ @repo/shared

apps/agent-runtime
  └─ @repo/shared

apps/worker
  └─ BullMQ/Redis runtime

packages/database
  └─ Prisma Client/PostgreSQL
```

`packages/shared` and `packages/database` publish from `dist/`. Turbo builds dependency packages before apps, but a stale `tsconfig.tsbuildinfo` can still hide missing output; generate Prisma Client and ensure shared build output exists before app development.

## Runtime Architecture

The application has two business graphs, one lightweight HITL graph, and an outer conversation/router layer.

### 1. Conversation and Pre-Orchestrator layer

`apps/agent-runtime/src/agents/conversation/stream.ts` is the chat streaming entry point.

```text
user message
  -> Orchestrator with Pre-Orchestrator SubAgent
     -> casual chat: Conversation Agent response
     -> clarification/conflict: Question Form + HITL interrupt
     -> interrupted workflow: checkpoint/history resume
     -> product request: Conversation Agent emits <user-input>
  -> product workflow LangGraph
```

Pre-Orchestrator handles intent classification (`casual_chat`, `new_project`, `project_evolution`), project-context conflict detection, clarification forms, and resume intent. Conversation Agent no longer owns these routing decisions. Product execution starts only after structured `user-input-complete`.

### 2. Product workflow graph

The main graph is defined in `apps/agent-runtime/src/graph/workflow.ts` and exposed to LangGraph tooling as `meta_pm_agent` in `langgraph.json`.

```text
START
  -> parse_user_input
  -> request_agent
  -> orchestrator_agent
  -> planner_agent
  -> executor_router
  -> one or more ready executor-* nodes
  -> executor_aggregator
  -> executor_router
  -> orchestrator_agent
  -> END
```

| Stage | Responsibility |
| --- | --- |
| `parse_user_input` | Parse Conversation Agent's tagged block into indexed input records; no model call |
| `request_agent` | Convert user input into structured Request analysis and business-model coverage |
| `orchestrator_agent` | Select route/context, manage lifecycle, delegate planning, and dispatch final Critique |
| Planner SubAgent | Generate the `initial` or `supplement` `TaskExecutionPlan` inside Orchestrator |
| `planner_agent` | Compatibility/display node that emits the plan and replays restored Executor results |
| `executor_router` | Select dependency-ready tasks and pack at most one task per Executor into a parallel batch |
| `executor-*` | Execute one domain task against a working graph copy using controlled tools |
| `executor_aggregator` | Barrier for a parallel batch; state reducers merge results and graph snapshots |
| Critique Agent | Run from `orchestrator_agent` after all tasks finish; validate commits, graph integrity, semantic quality, retries, and user questions |

Critique is not a standalone LangGraph node. When the router sees that all tasks are complete, it routes back to Orchestrator, which invokes Critique and produces `ProductWorkflowResult`.

The ten fixed Executor nodes are:

- `executor-product-strategy`
- `executor-market-research`
- `executor-gtm`
- `executor-product-discovery`
- `executor-product-execution`
- `executor-marketing-growth`
- `executor-data-analytics`
- `executor-ai-shipping`
- `executor-toolkit`
- `executor-interface-craft`

Executor profiles and allowed graph types are centralized in `executor-agent/definitions.ts`; skills are loaded from `references/executor/.../skills/`. All model execution uses `agents/common/run-agent.ts`.

### Product graph state and merging

`graph/state.ts` carries:

- structured user input and Request analysis;
- product-context source and Orchestrator decision;
- current plan and supplement targeting;
- completed Executor results;
- cumulative `ProductKnowledgeGraph`;
- prior Critique issues and final workflow result.

Parallel Executors start from the same batch snapshot. Each uses a private working graph, returns a delta/full result, and state reducers merge by stable IDs/task IDs. `executor_aggregator` emits the merged snapshot. This prevents concurrent branches from overwriting one another or duplicating tool side effects.

The graph lifecycle is `initial -> building -> refining -> stable`. Critique can keep the workflow in `refining` for Executor correction or user confirmation.

### Checkpoint and workflow resume

Product graph threads use:

```text
workflow:{conversationId}:{requestFormId}
```

`workflow-checkpointer.ts` prefers PostgreSQL `PostgresSaver` and falls back to `MemorySaver`. Resume can:

- continue the same checkpoint by streaming with a `null` input;
- reconstruct Request analysis, Orchestrator decision, plan, completed results, graph, and Critique issues from persisted chat artifacts;
- invalidate a requested task and every downstream dependent while retaining unaffected completed work;
- create a `supplement` DAG from Question Form answers.

Form answers are continuations, not fresh product requests.

### 3. Human-in-the-loop graph

`graph/human-in-the-loop.ts` is a separate minimal graph:

```text
START -> release_interrupt -> interrupt() -> Command({ resume }) -> END
```

It suspends and resumes Question Forms. It does not contain product-planning logic and is not the document workflow's `humanReview` stage.

### 4. Document workflow graph

Document generation is independent of the product graph:

```text
parseKg
  -> normalizeGraph
  -> buildSectionDossiers
  -> draftSection
  -> crossCheck
  -> scoreDraft
     -> rejectScore -> draftSection | humanReview
     -> aggregateScore -> draftSection | humanReview
  -> exportPrd
  -> END
```

Document Agent lives under `agents/document-agent/`; graph/state live in `graph/document-workflow*.ts`.

For each PRD draft, three independent reviewers score the same content. Spread must be at most `8`, weighted quality should reach `85/100`, and at most three drafts are attempted. All attempts remain in scoring history. `humanReview` currently auto-approves; it is a future extension point rather than a blocking human interrupt.

The API starts document generation as a background task, persists progress, and keeps it running across frontend navigation. PRD is enabled; MRD and BRD remain UI placeholders.

## Agents and Tools

### Shared runner

`agents/common/run-agent.ts` wraps DeepAgents model execution, JSON resolution, reasoning/token/tool/SubAgent events, deterministic fallbacks, abort signals, and optional run-summary recording. Agent-specific modules own their prompts and output interpretation.

DeepAgents default filesystem tools are excluded twice:

1. `harness-profile.ts` removes them from the provider profile.
2. `deep-agent-tool-policy.ts` applies a final allowlist before model/tool calls.

Document Agent deliberately allows `write_todos` and `task`; normal chat/product Agents do not.

### Runtime tool policy

`agents/common/tool-access.ts` is the single authorization table.

| Capability | Authorized Agents |
| --- | --- |
| User-enabled `web_search` | Conversation Agent |
| Runtime-managed `web_search` | Market Research, GTM, Marketing Growth, Data Analytics, AI Shipping, Toolkit, Interface Craft Executors |
| Controlled graph read/query/write/blocker tools | All ten Executors |
| Arbitrary filesystem tools | None |

The controlled graph tools in `knowledge-graph-file-tool.ts` modify an in-memory `ProductKnowledgeGraph`; their `kg_file_*` names are historical. They enforce allowed entity/relation types, source task IDs, required blocking questions, supplement-only deprecation, and Evidence provenance.

`web-search-tool.ts` uses Tavily when configured and public indexes otherwise. Failures return structured empty results with an error so the SSE stream survives.

## Product Context and Persistence

### Context loading

For a conversation, the API resolves the workspace and combines:

1. selected workspace overview files such as `README.md` and `product-context.md`, capped to a compact context;
2. `resources/product-contexts/<workspace>.json` when available;
3. the optional `product_context_snapshot` database row;
4. durable `product_knowledge_graph.nodes` and `.relations`.

Resource snapshots have priority for runtime-only lifecycle/summary fields; durable graph nodes and relations remain the long-term graph source. Snapshot files are backend-managed runtime data, not Agent filesystem access.

### Durable data

Prisma models cover the core account/workspace/conversation/message/request/task/graph data. API repositories also access raw SQL tables that are not represented in `schema.prisma`, including:

- `token_usage`;
- `document_generation_run`;
- `document_artifact`;
- optional `product_context_snapshot`;
- LangGraph checkpoint tables.

These tables must be provisioned separately; `prisma db push` does not create them from the current schema.

`product_knowledge_graph` keeps one current row per workspace. It stores normalized `nodes` and `relations`; runtime decisions, risks, and open questions are converted to node records. Every Executor completion archives a snapshot without advancing the version. Final completion or manual stop advances the workflow round at most once.

Messages keep lightweight display/restoration data:

- user messages are persisted before execution;
- Conversation and Request output use distinct message types;
- reasoning is stored in message metadata;
- structured user input and Request analysis remain restorable;
- full graph patches, graph Markdown, and generated PRD bodies stay out of chat messages.

Document runs store status, stage, task planning, reasoning, scoring attempts, and errors. Document artifacts store the full generated Markdown and structured content.

## API and SSE

### HTTP routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/account` | Local/default account |
| `GET/POST` | `/api/workspaces` | List/create workspaces |
| `GET/POST` | `/api/chats` | List/create chats |
| `GET` | `/api/chats/:id/messages` | Restore persisted messages and workflow state |
| `POST` | `/api/chat` | Stream one chat/workflow turn |
| `POST` | `/api/chat/stop` | Abort the server-side runtime for a chat |
| `GET` | `/api/workspaces/:workspaceId/knowledge-graph` | Read the current workspace graph |
| `POST` | `/api/workspaces/:workspaceId/document-generation` | Start a background document run |
| `GET` | `/api/workspaces/:workspaceId/document-generation/latest` | Read latest run/artifact by kind |
| `GET` | `/api/document-generation/:runId` | Read one run/artifact |
| `POST` | `/api/document-generation/:runId/stop` | Stop a document run |

### Stream contract

`POST /api/chat` starts with:

```text
data: {"type":"start"}
```

Runtime `reasoning` becomes API `thinking`. Other forwarded events include Agent status, text, Question Form/user-input/Request-analysis/workflow-resume lifecycle events, human interrupt, SubAgent lifecycle, tool calls/results, token usage, title updates, abort, and errors. Authorized events preserve `agentType`; parallel Executor events may carry `parallelAgents`. The stream terminates with:

```text
data: [DONE]
```

The stop endpoint must run before the browser abort so the API can propagate its `AbortSignal` into provider calls.

## Web Frontend

`App.tsx` is the shell. `hooks/useAppShell.ts` owns top-level workspace/chat routing and modal state. Route-level behavior lives in:

| Path | Responsibility |
| --- | --- |
| `pages/workplace/WorkspacePage.tsx` | Workspace selection and creation entry |
| `pages/chat/ThreadChatPage.tsx` | Chat restoration and run ownership |
| `pages/chat/chat-run-store.ts` | Keep an active stream alive across conversation navigation |
| `pages/documents/DocumentPlanningPage.tsx` | Lazy graph/document loading, task status, scoring, PRD actions |
| `components/ChatApp.tsx` | Chat layout, active Agents, process panel, graph refresh |
| `components/PlannerExecutionCard.tsx` | Planner DAG, Executor progress, Critique status |
| `components/KnowledgeGraphView.tsx` | Shared G6 data conversion, rendering, lifecycle, export |
| `components/modals/KnowledgeGraphModal.tsx` | Filtering, details, fullscreen, PNG/Markdown actions |
| `utils/apply-stream-event.ts` | Stream reducer |
| `mappers/persisted-message.ts` | Restore API DTOs into frontend view models |
| `utils/markdown.tsx` | GFM Markdown and search citations |

Chat history comes from the API, not `localStorage`. Local storage is limited to UI preferences such as active workspace.

The document page fetches only on `/documents/:workspaceId`, shares `KnowledgeGraphView` with the chat modal, updates node details on selection, and keeps full PRD Markdown in a modal/download instead of inline.

## Development

```bash
pnpm install
cp .env.example .env
pnpm --filter @repo/database db:generate
pnpm --filter @repo/database db:push
pnpm build
pnpm dev
```

Useful focused commands:

| Command | Purpose |
| --- | --- |
| `pnpm --filter @repo/agent-runtime test` | Runtime unit tests |
| `pnpm --filter @repo/api test` | API tests |
| `pnpm --filter web build` | Web type-check and production build |
| `pnpm --filter @repo/agent-runtime build` | Runtime TypeScript build |
| `pnpm --filter @repo/api build` | API TypeScript build |
| `pnpm --filter @repo/database db:generate` | Generate Prisma Client only |

Run the narrowest relevant check first, then `pnpm build` when contract or cross-package risk warrants it.
