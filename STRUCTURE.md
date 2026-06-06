# meta-pm-agent 项目结构说明书

## 项目概述

AI 驱动的项目管理（PM）智能体，基于 LangGraph 状态机编排。采用 pnpm workspaces + Turborepo 的 monorepo 架构，TypeScript 全栈。

## 技术栈

| 层次 | 技术 | 说明 |
|------|------|------|
| 智能体运行时 | LangGraph + LangChain | 状态图驱动的 PM 代理 |
| API 服务 | Hono | 轻量 HTTP 框架 (port 3001) |
| 前端 | Next.js 16 + Tailwind CSS 4 | 聊天 UI (port 3000) |
| 后台任务 | BullMQ + Redis | 消息队列异步处理 |
| 数据持久化 | PostgreSQL + Prisma | ORM 管理数据模型 |
| 构建工具 | Turborepo | monorepo 任务编排 |
| 包管理 | pnpm 11.3.0 | workspace 依赖管理 |

---

## 目录结构

```
meta-pm-agent/
├── apps/                          # 应用层（可独立运行的服务）
│   ├── agent-runtime/             # LangGraph 智能体运行时
│   │   ├── src/
│   │   │   ├── graph.ts           # 核心状态图逻辑
│   │   │   └── index.ts           # 入口（导出 runAgent）
│   │   ├── dist/                  # 编译产物（不提交到 git）
│   │   ├── tsconfig.json          # composite: true，references shared
│   │   └── package.json           # @repo/agent-runtime
│   │
│   ├── api/                       # Hono HTTP API 服务
│   │   ├── src/
│   │   │   └── index.ts           # 路由定义 (GET /, POST /chat)
│   │   ├── dist/
│   │   ├── tsconfig.json
│   │   └── package.json           # @repo/api
│   │
│   ├── web/                       # Next.js 16 前端
│   │   ├── app/
│   │   │   ├── layout.tsx         # 根布局（Geist 字体）
│   │   │   ├── page.tsx           # 聊天页面（客户端组件）
│   │   │   └── globals.css        # Tailwind v4 全局样式
│   │   ├── public/
│   │   ├── .next/                 # 构建产物
│   │   ├── next.config.ts
│   │   ├── eslint.config.mjs      # Next.js ESLint 配置
│   │   ├── postcss.config.mjs
│   │   ├── tsconfig.json          # TS 5.8.3（独立配置，noEmit）
│   │   └── package.json           # web (name: "web")
│   │
│   └── worker/                    # BullMQ Redis 后台任务
│       ├── src/
│       │   └── index.ts           # Queue + Worker 定义
│       ├── dist/
│       ├── tsconfig.json
│       └── package.json           # @repo/worker
│
├── packages/                      # 共享库层（需要先构建才能被 apps 引用）
│   ├── shared/                    # 共享类型、Zod schemas、DTO、事件定义
│   │   ├── src/
│   │   │   ├── index.ts           # 桶文件
│   │   │   ├── schemas/
│   │   │   │   ├── index.ts
│   │   │   │   └── chat.ts        # ChatMessageSchema, ChatSessionSchema
│   │   │   ├── events/
│   │   │   │   ├── index.ts
│   │   │   │   └── chat.ts        # EventType, ChatEvent 联合类型
│   │   │   └── dto/
│   │   │       ├── index.ts
│   │   │       └── chat.ts        # CreateMessageDTO, PaginatedResponseDTO
│   │   ├── dist/                  # 编译产物（package.json main 指向这里）
│   │   ├── tsconfig.json          # composite: true, declaration: true
│   │   └── package.json           # @repo/shared
│   │
│   └── database/                  # Prisma 客户端单例
│       ├── src/
│       │   ├── index.ts           # 桶文件
│       │   └── client.ts          # 全局单例 PrismaClient
│       ├── prisma/
│       │   └── schema.prisma      # 数据模型定义（ChatSession, ChatMessage）
│       ├── dist/
│       ├── tsconfig.json          # composite: true, types: ["node"]
│       └── package.json           # @repo/database
│
├── references/                    # 参考文档
│   ├── config/
│   ├── guides/
│   ├── modules/
│   ├── prompts/
│   └── templates/
│
├── .env.example                   # 环境变量模板
├── .env                           # 本地环境变量（不提交）
├── .gitignore
├── AGENTS.md                      # AI 编码助手配置说明
├── README.md                      # 项目说明
├── package.json                   # 根 package（private, pnpm 11.3.0）
├── pnpm-workspace.yaml            # workspace 定义 + allowBuilds
├── pnpm-lock.yaml
├── tsconfig.base.json             # 共享 TS 基础配置
└── turbo.json                     # Turborepo 任务编排
```

---

## 模块依赖关系

```
apps/web (Next.js)
    │
    └── HTTP POST /chat ──▶ apps/api (Hono, :3001)
                                │
                                ├──▶ packages/shared          (Zod schemas, types, DTO)
                                │
                                └──▶ apps/agent-runtime       (runAgent)
                                         │
                                         └──▶ packages/shared

apps/worker (BullMQ)
    │
    ├──▶ apps/agent-runtime       (待接入)
    ├──▶ packages/shared
    └── Redis (消息队列)

packages/database (Prisma)
    │
    └── 数据模型已定义，尚未被 runtime 服务直接引用
```

**依赖特点：**
- `packages/shared` 和 `packages/database` 为 `composite: true` 的 TS 项目，通过 `dist/` 目录下的编译产物被其他项目引用
- `apps/api` 和 `apps/worker` 通过 project references 引用 `packages/shared` 和 `apps/agent-runtime`
- `apps/web` 使用独立的 TS 5.8.3 配置（Next.js 要求），通过 workspace 依赖引用 `@repo/shared`

---

## 核心模块详解

### 1. apps/agent-runtime — 智能体运行时

**职责**：提供 PM 智能体的核心推理逻辑，基于 LangGraph 状态图实现。

**状态图流程**：
```
START
  │
  ▼
classifyIntent   ←── 关键词分类：plan / estimate / general
  │
  ▼
routeByIntent    ←── 条件路由
  │
  ├── "plan"      → generatePlan()     → 返回 5 阶段项目计划模板
  ├── "estimate"  → estimateEffort()   → 返回任务拆解评估表
  └── "general"   → generalResponse()  → 返回帮助信息
  │
  ▼
END
```

**导出接口**：
- `runAgent(message: ChatMessage): Promise<string>` — 调用状态图，返回智能体响应

**已知问题**：
- `graph.ts` 中 LangGraph API 类型推断与 `@langchain/langgraph` 版本不完全兼容，`tsc` 编译会报错；`tsx`（开发模式）不受影响

---

### 2. apps/api — Hono HTTP API

**职责**：对外提供 RESTful API，作为前端与智能体之间的桥梁。

**路由表**：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 健康检查，返回 `{ status: "ok" }` |
| `POST` | `/chat` | 接收用户消息，调用 `runAgent`，返回智能体回复 |

**请求体格式** (`POST /chat`)：
```json
{
  "role": "user",
  "content": "帮我规划前端项目",
  "sessionId": "uuid-optional"
}
```

**中间件**：
- CORS（全局启用）

---

### 3. apps/web — Next.js 前端

**职责**：提供用户聊天界面。

**核心组件**：
- `layout.tsx` — 服务端组件，设置 HTML 结构和 Geist 字体
- `page.tsx` — 客户端组件（`"use client"`），管理聊天状态与 UI 渲染
  - 状态：`messages[]`, `input`, `loading`
  - 交互：输入文本 → POST 到 `http://localhost:3001/chat` → 渲染响应
  - UI：用户消息右对齐深色气泡，助手消息左对齐浅色气泡
  - 自动滚动到底部（useEffect + useRef）

**样式**：
- Tailwind CSS v4（`@import "tailwindcss"`）
- 通过 `@tailwindcss/postcss` PostCSS 插件集成

---

### 4. apps/worker — 后台任务 Worker

**职责**：通过 BullMQ 消费 Redis 中的消息队列任务。

**当前状态**：
- 创建了 `Queue("chat")` 和 `Worker("chat")`
- Worker 仅打印接收到的任务数据 `{ content, sessionId }`
- 尚未接入 `runAgent` 或其他实际处理逻辑

**Redis 配置**（通过环境变量）：
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_USERNAME`, `REDIS_DB`, `REDIS_TLS`

---

### 5. packages/shared — 共享库

**职责**：提供所有模块间共享的类型定义、校验规则、DTO 和事件定义。

**三个子模块**：

| 子模块 | 文件 | 导出内容 |
|--------|------|----------|
| `schemas/chat.ts` | Zod 校验模式 | `ChatMessageSchema`, `ChatSessionSchema`, `CreateChatMessageSchema` 及推断类型 |
| `events/chat.ts` | 事件类型 | `EventType` 联合类型，`ChatEvent` 可辨识联合（`message.created` / `message.processed` / `agent.thinking` / `agent.completed`） |
| `dto/chat.ts` | 数据传输对象 | `CreateMessageDTO`, `ChatResponseDTO`, `PaginationDTO`, `PaginatedResponseDTO<T>` |

**注意事项**：
- `main` 指向 `./dist/index.js`，使用前必须先 `pnpm build`
- 开发时若修改该库，需重新构建以使 apps 获取最新类型

---

### 6. packages/database — 数据库层

**职责**：提供 Prisma ORM 数据库访问。

**数据模型** (`prisma/schema.prisma`)：

```prisma
model ChatSession {
  id        String        @id @default(uuid())
  title     String
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  messages  ChatMessage[]
}

model ChatMessage {
  id        String     @id @default(uuid())
  role      String
  content   String
  timestamp DateTime   @default(now())
  sessionId String
  session   ChatSession @relation(fields: [sessionId], references: [id])
}
```

**Prisma 命令**：
| 命令 | 说明 |
|------|------|
| `pnpm --filter @repo/database db:generate` | 生成 Prisma Client |
| `pnpm --filter @repo/database db:push` | 同步 schema 到数据库 |
| `pnpm --filter @repo/database db:migrate` | 创建迁移文件 |
| `pnpm --filter @repo/database db:studio` | 打开 Prisma Studio |

---

## 开发工作流

### 环境要求

- Node.js 18+
- pnpm 11.3.0（`corepack enable`）
- PostgreSQL
- Redis

### 首次启动

```bash
pnpm install                              # 安装依赖
cp .env.example .env                      # 配置环境变量
pnpm --filter @repo/database db:push      # 初始化数据库
pnpm build                                # 构建共享库（必须！）
pnpm dev                                  # 启动所有服务
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建所有包（依序：packages → apps） |
| `pnpm dev` | 启动所有服务开发模式 |
| `pnpm lint` | 运行检查（仅 web 已配置 ESLint） |
| `pnpm --filter @repo/api dev` | 单独启动 API |
| `pnpm --filter web dev` | 单独启动前端 |
| `pnpm --filter @repo/worker dev` | 单独启动 Worker |

### 服务端口

| 服务 | 端口 | 访问方式 |
|------|------|----------|
| API | 3001 | `http://localhost:3001` |
| Web | 3000 | `http://localhost:3000` |

---

## TypeScript 配置说明

### 根配置 `tsconfig.base.json`

- `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`
- `ignoreDeprecations: "6.0"` — 因为使用了已标记弃用的 `baseUrl`
- 定义了全局路径别名：`@repo/agent-runtime/*`, `@repo/tools/*`, `@repo/agents/*`

### 编译方式差异

| 项目 | TS 版本 | composite | 输出 | 说明 |
|------|---------|-----------|------|------|
| `packages/shared` | 6.0.3 | yes | dist/ | 共享库，应用通过 project references 引用 |
| `packages/database` | 6.0.3 | yes | dist/ | 需要 `types: ["node"]` |
| `apps/agent-runtime` | 6.0.3 | yes | dist/ | 复合项目 |
| `apps/api` | 6.0.3 | no | dist/ | references debug |
| `apps/worker` | 6.0.3 | no | dist/ | references shared + agent-runtime |
| `apps/web` | 5.8.3 | no | noEmit | Next.js 独立配置，**不要升级 TS 版本** |

---

## 环境变量

```bash
# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/meta-pm-agent"

# Redis (BullMQ worker)
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD=""
REDIS_USERNAME=""
REDIS_DB="0"
REDIS_TLS="false"
```

---

## 已知注意事项

1. **构建顺序**：共享 package（shared、database）必须先构建，因为 apps 引用它们的 `dist/` 产物，而非原始 TS 源码
2. **TS 版本差异**：`apps/web` 使用 TS 5.8.3（Next.js 16 限制），其余项目使用 6.0.3
3. **LangGraph 类型错误**：`apps/agent-runtime/src/graph.ts` 存在类型推断问题，`tsc` 会报错但不影响 `tsx` 运行
4. **Lint 覆盖不全**：仅 `apps/web` 配置了 ESLint（Next.js），根级别暂无 lint/typecheck 脚本
5. **dist 目录**：所有构建产物在 `.gitignore` 中，不提交到仓库
6. **pnpm 严格隔离**：`packages/database` 需显式声明 `"types": ["node"]` 才能访问 `process.env`
