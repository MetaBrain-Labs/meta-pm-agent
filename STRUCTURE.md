# meta-pm-agent Project Structure

## Overview

`meta-pm-agent` is a pnpm + Turborepo monorepo for an AI-assisted PM workspace. It contains a LangGraph/DeepAgents-based runtime, a Hono API with SSE streaming and PostgreSQL persistence, a Vite + React + Ant Design frontend, a BullMQ worker, and shared TypeScript/database packages.

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Agent runtime | LangGraph, LangChain, DeepAgents | PM conversation agent, question/user-input extraction, reasoning stream |
| API | Hono | HTTP API on port 3001, SSE `/api/chat` stream |
| Web | Vite, React, Ant Design 5 | Workspace and chat UI on port 3000 |
| Worker | BullMQ, Redis | Background queue worker scaffold |
| Database | PostgreSQL, Prisma | Users, workspaces, conversations, messages, request forms, tasks |
| Build | Turborepo | Workspace task graph |
| Package manager | pnpm 11.3.0 | Enforced by root `packageManager` |

## Directory Layout

```text
meta-pm-agent/
├── apps/
│   ├── agent-runtime/
│   │   ├── src/
│   │   │   ├── index.ts                 # Runtime exports
│   │   │   ├── conversation-agent.ts    # Streaming PM conversation agent
│   │   │   ├── graph.ts                 # Legacy LangGraph state graph
│   │   │   ├── model.ts                 # LLM model factory/config usage
│   │   │   ├── config.ts                # Runtime env config
│   │   │   ├── prompts/                 # Discovery/compress/direction prompts
│   │   │   └── utils/
│   │   │       ├── form-parser.ts
│   │   │       ├── message-adapter.ts
│   │   │       └── tagged-block-stream.ts
│   │   └── package.json                 # @repo/agent-runtime
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts                   # Hono app composition
│   │   │   ├── index.ts                 # Node server entry
│   │   │   ├── env.ts                   # dotenv/env loading
│   │   │   ├── routes/chat.ts           # Account/workspace/chat/SSE routes
│   │   │   ├── schemas/chat.ts          # API request validation schemas
│   │   │   ├── services/                # Workspace/chat/agent-stream services
│   │   │   ├── repositories/            # Prisma-backed repositories
│   │   │   └── utils/                   # SSE and user-input helpers
│   │   └── package.json                 # @repo/api
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.tsx                 # React entry
│   │   │   ├── App.tsx                  # Route/workspace/config orchestration
│   │   │   ├── types.ts                 # Frontend data and stream types
│   │   │   ├── styles.css               # App styling
│   │   │   ├── hooks/useChat.ts         # SSE chat state management
│   │   │   ├── utils/                   # Stream, markdown, question/user input parsing
│   │   │   └── components/
│   │   │       ├── ChatApp.tsx          # Workspace detail + chat surface
│   │   │       ├── Sidebar.tsx          # Chat history/workspace sidebar
│   │   │       ├── MessageBubble.tsx
│   │   │       ├── ProseBlock.tsx
│   │   │       ├── QuestionForm.tsx
│   │   │       ├── UserInputCard.tsx
│   │   │       ├── TodoCard.tsx
│   │   │       └── Icon.tsx
│   │   ├── vite.config.ts               # Vite config and `/api` proxy
│   │   └── package.json                 # web
│   └── worker/
│       ├── src/index.ts                 # BullMQ queue/worker entry
│       └── package.json                 # @repo/worker
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── schemas/                 # Shared Zod schemas
│   │   │   ├── events/                  # Chat/event types
│   │   │   ├── dto/                     # DTO types
│   │   │   └── agent/                   # Graph/runtime/state types
│   │   └── package.json                 # @repo/shared
│   └── database/
│       ├── src/client.ts                # PrismaClient singleton
│       ├── src/index.ts                 # Package exports
│       ├── prisma/schema.prisma         # PostgreSQL schema
│       └── package.json                 # @repo/database
├── references/                          # Product/agent reference docs and prompts
├── .env.example
├── AGENTS.md
├── AGENTS-zh.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── turbo.json
```

Generated `dist/` directories are intentionally omitted from the tree and must not be committed.

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

Shared package entry points reference `dist/`, so run `pnpm build` at least once before starting apps that import workspace packages.

## Runtime Modules

### `apps/agent-runtime`

The runtime provides the PM conversation agent and streaming behavior used by the API. `conversation-agent.ts` adapts frontend chat messages into model messages, streams reasoning as `thinking`, streams visible answer content as `text`, extracts structured question/user-input blocks, emits tool/todo events, and filters internal DeepAgent environment noise such as `No files found in /` from user-visible text.

Key exports include `streamConversation`, legacy graph helpers, form parsing helpers, and message adaptation utilities. Runtime configuration comes from:

- `OPENAI_API_KEY`
- `LLM_MODEL`
- `LLM_BASE_URL`

### `apps/api`

The API exposes account, workspace, chat, message, and SSE routes. It validates request bodies with Zod, persists data through Prisma repositories, and streams agent events to the frontend.

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

The SSE stream returns `text/event-stream` and uses typed events including `start`, `thinking`, `text`, `question-form-start`, `question-form-complete`, `user-input-start`, `user-input-complete`, `todo-update`, `tool-call`, `tool-result`, `step-finish`, `finish`, and `error`, followed by `[DONE]`.

### `apps/web`

The frontend is a routed Vite/React app:

| Route | View |
| --- | --- |
| `/workplace` | Workspace homepage, workspace list, account/config modal, create/open/sync actions |
| `/chat/:workspaceId` | Workspace detail chat page |
| `/chat/:workspaceId/:threadId` | Specific persisted conversation |

The workspace homepage loads account and workspace data from the API. Creating a workspace sends `name` and `localPath` to `POST /api/workspaces`. Browser directory pickers cannot reliably expose a full absolute path in standard web contexts; the code uses host-provided `file.path` when available and keeps the path field editable.

The chat page loads workspace chats from `GET /api/chats`, loads persisted messages from `GET /api/chats/:id/messages`, and keeps a localStorage cache for responsive UI state. The model selector currently exposes only `DeepSeek V4 Pro`.

### `apps/worker`

The worker currently sets up a BullMQ queue and worker around Redis. It is a scaffold for background execution and is not the primary chat execution path.

## Database

`packages/database/prisma/schema.prisma` models the persisted product state:

- `User`: local/default account profile.
- `Workspace`: user-owned workspace with local/cloud path fields and sync status.
- `Conversation`: chat thread scoped to a workspace and user.
- `Message`: persisted user/assistant messages, metadata, reasoning content in `meta`, and parsed `userInput`.
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
| `apps/web` | 5.8.3 | no | no emit | Vite app; do not upgrade TS |

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
3. Preserve the `/api/chat` SSE event contract when changing streaming behavior.
4. Persisted workspace/chat/message data lives in PostgreSQL through Prisma; frontend localStorage is a cache, not the source of truth.
5. `apps/web` has ESLint configured through `eslint-config-next`, but local lint may fail if `next/dist/compiled/babel/eslint-parser` is unavailable.
6. Standard browser folder selection may not expose full absolute paths. Keep manual path entry and host-provided path handling intact.
