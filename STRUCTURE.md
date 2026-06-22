# meta-pm-agent Project Structure

## Overview

`meta-pm-agent` is a pnpm + Turborepo monorepo for an AI-assisted product-management workspace. It contains a LangGraph/DeepAgents runtime, a Hono API with SSE streaming, abortable model execution and PostgreSQL persistence, a Vite + React + Ant Design frontend, a BullMQ worker scaffold, and shared TypeScript/database packages.

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Agent runtime | LangGraph, LangChain, DeepAgents | Conversation Agent, Request Agent, JSON-only Planner/Executor/ProductDirector workflow graph |
| API | Hono | HTTP API on port 3001, SSE `/api/chat` stream, `/api/chat/stop`, Prisma repositories |
| Web | Vite, React, Ant Design 6 | Workspace and chat UI, TypeScript 5.8.3 |
| Web search | LangChain tool + Tavily/free public indexes | Optional `web_search` runtime tool, centrally authorized per Agent |
| Worker | BullMQ, Redis | Background queue worker scaffold |
| Database | PostgreSQL, Prisma | Account, workspace, conversation, message, request-form, task data |
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
│  │  │  │  │  ├─ product-director-agent/
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
parse_user_input -> request_agent -> product_workflow -> END
```

`product_workflow` is implemented in `apps/agent-runtime/src/graph/nodes/product-workflow-node.ts`. It invokes the ProductDirector workflow, which streams Planner Agent DAG output, Executor Agent results, and ProductDirector review output. The SSE path uses `streamWorkflowGraph` so intermediate reasoning, Planner DAG cards, executor results, and confirmation forms remain visible while the graph owns the stage transitions.

The workflow stage delegates model work to independent JSON-only DeepAgents:

| Directory | Responsibility |
| --- | --- |
| `apps/agent-runtime/src/agents/common/run-json-agent.ts` | Shared DeepAgent runner that enforces JSON object output, validates with Zod-compatible schemas, streams reasoning, and returns MVP fallback data on model or parse failure |
| `apps/agent-runtime/src/agents/product-workflow/planner-agent/` | Planner Agent implementation and prompt; converts Request Agent analysis plus product context into a persisted `task_execution` DAG |
| `apps/agent-runtime/src/agents/product-workflow/executor-agent/` | Executor Agent implementation, prompt, and fixed executor definitions; executes one DAG task and emits graph delta suggestions |
| `apps/agent-runtime/src/agents/product-workflow/product-director-agent/` | ProductDirector Agent implementation and prompt; reviews Planner/Executor outputs and prepares confirmation data |
| `apps/agent-runtime/src/agents/product-workflow/agent.ts` | Product workflow orchestration, stream event forwarding, tagged block formatting, and question-form formatting only |

Each product workflow Agent keeps its prompt beside its implementation in `prompt.ts`. Do not reintroduce a shared `product-workflow/prompts/` directory for agent-specific prompts.

The ProductDirector workflow may produce proposal slots from multiple executor tasks. Proposal slot aggregation must preserve `source_task_id` and `source_agent`; identical question text from different tasks is not a duplicate. Do not reintroduce text-only de-duplication or hard caps that hide valid pending proposal items.

### Runtime Tools

Runtime tools are enabled per request through `POST /api/chat` `enabledTools`. The shared schema currently defines `web_search` as the only runtime tool.

Tool visibility is managed centrally in `apps/agent-runtime/src/agents/common/tool-access.ts`. At present, `web_search` is authorized only for the Conversation Agent; Request Agent and future agents should be added through the same access table instead of ad hoc tool wiring.

`apps/agent-runtime/src/agents/common/web-search-tool.ts` implements the `web_search` LangChain tool. It uses `TAVILY_API_KEY` when configured and falls back to free public indexes such as Hacker News Algolia and OpenAlex without extra search dependencies. Search backend failures are returned as structured tool results with `results: []` and `error` instead of throwing, so a network timeout does not terminate the chat stream.

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

`POST /api/chat` returns `text/event-stream` and uses typed events including `start`, `thinking`, `text`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `request-analysis-start`, `request-analysis-complete`, `todo-update`, `tool-call`, `tool-result`, `step-finish`, `finish`, `abort`, and `error`, followed by `[DONE]`.

`POST /api/chat` may include `enabledTools: ["web_search"]`. The API validates tool names with the shared schema and passes them to the runtime; the runtime decides which agents may actually see each enabled tool.

`thinking` events may include `agentType`. The frontend uses that field to place reasoning next to the corresponding stage.

`POST /api/chat/stop` aborts the server-side runtime `AbortController` for the current `chatId`. Frontend stop handling should call this endpoint before aborting the browser fetch so the model provider request is cancelled, not merely hidden in the UI.

## Message Persistence

- User messages are persisted before agent execution.
- Conversation Agent output is persisted as an assistant message with `message.type = "conversation"`.
- Request Agent output is persisted as an assistant message with `message.type = "request"`.
- Agent reasoning is stored in `message.meta.reasoningContent`.
- Conversation Agent structured user input is stored in `message.user_input`.
- Request Agent analysis is written to the request message content and request-form items.
- `request_form.status` tracks high-level processing state such as `received`, `conversation_consumed`, `request_agent_running`, `request_analyzed`, `workflow_running`, `pending_user_confirmation`, `completed`, `stopped`, and `failed`.
- `request_form_item.status` tracks item-level progress. Proposal confirmation forms are represented by `decision` items; when a user submits a proposal decision, the corresponding `decision` and all referenced `proposal` items must be marked `finish` and record the answer in `payload`.
- Pending proposal decision restoration must merge current pending `proposal` items into the visible question form, preserving distinct `source_task_id`/`source_agent` rows even when question text is identical.
- `GET /api/chats/:id/messages` returns message `type`, `reasoningContent`, `userInput`, and `requestAnalysis` so the frontend can restore the correct display order.

## Frontend Rendering Order

Message rendering is staged:

1. Conversation Agent reasoning.
2. Todo updates.
3. Tool calls, including `web_search`, in a collapsed `ToolCallsCard`.
4. Visible assistant prose.
5. Question form.
6. 用户输入整理 card.
7. Request Agent reasoning.
8. Request Agent 分析 card.
9. Future agent-specific reasoning blocks.

`ToolCallsCard`, `UserInputCard`, and `RequestAnalysisCard` default to collapsed so detailed intermediate data stays available without pushing normal assistant prose out of view.

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
