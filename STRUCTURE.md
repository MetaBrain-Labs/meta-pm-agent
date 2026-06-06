# meta-pm-agent 项目结构说明书

## 项目概述

AI 驱动的项目管理（PM）智能体，基于 LangGraph 状态机编排。采用 pnpm workspaces + Turborepo 的 monorepo 架构，TypeScript 全栈。

## 技术栈

| 层次 | 技术 | 说明 |
|------|------|------|
| 智能体运行时 | LangGraph + LangChain | 状态图驱动的 PM 代理 |
| API 服务 | Hono | 轻量 HTTP 框架 (port 3001)，支持 SSE 流式响应 |
| 前端 | Vite + React + Tailwind CSS 4 | 聊天 UI (port 3000) |
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
│   │   │   ├── index.ts           # 入口（导出 runAgent, analyzeConversation, generateQuestionForm 等）
│   │   │   ├── graph.ts           # 核心状态图逻辑（conversation → classify → plan/estimate/general）
│   │   │   ├── conversation-agent.ts  # 对话分析、Question-Form 生成、上下文压缩
│   │   │   ├── prompts/
│   │   │   │   ├── discovery.ts   # Question-Form 生成系统提示词
│   │   │   │   ├── compress.ts    # 对话压缩系统提示词
│   │   │   │   └── directions.ts  # 方向指引提示词
│   │   │   └── utils/
│   │   │       └── form-parser.ts # Question-Form 解析工具
│   │   ├── dist/                  # 编译产物（不提交到 git）
│   │   ├── tsconfig.json          # composite: true，references shared
│   │   └── package.json           # @repo/agent-runtime
│   │
│   ├── api/                       # Hono HTTP API 服务
│   │   ├── src/
│   │   │   └── index.ts           # 路由定义（SSE 流式 /api/chat，线程管理 API，健康检查）
│   │   ├── dist/
│   │   ├── tsconfig.json
│   │   └── package.json           # @repo/api
│   │
│   ├── web/                       # Vite + React 前端
│   │   ├── src/
│   │   │   ├── main.tsx           # React 入口
│   │   │   ├── App.tsx            # 根组件
│   │   │   ├── types.ts           # 前端类型定义（Message, StreamEvent, TodoItem 等）
│   │   │   ├── styles.css         # Tailwind CSS 入口 + 自定义全局样式
│   │   │   ├── components/
│   │   │   │   ├── ChatApp.tsx    # 聊天主界面（消息列表、输入框、侧边栏）
│   │   │   │   ├── MessageBubble.tsx  # 消息气泡组件
│   │   │   │   ├── Sidebar.tsx    # 侧边栏（会话列表）
│   │   │   │   ├── QuestionForm.tsx   # Question-Form 渲染组件
│   │   │   │   ├── ProseBlock.tsx # Markdown 渲染组件
│   │   │   │   ├── TodoCard.tsx   # 待办事项卡片
│   │   │   │   └── Icon.tsx       # 图标组件
│   │   │   ├── hooks/
│   │   │   │   └── useChat.ts     # 聊天状态管理（消息、加载态、SSE 解析）
│   │   │   └── utils/
│   │   │       ├── markdown.tsx   # Markdown 转 JSX 工具
│   │   │       └── question-form.ts   # Question-Form 解析工具
│   │   ├── index.html             # HTML 入口
│   │   ├── vite.config.ts         # Vite 配置（Tailwind 插件、/api 代理到 :3001）
│   │   ├── eslint.config.mjs      # ESLint 配置（eslint-config-next）
│   │   ├── tsconfig.json          # TS 5.8.3（独立配置，noEmit）
│   │   └── package.json           # web
│   │
│   └── worker/                    # BullMQ Redis 后台任务
│       ├── src/
│       │   └── index.ts           # Queue + Worker 定义（带错误节流、重试策略）
│       ├── dist/
│       ├── tsconfig.json
│       └── package.json           # @repo/worker
│
├── packages/                      # 共享库层（需要先构建才能被 apps 引用）
│   ├── shared/                    # 共享类型、Zod schemas、DTO、事件定义、Agent 类型
│   │   ├── src/
│   │   │   ├── index.ts           # 桶文件
│   │   │   ├── schemas/
│   │   │   │   ├── index.ts
│   │   │   │   └── chat.ts        # ChatMessageSchema, ChatSessionSchema
│   │   │   ├── events/
│   │   │   │   ├── index.ts
│   │   │   │   └── chat.ts        # EventType, ChatEvent 联合类型
│   │   │   ├── dto/
│   │   │   │   ├── index.ts
│   │   │   │   └── chat.ts        # CreateMessageDTO, PaginatedResponseDTO
│   │   │   └── agent/             # Agent 系统类型定义
│   │   │       ├── graph/
│   │   │       │   ├── execution-graph.ts  # 执行图定义
│   │   │       │   ├── task-edge.ts        # 任务边定义
│   │   │       │   └── task-node.ts        # 任务节点定义
│   │   │       ├── runtime/
│   │   │       │   ├── runtime.ts          # 运行时类型
│   │   │       │   ├── scheduler.ts        # 调度器类型
│   │   │       │   └── checkpoint.ts       # 检查点类型
│   │   │       └── state/
│   │   │           ├── workflow-state.ts   # 工作流状态
│   │   │           ├── task-state.ts       # 任务状态
│   │   │           └── task-result.ts      # 任务结果
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
├── references/                    # 参考文档（多智能体系统参考文件）
│   ├── config/
│   │   ├── agent_routing.json     # 模块智能体路由配置（6 模块智能体 + 3 系统智能体）
│   │   └── dependency_dag.json    # 12 模块依赖 DAG 图配置
│   ├── guides/                    # 用户指导文档
│   ├── modules/                   # 12 个产品模块定义（M01-M12）
│   ├── prompts/                   # 智能体提示词
│   │   ├── module_agents/         # 6 个模块智能体提示词
│   │   └── system_agents/         # 3 个系统智能体提示词
│   └── templates/                 # 文档模板
│       └── docs/                  # BRD, MRD, PRD, 用户故事模板
│
├── .env.example                   # 环境变量模板
├── .env                           # 本地环境变量（不提交）
├── .gitignore
├── AGENTS.md                      # AI 编码助手配置说明
├── README.md                      # 项目说明 (English)
├── README-zh.md                   # 项目说明 (中文)
├── package.json                   # 根 package（private, pnpm 11.3.0）
├── pnpm-workspace.yaml            # workspace 定义 + allowBuilds
├── pnpm-lock.yaml
├── tsconfig.base.json              # 共享 TS 基础配置
└── turbo.json                     # Turborepo 任务编排
```

---

## 模块依赖关系

```
apps/web (Vite + React, :3000)
    │
    │  Vite proxy /api → :3001
    │
    └── SSE POST /api/chat ──▶ apps/api (Hono, :3001)
                                    │
                                    ├──▶ packages/shared          (Zod schemas, types, DTO, agent types)
                                    │
                                    └──▶ apps/agent-runtime       (runAgent, streamQuestionForm, etc.)
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
- `apps/web` 使用独立的 TS 5.8.3 配置（Vite 要求），通过 Vite 代理转发 `/api` 请求到 API 服务

---

## 核心模块详解

### 1. apps/agent-runtime — 智能体运行时

**职责**：提供 PM 智能体的核心推理逻辑，基于 LangGraph 状态图实现。

**状态图流程**：
```
START
  │
  ▼
conversation   ←── 对话分析：生成 Question-Form / 处理表单答案 → 压缩上下文
  │
  │  若 phase === "done"（表单已提交）继续，否则 END 等待用户回复
  ▼
classifyIntent   ←── 关键词分类：plan / estimate / general
  │
  ▼
routeByIntent    ←── 条件路由
  │
  ├── "plan"      → generatePlan()     → 返回 5 阶段项目计划模板（含压缩上下文）
  ├── "estimate"  → estimateEffort()   → 返回任务拆解评估表（含压缩上下文）
  └── "general"   → generalResponse()  → 返回帮助信息
  │
  ▼
END
```

**导出接口**：
- `runAgent(messages: ChatMessage[]): Promise<ChatMessage | null>` — 调用状态图，返回智能体响应
- `analyzeConversation(messages: ChatMessage[]): Promise<ConversationResult>` — 分析对话，决定生成 Question-Form 或压缩上下文
- `generateQuestionForm(userMessage: string): Promise<string>` — 生成 Question-Form
- `streamQuestionForm(userMessage: string): AsyncGenerator<string>` — 流式生成 Question-Form
- `compressConversation(messages: ChatMessage[]): Promise<string>` — 压缩对话上下文
- `extractCompressedContext(text: string): string | undefined` — 从压缩结果中提取 `[COMPRESSED]` 块
- `parseQuestionForm(text: string): QuestionFormData | null` — 解析 HTML 格式的 Question-Form
- `hasQuestionForm(text: string): boolean` — 检测是否包含 Question-Form
- `isFormAnswer(text: string): boolean` — 检测用户消息是否为表单答案
- `parseFormAnswers(text: string): Record<string, string> | null` — 解析表单答案 key-value

**LLM 配置**（通过环境变量）：
- `OPENAI_API_KEY` — API 密钥（必填）
- `LLM_MODEL` — 模型名称（默认 `deepseek-chat`）
- `LLM_BASE_URL` — API 基础 URL（默认 `https://api.deepseek.com`）

**已知问题**：
- `graph.ts` 中 LangGraph API 类型推断与 `@langchain/langgraph` 版本不完全兼容，`tsc` 编译会报错；`tsx`（开发模式）不受影响

---

### 2. apps/api — Hono HTTP API

**职责**：对外提供 RESTful API 和 SSE 流式接口，作为前端与智能体之间的桥梁。

**路由表**：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 健康检查，返回 `{ status: "ok" }` |
| `GET` | `/api/health` | 详细健康检查，返回活跃的 Agent 列表 |
| `GET` | `/api/threads` | 获取所有会话列表（按时间倒序） |
| `GET` | `/api/threads/:threadId/messages` | 获取指定会话的消息历史 |
| `POST` | `/api/chat` | SSE 流式接口，接收用户消息，返回流式响应 |

**请求体格式** (`POST /api/chat`)：
```json
{
  "message": "帮我规划前端项目",
  "threadId": "uuid-optional"
}
```

**SSE 事件类型**：
| 事件 | 说明 |
|------|------|
| `start` | 流式响应开始 |
| `text` | 文本内容片段 |
| `question-form-start` | Question-Form 开始生成 |
| `question-form-complete` | Question-Form 生成完成（含完整内容） |
| `error` | 错误信息 |
| `[DONE]` | 流式响应结束 |

**会话管理**：
- 会话存储在内存中（`Map<string, Thread>`）
- 首次消息自动创建会话，标题取自首条消息前 50 字符
- 表单答案自动触发 LangGraph 处理

**中间件**：
- CORS（全局启用）
- SSE 响应头（`text/event-stream`, `no-cache`, `keep-alive`）

---

### 3. apps/web — Vite + React 前端

**职责**：提供用户聊天界面，支持 SSE 流式渲染和 Question-Form 交互。

**核心组件**：
| 组件 | 文件 | 说明 |
|------|------|------|
| `ChatApp` | `ChatApp.tsx` | 聊天主界面，管理消息列表、输入区域、侧边栏 |
| `MessageBubble` | `MessageBubble.tsx` | 消息气泡组件（支持 Markdown 渲染、Question-Form、思考过程展示） |
| `Sidebar` | `Sidebar.tsx` | 侧边栏（会话列表、新建会话、切换会话） |
| `QuestionForm` | `QuestionForm.tsx` | Question-Form 渲染与表单提交 |
| `ProseBlock` | `ProseBlock.tsx` | Markdown 内容渲染组件 |
| `TodoCard` | `TodoCard.tsx` | 待办事项卡片组件 |
| `Icon` | `Icon.tsx` | SVG 图标组件 |

**核心 Hook**：
- `useChat()` — 聊天状态管理：消息列表、SSE 流解析、加载态、错误处理、localStorage 持久化、会话切换

**状态管理**（localStorage 持久化）：
- 消息列表（`Message[]`）保存在 `localStorage` 的 `chat_threads_state` key 下
- 当前 threadId 持久化，刷新页面后恢复
- 支持多会话切换（通过 API `/api/threads` 获取列表）

**Vite 配置**：
- Tailwind CSS v4（通过 `@tailwindcss/vite` 插件）
- React（通过 `@vitejs/plugin-react`）
- `/api` 代理到 `http://localhost:3001`

**样式**：
- Tailwind CSS v4（`@import "tailwindcss"`）
- 自定义全局样式（头像、消息气泡、侧边栏等）

---

### 4. apps/worker — 后台任务 Worker

**职责**：通过 BullMQ 消费 Redis 中的消息队列任务。

**当前状态**：
- 创建了 `Queue("chat")` 和 `Worker("chat")`
- Worker 仅打印接收到的任务数据 `{ content, sessionId }`
- 尚未接入 `runAgent` 或其他实际处理逻辑

**Redis 配置**（通过环境变量）：
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_USERNAME`, `REDIS_DB`, `REDIS_TLS`

**容错机制**：
- 连接重试策略（递增延迟，最大 30 秒）
- 错误日志节流（30 秒内不重复输出）

---

### 5. packages/shared — 共享库

**职责**：提供所有模块间共享的类型定义、校验规则、DTO、事件定义和 Agent 系统类型。

**五个子模块**：

| 子模块 | 文件 | 导出内容 |
|--------|------|----------|
| `schemas/chat.ts` | Zod 校验模式 | `ChatMessageSchema`, `ChatSessionSchema`, `CreateChatMessageSchema` 及推断类型 |
| `events/chat.ts` | 事件类型 | `EventType` 联合类型，`ChatEvent` 可辨识联合（`message.created` / `message.processed` / `agent.thinking` / `agent.completed`） |
| `dto/chat.ts` | 数据传输对象 | `CreateMessageDTO`, `ChatResponseDTO`, `PaginationDTO`, `PaginatedResponseDTO<T>` |
| `agent/graph/` | 执行图类型 | `ExecutionGraph`, `TaskNode`, `TaskEdge` — 任务拓扑结构 |
| `agent/runtime/` | 运行时类型 | `Runtime`, `Scheduler`, `Checkpoint` — 运行时与调度器 |
| `agent/state/` | 状态类型 | `WorkflowState`, `TaskState`, `TaskResult` — 工作流与任务状态 |

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
| `apps/api` | 6.0.3 | no | dist/ | references shared + agent-runtime |
| `apps/worker` | 6.0.3 | no | dist/ | references shared + agent-runtime |
| `apps/web` | 5.8.3 | no | noEmit | Vite 独立配置，**不要升级 TS 版本** |

---

## 环境变量

```bash
# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/meta-pm-agent"

# LLM (agent-runtime)
OPENAI_API_KEY="your-api-key"
LLM_MODEL="deepseek-chat"
LLM_BASE_URL="https://api.deepseek.com"

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
2. **TS 版本差异**：`apps/web` 使用 TS 5.8.3（Vite + React 限制），其余项目使用 6.0.3
3. **LangGraph 类型错误**：`apps/agent-runtime/src/graph.ts` 存在类型推断问题，`tsc` 会报错但不影响 `tsx` 运行
4. **Lint 覆盖不全**：仅 `apps/web` 配置了 ESLint（eslint-config-next），根级别暂无 lint/typecheck 脚本
5. **dist 目录**：所有构建产物在 `.gitignore` 中，不提交到仓库
6. **pnpm 严格隔离**：`packages/database` 需显式声明 `"types": ["node"]` 才能访问 `process.env`
7. **会话存储**：API 服务当前使用内存存储会话和消息，服务重启后数据丢失
8. **web 代理**：前端通过 Vite 代理将 `/api` 请求转发到 `localhost:3001`，无需配置 CORS 策略
