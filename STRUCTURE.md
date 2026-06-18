# meta-pm-agent Project Structure

## Overview

`meta-pm-agent` is a pnpm + Turborepo monorepo for an AI-assisted product-management workspace. It contains a LangGraph/DeepAgents runtime, a Hono API with SSE streaming and PostgreSQL persistence, a Vite + React + Ant Design frontend, a BullMQ worker scaffold, and shared TypeScript/database packages.

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Agent runtime | LangGraph, LangChain, DeepAgents | Conversation Agent, Request Agent, reasoning stream, workflow graph |
| API | Hono | HTTP API on port 3001, SSE `/api/chat` stream, Prisma repositories |
| Web | Vite, React, Ant Design 6 | Workspace and chat UI, TypeScript 5.8.3 |
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
│  │  │  │  └─ request/
│  │  │  ├─ graph/
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

When a user submits a form answer, the Conversation Agent first emits a `user-input` block. The runtime then starts the Request Agent and streams its reasoning with `agentType: "request"` before emitting `request-analysis-complete`.

The Request Agent output is persisted as a separate assistant message with `message.type = "request"`. Its reasoning is stored in `message.meta.reasoningContent`.

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

`POST /api/chat` returns `text/event-stream` and uses typed events including `start`, `thinking`, `text`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `request-analysis-start`, `request-analysis-complete`, `todo-update`, `tool-call`, `tool-result`, `step-finish`, `finish`, and `error`, followed by `[DONE]`.

`thinking` events may include `agentType`. The frontend uses that field to place reasoning next to the corresponding stage.

## Message Persistence

- User messages are persisted before agent execution.
- Conversation Agent output is persisted as an assistant message with `message.type = "conversation"`.
- Request Agent output is persisted as an assistant message with `message.type = "request"`.
- Agent reasoning is stored in `message.meta.reasoningContent`.
- Conversation Agent structured user input is stored in `message.user_input`.
- Request Agent analysis is written to the request message content and request-form items.
- `GET /api/chats/:id/messages` returns message `type`, `reasoningContent`, `userInput`, and `requestAnalysis` so the frontend can restore the correct display order.

## Frontend Rendering Order

Message rendering is staged:

1. Conversation Agent reasoning.
2. Visible assistant prose.
3. Question form.
4. 用户输入整理 card.
5. Request Agent reasoning.
6. Request Agent 分析 card.
7. Future agent-specific reasoning blocks.

`UserInputCard` and `RequestAnalysisCard` default to collapsed.

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
