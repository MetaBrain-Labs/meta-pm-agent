# meta-pm-agent Project Structure

## Overview

`meta-pm-agent` is a pnpm + Turborepo monorepo for an AI-assisted product-management workspace. It contains a LangGraph/DeepAgents runtime, a Hono API with SSE streaming and PostgreSQL persistence, a Vite + React + Ant Design frontend, a BullMQ worker scaffold, and shared TypeScript/database packages.

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Agent runtime | LangGraph, LangChain, DeepAgents | Conversation Agent, Request Agent, reasoning stream, workflow graph |
| API | Hono | HTTP API on port 3001, SSE `/api/chat` stream, Prisma repositories |
| Web | Vite, React, Ant Design 5 | Workspace and chat UI, TypeScript 5.8.3 |
| Worker | BullMQ, Redis | Background queue worker scaffold |
| Database | PostgreSQL, Prisma | Account, workspace, conversation, message, request-form, task data |
| Build | Turborepo | Workspace task graph |
| Package manager | pnpm 11.3.0 | Enforced by root `packageManager` |

## Directory Layout

```text
meta-pm-agent/
├── apps/
│   ├── agent-runtime/
│   │   ├── src/
│   │   │   ├── agents/
│   │   │   │   ├── common/model.ts
│   │   │   │   ├── conversation/
│   │   │   │   │   ├── agent.ts
│   │   │   │   │   ├── prompt.ts
│   │   │   │   │   └── stream.ts
│   │   │   │   └── request/
│   │   │   │       ├── agent.ts
│   │   │   │       ├── prompt.ts
│   │   │   │       └── user-input.ts
│   │   │   ├── graph/
│   │   │   │   ├── nodes/request-node.ts
│   │   │   │   ├── state.ts
│   │   │   │   └── workflow.ts
│   │   │   ├── utils/
│   │   │   │   ├── form-parser.ts
│   │   │   │   ├── json.ts
│   │   │   │   ├── message-adapter.ts
│   │   │   │   └── tagged-block-stream.ts
│   │   │   ├── config.ts
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   └── package.json
│   ├── api/
│   │   ├── src/
│   │   │   ├── controllers/
│   │   │   │   ├── chat.ts
│   │   │   │   └── chat-controller.ts
│   │   │   ├── repositories/
│   │   │   │   ├── chat-repository.ts
│   │   │   │   ├── message-repository.ts
│   │   │   │   ├── request-form-repository.ts
│   │   │   │   └── workspace-repository.ts
│   │   │   ├── schemas/
│   │   │   ├── services/
│   │   │   ├── utils/
│   │   │   ├── app.ts
│   │   │   ├── env.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ChatApp.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── ProseBlock.tsx
│   │   │   │   ├── QuestionForm.tsx
│   │   │   │   ├── RequestAnalysisCard.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── TodoCard.tsx
│   │   │   │   └── UserInputCard.tsx
│   │   │   ├── hooks/
│   │   │   ├── utils/
│   │   │   │   ├── apply-stream-event.ts
│   │   │   │   ├── markdown.tsx
│   │   │   │   ├── question-form.ts
│   │   │   │   └── user-input.ts
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── styles.css
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── worker/
│       └── src/index.ts
├── packages/
│   ├── database/
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── client.ts
│   │       └── index.ts
│   └── shared/
│       └── src/
│           ├── agent/
│           ├── dto/
│           ├── events/
│           ├── schemas/
│           └── index.ts
├── references/
├── AGENTS.md
├── AGENTS-zh.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── turbo.json
```

Generated `dist/` directories are intentionally omitted and must not be committed.

## Dependency Graph

```text
apps/web
  └── HTTP/SSE through Vite proxy `/api` -> apps/api

apps/api
  ├── @repo/agent-runtime
  ├── @repo/database
  └── @repo/shared

apps/agent-runtime
  └── @repo/shared

apps/worker
  ├── Redis/BullMQ
  ├── @repo/agent-runtime
  └── @repo/shared

packages/database
  └── Prisma Client / PostgreSQL
```

Workspace package entry points reference `dist/`, so run `pnpm build` at least once before starting apps that import workspace packages.

## Runtime Flow

### Conversation Agent

`apps/agent-runtime/src/agents/conversation/stream.ts` is the primary streaming entry point. It adapts frontend chat messages into LangChain messages, streams Conversation Agent reasoning as `reasoning` events with `agentType: "conversation"`, streams visible answer content as `text`, extracts question-form and user-input tagged blocks, and filters internal DeepAgent environment noise such as `No files found in /`.

### Request Agent

When a user submits a form answer, the Conversation Agent first emits a `user-input` block. The runtime then starts the Request Agent and streams its reasoning as `reasoning` events with `agentType: "request"` before emitting `request-analysis-complete`.

The Request Agent output is persisted as a separate assistant message with `message.type = "request"`. Its reasoning is stored in `message.meta.reasoningContent`.

### Workflow Graph

`apps/agent-runtime/src/graph/workflow.ts` remains the shared LangGraph workflow entry point for graph-oriented execution. Keep graph nodes documented and continue extending shared graph state when adding new agents.

## API

The API exposes account, workspace, chat, message, and SSE routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Basic health check |
| `GET` | `/api/health` | API health check |
| `GET` | `/api/account` | Return the local/default account |
| `GET` | `/api/workspaces` | List persisted workspaces |
| `POST` | `/api/workspaces` | Create a workspace with `name` and optional `localPath` |
| `GET` | `/api/chats?workspaceId=...` | List chats for a workspace |
| `POST` | `/api/chats` | Create a chat and its request form |
| `GET` | `/api/chats/:id/messages` | Load persisted chat messages |
| `POST` | `/api/chat` | Stream an agent response with SSE and persist messages |

`POST /api/chat` accepts:

```json
{
  "chatId": "conversation-id",
  "requestFormId": "request-form-id",
  "messages": []
}
```

The SSE stream returns `text/event-stream` and uses typed events including `start`, `thinking`, `text`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `request-analysis-start`, `request-analysis-complete`, `todo-update`, `tool-call`, `tool-result`, `step-finish`, `finish`, and `error`, followed by `[DONE]`.

`thinking` events may include `agentType`. The frontend uses that field to place reasoning next to the corresponding stage.

## Message Persistence

The API persists messages through `apps/api/src/repositories/message-repository.ts`.

- User messages are upserted before agent execution.
- Conversation Agent output is persisted as an assistant message with `message.type = "conversation"`.
- Request Agent output is persisted as an assistant message with `message.type = "request"`.
- Agent reasoning is stored in `message.meta.reasoningContent`.
- Conversation Agent structured user input is stored in `message.user_input`.
- Request Agent analysis remains parseable from the request message content and is also written to request-form items.
- `GET /api/chats/:id/messages` returns message `type`, `reasoningContent`, `userInput`, and `requestAnalysis` so the frontend can restore the correct display order.

Chat message history must be loaded from PostgreSQL through the API. The frontend must not persist chat message history in browser `localStorage`.

## Web

The frontend routes are:

| Route | View |
| --- | --- |
| `/workplace` | Workspace homepage, workspace list, account/config modal, create/open/sync actions |
| `/chat/:workspaceId` | Workspace detail chat page |
| `/chat/:workspaceId/:threadId` | Specific persisted conversation |

The chat page loads workspace chats from `GET /api/chats`, loads messages from `GET /api/chats/:id/messages`, and sends new turns to `POST /api/chat`.

Message rendering is staged:

1. Conversation Agent reasoning.
2. Visible assistant prose.
3. Question form.
4. User input整理 card.
5. Request Agent reasoning.
6. Request Agent分析 card.
7. Future agent-specific reasoning blocks.

`UserInputCard` and `RequestAnalysisCard` default to collapsed.

## Database

`packages/database/prisma/schema.prisma` models the persisted product state:

- `User`: local/default account profile.
- `Workspace`: user-owned workspace with local/cloud path fields and sync status.
- `Conversation`: chat thread scoped to a workspace and user.
- `Message`: persisted user/assistant messages, metadata, Agent type, reasoning content in `meta`, and parsed `userInput`.
- `RequestForm` and `RequestFormItem`: structured request form state for a chat.
- `Task`, `AgentRun`, `Artifact`, `ActivityLog`: task execution and audit entities.

Run Prisma commands from `packages/database` or via package filters:

| Command | Purpose |
| --- | --- |
| `pnpm --filter @repo/database db:generate` | Generate Prisma Client |
| `pnpm --filter @repo/database db:push` | Push schema to the configured database |
| `pnpm --filter @repo/database db:migrate` | Create/apply migrations |
| `pnpm --filter @repo/database db:studio` | Open Prisma Studio |

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
| `pnpm --filter @repo/agent-runtime build` | Build the runtime |
| `pnpm --filter @repo/api test` | Run API tests |
| `pnpm --filter @repo/agent-runtime test` | Run runtime tests |

## TypeScript Notes

| Project | TypeScript | Composite | Output | Notes |
| --- | --- | --- | --- | --- |
| `packages/shared` | 6.0.3 | yes | `dist/` | Shared package consumed from build output |
| `packages/database` | 6.0.3 | yes | `dist/` | Keeps `"types": ["node"]` |
| `apps/agent-runtime` | 6.0.3 | yes | `dist/` | Runtime package |
| `apps/api` | 6.0.3 | no | `dist/` | Imports runtime/database/shared |
| `apps/worker` | 6.0.3 | no | `dist/` | Imports runtime/shared |
| `apps/web` | 5.8.3 | no | no emit | Vite app; do not upgrade TypeScript |

Keep `ignoreDeprecations: "6.0"` in `tsconfig.base.json` because the repo still uses `baseUrl`.

## Environment Variables

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/meta-pm-agent"

OPENAI_API_KEY="your-api-key"
LLM_MODEL="deepseek-chat"
LLM_BASE_URL="https://api.deepseek.com"

REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD=""
REDIS_USERNAME=""
REDIS_DB="0"
REDIS_TLS="false"
```

## Current Notes

1. Build shared packages before app dev scripts because package entry points reference `dist/`.
2. Do not commit generated `dist/` output.
3. Preserve the `/api/chat` SSE event names when changing streaming behavior.
4. Persisted workspace/chat/message data lives in PostgreSQL through Prisma.
5. Do not store chat message history in browser `localStorage`.
6. Preserve `message.type` and SSE `agentType` when adding new agents so reasoning and results can be displayed in the right stage.
7. Standard browser folder selection may not expose full absolute paths. Keep manual path entry and host-provided path handling intact.
