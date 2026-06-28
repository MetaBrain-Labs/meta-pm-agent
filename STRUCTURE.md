# meta-pm-agent Project Structure

## Overview

`meta-pm-agent` is a pnpm + Turborepo monorepo for an AI-assisted product-management workspace. It contains a LangGraph/DeepAgents runtime, a Hono API with SSE streaming, abortable model execution and PostgreSQL persistence, a Vite + React + Ant Design frontend, a BullMQ worker scaffold, and shared TypeScript/database packages.

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Agent runtime | LangGraph, LangChain, DeepAgents | Conversation Agent, Request Agent, JSON Planner Agent, and 10 markdown knowledge-graph Executor Agents |
| API | Hono | HTTP API on port 3001, SSE `/api/chat` stream, `/api/chat/stop`, Prisma repositories |
| Web | Vite, React, Ant Design 6 | Workspace and chat UI, TypeScript 5.8.3 |
| Web search | LangChain tool + Tavily/free public indexes | Optional `web_search` runtime tool, centrally authorized per Agent |
| Worker | BullMQ, Redis | Background queue worker scaffold |
| Database | PostgreSQL, Prisma | Account, workspace, conversation, message, request-form, task, product knowledge graph data |
| Build | Turborepo | Workspace task graph |
| Package manager | pnpm 11.3.0 | Enforced by root `packageManager` |

## Directory Layout

```text
meta-pm-agent/
├─ apps/
│  ├─ agent-runtime/
│  │  ├─ src/
│  │  │  ├─ agents/
│  │  │  │  ├─ common/
│  │  │  │  ├─ conversation/
│  │  │  │  ├─ product-workflow/
│  │  │  │  │  ├─ common/
│  │  │  │  │  ├─ executor-agent/
│  │  │  │  │  │  ├─ agent.ts
│  │  │  │  │  │  ├─ definitions.ts
│  │  │  │  │  │  └─ prompt.ts
│  │  │  │  │  ├─ planner-agent/
│  │  │  │  │  │  ├─ agent.ts
│  │  │  │  │  │  └─ prompt.ts
│  │  │  │  │  ├─ agent.ts
│  │  │  │  │  └─ types.ts
│  │  │  │  └─ request/
│  │  │  ├─ graph/
│  │  │  │  └─ nodes/
│  │  │  ├─ utils/
│  │  │  ├─ config.ts
│  │  │  ├─ index.ts
│  │  │  └─ types.ts
│  │  └─ package.json
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
│  │  └─ package.json
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ api/
│  │  │  │  └─ chat-api.ts
│  │  │  ├─ components/
│  │  │  │  ├─ chat/
│  │  │  │  ├─ ui/
│  │  │  │  ├─ ChatApp.tsx
│  │  │  │  ├─ MessageBubble.tsx
│  │  │  │  ├─ ProseBlock.tsx
│  │  │  │  ├─ QuestionForm.tsx
│  │  │  │  ├─ RequestAnalysisCard.tsx
│  │  │  │  ├─ Sidebar.tsx
│  │  │  │  ├─ TodoCard.tsx
│  │  │  │  ├─ ToolCallsCard.tsx
│  │  │  │  └─ UserInputCard.tsx
│  │  │  ├─ constants/
│  │  │  │  └─ app.ts
│  │  │  ├─ hooks/
│  │  │  ├─ mappers/
│  │  │  │  └─ persisted-message.ts
│  │  │  ├─ router/
│  │  │  │  └─ app-route.ts
│  │  │  ├─ utils/
│  │  │  │  ├─ apply-stream-event.ts
│  │  │  │  ├─ markdown.tsx
│  │  │  │  ├─ question-form.ts
│  │  │  │  └─ user-input.ts
│  │  │  ├─ App.tsx
│  │  │  ├─ main.tsx
│  │  │  ├─ styles.css
│  │  │  └─ types.ts
│  │  ├─ package.json
│  │  └─ vite.config.ts
│  └─ worker/
│     └─ src/index.ts
├─ packages/
│  ├─ database/
│  │  ├─ prisma/schema.prisma
│  │  └─ src/
│  └─ shared/
│     └─ src/
├─ references/
├─ AGENTS.md
├─ AGENTS-zh.md
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ turbo.json
```

Generated `dist/` directories are intentionally omitted and must not be committed.

Current product-workflow additions:

| Path | Purpose |
| --- | --- |
| `apps/agent-runtime/src/agents/common/knowledge-graph-file-tool.ts` | Controlled DeepAgents knowledge-graph tools bound to the current in-memory workflow graph |
| `apps/agent-runtime/src/agents/common/run-text-agent.ts` | Shared text/markdown DeepAgent runner used by Executor Agents |
| `apps/agent-runtime/src/agents/product-workflow/executor-agent/*-executor/` | Ten independent Executor Agent profile folders, one per executor domain |
| `references/executor/<executor-domain>/skills/<skill-name>/SKILL.md` | DeepAgents skill sources selected by Executor definitions and passed through the shared text runner |

## Web Frontend Structure

`apps/web/src/App.tsx` is the application composition layer. It owns top-level UI state and wires workspace, chat, modal, and route behavior together.

Supporting responsibilities are split into focused modules:

| Directory | Responsibility |
| --- | --- |
| `api/` | Browser-side API clients for account, workspace, chat, and persisted messages |
| `constants/` | UI constants and local preference keys |
| `mappers/` | Data restoration between API DTOs and frontend view models |
| `pages/` | Route-level page folders such as `pages/workplace` and `pages/chat` |
| `router/` | Lightweight path parsing and history updates for `/workplace` and chat routes |
| `utils/` | Stream-event reducers, markdown rendering, and structured-block parsers |
| `components/` | Shared presentational components; page-specific orchestration belongs in `pages/` |
| `components/modals/` | Reusable modal views such as project creation and configuration |
| `hooks/` | Reusable React hooks kept separate from route-level app orchestration |

The frontend does not persist chat history in browser `localStorage`. Chat messages are restored through `GET /api/chats/:id/messages`; browser storage is limited to non-authoritative UI preferences such as the active workspace id.

Assistant markdown is rendered by `apps/web/src/utils/markdown.tsx`. It intentionally uses a small typed renderer instead of `dangerouslySetInnerHTML`, and supports common chat output including headings, lists, fenced code, links, inline emphasis, and standard pipe tables.

## Dependency Graph

```text
apps/web
  └─ HTTP/SSE through Vite proxy `/api` -> apps/api

apps/api
  ├─ @repo/agent-runtime
  ├─ @repo/database
  └─ @repo/shared

apps/agent-runtime
  └─ @repo/shared

apps/worker
  ├─ Redis/BullMQ
  ├─ @repo/agent-runtime
  └─ @repo/shared

packages/database
  └─ Prisma Client / PostgreSQL
```

Workspace package entry points reference `dist/`, so run `pnpm build` at least once before starting apps that import workspace packages.

## Runtime Flow

### Conversation Agent

`apps/agent-runtime/src/agents/conversation/stream.ts` is the primary streaming entry point. It adapts frontend chat messages into LangChain messages, streams Conversation Agent reasoning with `agentType: "conversation"`, streams visible answer content as `text`, extracts question-form and user-input tagged blocks, and filters internal DeepAgent environment noise such as `No files found in /`.

### Request Agent

When a user submits a form answer, the Conversation Agent first emits a `user-input` block. The runtime then hands the block to `apps/agent-runtime/src/graph/workflow.ts`. LangGraph parses user input, runs the Request Agent, and conditionally enters the product workflow when the request analysis contains business-model items.

The Request Agent output is persisted as a separate assistant message with `message.type = "request"`. Its reasoning is stored in `message.meta.reasoningContent`.

### LangGraph Product Workflow

The LangGraph main graph is:

```text
parse_user_input -> request_agent -> planner_agent -> executor-* -> planner_agent -> END
```

The product workflow nodes are implemented in `apps/agent-runtime/src/graph/nodes/product-workflow-node.ts` and owned by `apps/agent-runtime/src/graph/workflow.ts`. The Planner Agent emits the Planner Agent DAG, LangGraph schedules ready tasks across the ten Executor Agent nodes, and the Planner Agent reviews the final product knowledge graph after executors finish. The SSE path uses `streamWorkflowGraph` so intermediate reasoning, Planner DAG cards, structured knowledge-graph updates, tool calls, and confirmation forms remain visible while the graph owns stage transitions.

The workflow stage delegates model work to independent DeepAgents:

| Directory | Responsibility |
| --- | --- |
| `apps/agent-runtime/src/agents/common/run-json-agent.ts` | Shared JSON DeepAgent runner for Planner; it validates schema output and forwards reasoning/tool events |
| `apps/agent-runtime/src/agents/common/run-text-agent.ts` | Shared text DeepAgent runner for Executor Agents; it streams reasoning/tool events, attaches selected DeepAgents skills, and does not force final JSON validation |
| `apps/agent-runtime/src/agents/conversation/workflow-resume.ts` | Restores prior Request Analysis, Planner DAG, Executor results, and workflow graph state when a product-workflow confirmation/proposal form answer resumes an existing round |
| `apps/agent-runtime/src/agents/product-workflow/planner-agent/` | Planner Agent implementation and prompt; converts Request Agent analysis plus product context into a persisted Planner Agent DAG, creates supplement DAGs from Planner form answers, and performs final workflow review after Executor completion |
| `apps/agent-runtime/src/agents/product-workflow/executor-agent/` | Executor Agent implementation, prompt, shared types, definitions, and ten domain profile folders; each Executor reads the current graph and writes structured updates through controlled tools |
| `apps/agent-runtime/src/agents/product-workflow/agent.ts` | Product workflow orchestration, stream event forwarding, tagged block formatting, and question-form formatting only |

Each product workflow Agent keeps its prompt beside its implementation in `prompt.ts`. Do not reintroduce a shared `product-workflow/prompts/` directory for agent-specific prompts.

Executor Agent domains are implemented as independent folders under `executor-agent/`: `product-strategy-executor`, `market-research-executor`, `gtm-executor`, `product-discovery-executor`, `product-execution-executor`, `marketing-growth-executor`, `data-analytics-executor`, `ai-shipping-executor`, `toolkit-executor`, and `interface-craft-executor`.

Executor Agent skills are stored under `references/executor/<executor-domain>/skills/`. Each executor definition declares the skill names it needs; the runtime resolves those names to skill directories and passes them to DeepAgents through the shared `skills` option. Conversation and Request Agents do not receive these executor skills.

Executor Agents maintain a shared `ProductKnowledgeGraph` state during a workflow run. Each Executor receives a working copy for tool execution; LangGraph merges the Executor result back into the cumulative graph once through `appendKnowledgeGraphPatch`, preventing tool side effects from duplicating graph entries. The API archives each cumulative graph snapshot after an Executor finishes so interrupted runs keep completed graph data.

After each Executor finishes, the API archives the latest cumulative structured graph snapshot into `product_knowledge_graph`, keyed by `workspace_id`, so completed Executor output remains available if the workflow is interrupted. These intermediate snapshots do not increment `version`; the normal workflow finish or manual interruption finalizes the round and increments `version` at most once. The final archive prefers the runtime cumulative graph snapshot over Planner Review model output, because the model review may summarize or omit fields. Executor and Planner message/request-form persistence must not duplicate full graph markdown or graph patches; heavyweight graph contents belong in `product_knowledge_graph`.

Product-workflow form answers are handled as workflow resumes. A `[form answers - product-workflow-confirmation]` or proposal-decision payload should not be sent through a fresh Conversation -> Request Agent analysis cycle. The runtime restores the earlier request analysis, plan, executor results, and product knowledge graph, then asks Planner to create a `TaskExecutionPlan` with `status: "supplement"` for only the required corrections or additions. Supplement Executor tasks update the graph, the final archive marks the round complete, and the UI renders a completion card telling the user the complete knowledge graph can be viewed.

When resuming or retrying after hard blockers, previously completed Executor results are replayed into the workflow output so DAG nodes remain completed while only unfinished or supplement tasks continue. User-visible errors should be compact: show the key blocker, affected Agent/task, and next action, not provider stack traces, large JSON payloads, or repeated retry internals.

The Planner workflow review may produce proposal slots from multiple executor tasks. Proposal slot aggregation may consolidate duplicate or near-duplicate visible questions, but it must preserve every `source_task_id` and `source_agent` in `sources`; a single answer can then close all referenced proposal items. Do not reintroduce hard caps that hide valid pending proposal sources.

### Runtime Tools

Runtime tools are validated through the shared `enabledTools` schema. User-facing requests may enable `web_search`; product-workflow file tools are internally attached by the runtime only for authorized product-workflow agents.

Tool visibility is managed centrally in `apps/agent-runtime/src/agents/common/tool-access.ts`:

| Tool family | Tool names | Authorized agents |
| --- | --- | --- |
| Web search | `web_search` | Conversation Agent only |
| Knowledge graph tools | `kg_file_read`, `kg_file_add_summary`, `kg_file_add_nodes`, `kg_file_add_relations`, `kg_file_add_decisions`, `kg_file_add_risks`, `kg_file_add_open_questions` | Planner Agent and the ten Executor Agents only |

`apps/agent-runtime/src/agents/common/web-search-tool.ts` implements the `web_search` LangChain tool. It uses `TAVILY_API_KEY` when configured and falls back to free public indexes such as Hacker News Algolia and OpenAlex without extra search dependencies. Search backend failures are returned as structured tool results with `results: []` and `error` instead of throwing, so a network timeout does not terminate the chat stream.

`apps/agent-runtime/src/agents/common/knowledge-graph-file-tool.ts` implements the controlled knowledge-graph tools. Despite the historical file-tool name, these tools mutate only the current workflow `ProductKnowledgeGraph` object and must not expose arbitrary filesystem access.

The shared DeepAgent runners only forward explicitly authorized user-visible tools into SSE. Internal DeepAgents tools such as generated task/todo helpers or unscoped file reads are kept out of `tool-call`/`tool-result`, so they do not appear as stuck UI cards or leak internal filesystem errors.

Executor skills are not user-facing tools. They are local DeepAgents skill directories resolved from `references/executor/.../skills/...` and attached through `run-text-agent.ts`; keep tool authorization and skill loading separate.

## API

The API exposes account, workspace, chat, message, and SSE routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/account` | Return the local/default account |
| `GET` | `/api/workspaces` | List persisted workspaces |
| `POST` | `/api/workspaces` | Create a workspace with `name` and optional `localPath` |
| `GET` | `/api/chats?workspaceId=...` | List chats for a workspace |
| `POST` | `/api/chats` | Create a chat and its request form |
| `GET` | `/api/chats/:id/messages` | Load persisted chat messages |
| `POST` | `/api/chat` | Stream an agent response with SSE and persist messages |
| `POST` | `/api/chat/stop` | Abort the current running Agent stream for a chat |
| `GET` | `/api/workspaces/:workspaceId/knowledge-graph` | Load the latest persisted product knowledge graph for a workspace |

`POST /api/chat` returns `text/event-stream` and uses typed events including `start`, `agent-status`, `thinking`, `text`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `request-analysis-start`, `request-analysis-complete`, `todo-update`, `tool-call`, `tool-result`, `token-usage`, `step-finish`, `finish`, `abort`, and `error`, followed by `[DONE]`.

`POST /api/chat` may include `enabledTools: ["web_search"]`. The shared schema also knows the internal knowledge-graph file tool names, but runtime authorization still decides which agents may actually see each enabled or internally attached tool.

`thinking` events may include `agentType`. The frontend uses that field to place reasoning next to the corresponding stage.

Product-workflow confirmation/proposal form submissions must include enough tagged block history for the backend to restore the previous workflow context. The API should route those answers into LangGraph resume handling instead of creating a fresh Request Agent run; the next Planner DAG should be a `status: "supplement"` plan.

`agent-status` events are the authoritative realtime source for `activeAgent` / `activeAgents`. The frontend must remove `conversation` from the active set after `user-input-complete`, and must not keep a completed Agent in the top-right "正在思考 / 并行思考" indicator while later workflow Agents run.

`POST /api/chat/stop` aborts the server-side runtime `AbortController` for the current `chatId`. Frontend stop handling should call this endpoint before aborting the browser fetch so the model provider request is cancelled, not merely hidden in the UI.

## Message Persistence

- User messages are persisted before agent execution.
- Conversation Agent output is persisted as an assistant message with `message.type = "conversation"`.
- Request Agent output is persisted as an assistant message with `message.type = "request"`.
- Agent reasoning is stored in `message.meta.reasoningContent`.
- Conversation Agent structured user input is stored in `message.user_input`.
- Request Agent analysis is written to the request message content and request-form items.
- Product workflow completion content in `message.content` is reduced to a short archival summary; the structured workflow details are persisted through request-form/task/product-knowledge-graph tables.
- Knowledge-graph tool results in `message.meta.toolCalls` are stored as lightweight summaries only. Full graph state must be read from `product_knowledge_graph`.
- `request_form.status` tracks high-level processing state such as `received`, `conversation_consumed`, `request_agent_running`, `request_analyzed`, `workflow_running`, `pending_user_confirmation`, `completed`, `stopped`, and `failed`.
- `request_form_item.status` tracks item-level progress. Proposal confirmation forms are represented by `decision` items; when a user submits a proposal decision, the corresponding `decision` and all referenced `proposal` items must be marked `finish` and record the answer in `payload`.
- Pending proposal decision restoration must merge current pending `proposal` items into the visible question form, consolidate duplicate or near-duplicate visible questions, and preserve every distinct `source_task_id`/`source_agent` row in `sources`.
- After a supplement DAG completes, request-form persistence should transition the round to `completed` and retain final completion metadata so restored chats show the workflow as finished.
- `product_knowledge_graph` stores the latest structured graph for each workspace in `summary`, `nodes`, `relations`, `decisions`, `risks`, and `open_questions`. Legacy heavyweight `content` and `entities` fields must remain empty because they are scheduled for removal. It has one current row per `workspace_id`, optional `conversation_id` / `request_form_id` provenance, and a `version` that increments once per workflow round.
- `GET /api/chats/:id/messages` returns message `type`, `reasoningContent`, `userInput`, `requestAnalysis`, Planner DAG data, executor completion results, and tool calls so the frontend can restore the correct display order.

## Frontend Rendering Order

Message rendering is staged:

1. Conversation Agent reasoning.
2. Todo updates.
3. Conversation Agent tool calls, such as `web_search`, in a collapsed `ToolCallsCard`.
4. Visible assistant prose.
5. Question form.
6. 用户输入整理 card.
7. Request Agent reasoning and Request Agent tool calls.
8. Request Agent 分析 card.
9. Planner reasoning, Planner DAG progress, and Planner tool calls.
10. Each Executor Agent reasoning block followed by that Executor's own knowledge-graph tool card.
11. Planner Agent Review status card, shown after the Executor Agent sections once all Executors have finished and Planner is thinking about follow-up questions.
12. Product-workflow completion card after the final confirmation/supplement archive completes.
13. Future agent-specific reasoning blocks.

`ToolCallsCard`, `UserInputCard`, and `RequestAnalysisCard` default to collapsed so detailed intermediate data stays available without pushing normal assistant prose out of view. Tool calls must preserve `agentType`; the frontend uses it to avoid merging all Executor tool calls into a single card.

When a retry or supplement resume restores an existing Planner DAG, completed Executor nodes should stay visibly completed instead of reverting to waiting. Only new, failed, or pending supplement tasks should appear as active.

`ChatApp` refreshes `GET /api/workspaces/:workspaceId/knowledge-graph` whenever a new Executor result appears in the active message. This makes the knowledge-graph viewer button available after each completed Executor, not only after the full workflow ends.

The top-right active-Agent indicator may show multiple entries during parallel Executor execution. Each entry must scroll to the related visible reasoning/loading card. When the chat viewport is already at the bottom, the click handler should first disable auto-stick-to-bottom behavior and then scroll on the next animation frame so the automatic bottom lock does not cancel the jump.

The knowledge-graph modal in `apps/web/src/components/modals/KnowledgeGraphModal.tsx` owns G6 graph lifecycle. It should retry initialization while the Ant Design modal container reports zero dimensions, avoid one-shot initialization latches that can leave the modal permanently in "正在渲染知识图谱", and hide edge labels for dense graphs to keep the layout readable.

## Development Workflow

```bash
pnpm install
cp .env.example .env
pnpm --filter @repo/database db:generate
pnpm --filter @repo/database db:push
pnpm build
pnpm dev
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build all packages/apps through Turbo |
| `pnpm dev` | Start all dev services through Turbo |
| `pnpm --filter @repo/api dev` | Start only the API |
| `pnpm --filter web dev` | Start only the frontend |
| `pnpm --filter web build` | Type-check and build only the frontend |
| `pnpm --filter @repo/database db:generate` | Generate Prisma Client |

## Current Notes

1. Build shared packages before app dev scripts because package entry points reference `dist/`.
2. Do not commit generated `dist/` output.
3. Preserve the `/api/chat` SSE event names when changing streaming behavior.
4. Persisted workspace/chat/message data lives in PostgreSQL through Prisma.
5. Do not store chat message history in browser `localStorage`.
6. Preserve `message.type` and SSE `agentType` when adding new agents so reasoning and results can be displayed in the right stage.
7. Standard browser folder selection may not expose full absolute paths. Keep manual path entry and host-provided path handling intact.
8. Keep runtime tool access centralized in `tool-access.ts`; do not grant tools directly inside individual agents unless the centralized policy is updated.
9. Apply the `product_knowledge_graph` SQL before running workflows that need final knowledge-graph archival.
