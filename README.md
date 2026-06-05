# meta-pm-agent

AI-powered project management agent with LangGraph state machine orchestration.

## Stack

- **Agent runtime**: LangGraph + LangChain (TypeScript)
- **API**: Hono (port 3001)
- **Frontend**: Next.js 16 + Tailwind CSS 4 (port 3000)
- **Worker**: BullMQ + Redis
- **Database**: PostgreSQL + Prisma
- **Monorepo**: pnpm workspaces + Turborepo

## Getting started

### Prerequisites

- Node.js 18+
- pnpm 11.3.0 (`corepack enable`)
- PostgreSQL
- Redis

### Setup

```bash
# Install dependencies
pnpm install

# Copy and fill in environment variables
cp .env.example .env

# Initialize the database
pnpm --filter @repo/database db:push

# Build shared packages (required before running apps)
pnpm build

# Start all apps in dev mode
pnpm dev
```

### Services

| Service | Port | Command |
|---------|------|---------|
| API | 3001 | `pnpm --filter @repo/api dev` |
| Web | 3000 | `pnpm --filter web dev` |
| Worker | — | `pnpm --filter @repo/worker dev` |

### API endpoints

```
GET  /      health check
POST /chat  send a chat message to the PM agent
```

### Project structure

```
apps/
  api/             Hono HTTP API
  web/             Next.js frontend
  worker/          BullMQ Redis worker
  agent-runtime/   LangGraph agent state machine
packages/
  shared/          Shared types, Zod schemas, DTOs
  database/        Prisma client singleton
```

## Scripts

```bash
pnpm build    # build all packages and apps (order: dependencies first)
pnpm dev      # run all apps in dev mode (build shared packages first)
pnpm lint     # lint all projects (only web has eslint configured)
```
