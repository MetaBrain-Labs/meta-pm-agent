# meta-pm-agent

[English](README.md) | [简体中文](README-zh.md)

一个 AI 辅助产品管理工作区：把对话转化为结构化需求、可并行执行的任务计划、可持久化产品知识图谱和 PRD 产物。

> 项目仍在积极开发中。运行完整聊天或文档工作流前，请先阅读下方“数据库结构说明”。

## 核心能力

- **意图感知对话**：Pre-Orchestrator 区分普通聊天、新产品、项目演进、澄清和中断工作流恢复。
- **LangGraph 产品工作流**：Request 分析进入 Orchestrator、Planner SubAgent、依赖感知的并行 Executor 和 Critique 质量门禁。
- **十个产品管理领域 Executor**：产品策略、市场研究、GTM、产品发现、产品执行、营销增长、数据分析、AI Shipping、工具箱和界面设计。
- **持久化产品上下文**：维护结构化节点、关系、决策、风险、开放问题、来源、生命周期和补充轮修正。
- **可恢复执行**：PostgreSQL checkpoint、表单 HITL 恢复、已完成任务回放和服务端取消。
- **文档生成**：独立 PRD 工作流，包含章节起草、一致性检查、三评分 Agent、重试、产物预览和 Markdown 下载。
- **实时前端**：展示 SSE reasoning/工具事件、并行 Agent 状态、token 用量、Planner DAG 进度和 G6 知识图谱。
- **受控工具**：集中 allowlist、禁止任意 Agent 文件系统访问、可选 Tavily/公开索引搜索和 Evidence 来源校验。

## 架构

```mermaid
flowchart LR
    U["用户"] --> PO["Pre-Orchestrator"]
    PO --> C["Conversation Agent"]
    C --> R["Request Agent"]
    R --> O["Orchestrator"]
    O --> P["Planner SubAgent"]
    P --> E["并行 Executors"]
    E --> K["产品知识图谱"]
    K --> Q["Critique Agent"]
    K --> D["PRD 文档工作流"]
    Q --> C
```

产品主图使用固定骨架：

```text
parse_user_input
  -> request_agent
  -> orchestrator_agent
  -> planner_agent
  -> executor_router
  -> executor-* -> executor_aggregator -> executor_router
  -> orchestrator_agent (Critique)
  -> END
```

Planner SubAgent 在 Orchestrator 内生成 DAG；图中的 `planner_agent` 节点负责展示或恢复计划。所有 Executor 任务完成后，由 Orchestrator 调用 Critique。PRD 生成和 Question Form HITL 分别使用独立 LangGraph。

模块边界、运行时状态、持久化流程和详细图示见 [STRUCTURE.md](STRUCTURE.md)。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Agent 运行时 | TypeScript、LangGraph、LangChain、DeepAgents |
| API | Hono、Server-Sent Events |
| Web | React 19、Vite 6、Ant Design 6、Tailwind CSS 4、AntV G6 |
| 数据库 | PostgreSQL、Prisma、LangGraph PostgresSaver |
| 搜索 | 配置 Tavily 时使用 Tavily，否则降级到公开索引 |
| Worker | BullMQ、Redis |
| Monorepo | pnpm 11.3.0、Turborepo |

## 快速开始

### 环境要求

- Node.js >=22.13
- pnpm 11.3.0
- PostgreSQL
- 运行 Worker 或 `pnpm dev` 时需要 Redis
- 支持模型使用列表中 DeepSeek 模型 ID 的服务商 API

如尚未启用 pnpm，可使用 Corepack：

```bash
corepack enable
pnpm --version
```

输出的 pnpm 版本应为 `11.3.0`。

### 1. 安装

```bash
git clone https://github.com/MetaBrain-Labs/meta-pm-agent.git
cd meta-pm-agent
pnpm install
```

### 2. 配置

macOS/Linux：

```bash
cp .env.example .env
```

PowerShell：

```powershell
Copy-Item .env.example .env
```

至少填写以下变量：

| 变量 | 用途 |
| --- | --- |
| `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` | PostgreSQL 连接；也支持 `DATABASE_URL` |
| `REDIS_HOST`、`REDIS_PORT` | BullMQ Worker 连接 |
| `OPENAI_API_KEY` | 模型服务密钥 |
| `TAVILY_API_KEY` | 可选 Tavily 搜索；缺省时使用公开索引 |
| `LANGGRAPH_CHECKPOINT_DATABASE_URL` | 可选独立 checkpoint 数据库地址 |

Chat 与 Document 的模型 ID、服务 Base URL、推理参数和计价统一在 Setting 的模型使用列表中配置。

不得提交 `.env` 或 `resources/product-contexts/` 下的运行时产物。

### 3. 初始化数据库

首次安装请使用**空的开发数据库**：

```bash
pnpm --filter @repo/database db:generate
pnpm --filter @repo/database db:init
```

`db:init` 先执行 Prisma `db:push`，再安装受版本管理的模型列表、token 用量、PRD 和上下文快照表。支持 `public` schema；不要对生产数据库直接运行初始化命令。

#### 数据库结构说明

已有数据库先备份，再执行 `pnpm --filter @repo/database db:upgrade`。该命令添加缺失运行时表、缓存 token 列，更新 PRD 等待状态约束和索引，并为历史图谱 `content` 列设置空字符串默认值；不删除业务数据。它不迁移已有库的 Prisma 核心表，核心结构变更需单独审核后执行。可重复执行升级；结构冲突会报错，不自动覆盖。

SQL 位于 `packages/database/sql/20260914_runtime_tables.sql`。LangGraph checkpoint 表由 PostgresSaver 独立初始化。

### 4. 构建

```bash
pnpm build
```

共享包从 `dist/` 导出，因此开始应用开发前至少需要完整构建一次。

### 5. 运行

启动全部服务：

```bash
pnpm dev
```

也可以分别启动：

| 服务 | 地址 | 命令 |
| --- | --- | --- |
| Web | <http://localhost:3000> | `pnpm --filter web dev` |
| API | <http://localhost:3001> | `pnpm --filter @repo/api dev` |
| Worker | 连接 Redis | `pnpm --filter @repo/worker dev` |

Vite 会把 `/api` 代理到 `3001` 端口。

## 配置说明

- 产品上下文从所选工作区的概述文档、`resources/product-contexts/`、可选 context-snapshot 表和持久化工作区图谱恢复。
- Conversation Agent 仅在用户启用时获得 `web_search`；需要外部证据的 Executor 由 runtime 策略注入搜索。
- 配置 `TAVILY_API_KEY` 时使用 Tavily；未配置时使用支持的公开索引，并以结构化错误返回搜索失败，不中断 SSE。
- `LANGGRAPH_CHECKPOINT_DATABASE_URL` 可为工作流 checkpoint 覆盖 `DATABASE_URL`；两者均不可用时降级为内存 checkpoint。
- Agent 运行摘要是调试产物，由 `.env.example` 中的 `AGENT_SUMMARY_*` 变量控制。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/account` | 读取本地/默认账号 |
| `GET/POST` | `/api/workspaces` | 查询或创建工作区 |
| `GET/POST` | `/api/chats` | 查询或创建聊天 |
| `GET` | `/api/chats/:id/messages` | 恢复消息和工作流状态 |
| `POST` | `/api/chat` | 通过 SSE 运行聊天/产品工作流 |
| `POST` | `/api/chat/stop` | 中止服务端聊天 runtime |
| `GET` | `/api/workspaces/:workspaceId/knowledge-graph` | 读取当前知识图谱 |
| `POST` | `/api/workspaces/:workspaceId/document-generation` | 启动文档任务 |
| `GET` | `/api/workspaces/:workspaceId/document-generation/latest` | 读取最新任务/产物 |
| `GET` | `/api/document-generation/:runId` | 读取指定文档任务 |
| `POST` | `/api/document-generation/:runId/stop` | 停止文档任务 |

`POST /api/chat` 先发送 `start`，随后流式发送 Agent、工具、表单和 token 等类型化事件，最后以 `data: [DONE]` 结束。前端必须先调用 `/api/chat/stop`，再 abort fetch，才能让模型请求收到服务端 `AbortSignal`。

## 仓库结构

```text
apps/
  agent-runtime/  LangGraph/DeepAgents 运行时与测试
  api/            Hono API、SSE、持久化、文档任务
  web/            React/Vite 前端
  worker/         BullMQ Worker 骨架
packages/
  shared/         Zod schema、DTO、事件、运行时契约
  database/       Prisma schema 与 Client
references/
  executor/       Executor profile、prompt 与 skill
resources/
  product-contexts/  生成的运行时快照
```

仓库工程规则见 [AGENTS.md](AGENTS.md)，中文版本见 [AGENTS-zh.md](AGENTS-zh.md)。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `pnpm build` | 通过 Turbo 构建全部包和应用 |
| `pnpm dev` | 启动全部开发服务 |
| `pnpm --filter @repo/agent-runtime test` | 运行 Agent Runtime 测试 |
| `pnpm --filter @repo/api test` | 运行 API 测试 |
| `pnpm --filter web build` | 类型检查并构建前端 |
| `pnpm --filter @repo/database db:generate` | 生成 Prisma Client |
| `pnpm --filter @repo/database db:push` | 把 Prisma schema 同步到数据库 |
| `pnpm --filter @repo/database db:migrate` | 创建/执行开发 migration |

根目录 Turbo `lint`/`typecheck` 目前覆盖有限；请使用上表中的定向测试和构建。

## 构建问题与解决方案

本节整理自仓库原有的 `SOLUTIONS.md` 构建说明。

### 常见现象

首次构建、恢复 Turbo 缓存或只清理了部分构建产物后，可能出现：

- `TS2307: Cannot find module '@repo/shared'` 或 `@repo/database`；
- `TS7006`、`TS2339`、`TS2322`、`TS2345`、`TS18046`、`TS18047`、`TS6305`；
- `tsc` 成功退出，但没有生成 `dist/`；
- Turbo 提示 `no output files found`；
- 下游 API 代码中的 Prisma 类型退化成 `any`。

### 快速恢复

先重新生成 Prisma Client：

```bash
pnpm --filter @repo/database db:generate
```

然后只删除仓库内的 TypeScript 构建 metadata。

macOS/Linux：

```bash
find apps packages -path '*/node_modules' -prune -o -name tsconfig.tsbuildinfo -type f -delete
```

PowerShell：

```powershell
Get-ChildItem apps,packages -Recurse -File -Filter tsconfig.tsbuildinfo |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
  Remove-Item -Force
```

最后强制完整构建：

```bash
pnpm build --force
```

### 原因

1. **过期 `tsconfig.tsbuildinfo`** 可能仍把项目标记为最新，即使被忽略的 `dist/` 已不存在。Turbo 随后可能回放 cache hit，而 TypeScript 不产生输出。
2. **未生成 Prisma Client** 会导致 `.prisma/client` 声明缺失；在 `skipLibCheck: true` 下，问题可能延迟表现为 `any`、implicit-`any` 或看似无关的 repository 报错。
3. **消费者报错通常只是下游症状**。修改 API 类型前，先检查 `packages/shared/dist`、`packages/database/dist` 和 Prisma 生成声明。

### 数据库命令安全性

| 命令 | 作用 | 是否修改数据库数据/结构 |
| --- | --- | --- |
| `pnpm --filter @repo/database db:generate` | 根据 `schema.prisma` 生成 Prisma Client | 否 |
| `pnpm --filter @repo/database db:push` | 直接同步 schema | 是 |
| `pnpm --filter @repo/database db:migrate` | 创建/执行开发 migration | 是 |

若问题仍存在，请确认 `packages/shared/dist/index.d.ts`、`packages/database/dist/index.d.ts` 和 Prisma Client 生成文件存在，然后从第一条上游错误排查，不要先修复后续级联报错。

## 参与贡献

提交 Pull Request 前：

1. 阅读 [AGENTS.md](AGENTS.md) 和 [STRUCTURE.md](STRUCTURE.md)。
2. 所有面向 LLM 的 prompt 和 schema 指令文本必须使用英文。
3. 保持 package、SSE、持久化和 Agent 边界。
4. 先运行最小相关测试；涉及跨包契约时再运行 `pnpm build`。
5. 不得提交 `dist/`、`.env`、运行时快照或 Agent 摘要。

## 首次模型配置与本地运行边界

这是单用户本地预览版，使用固定本地账号，尚无多人认证和数据隔离。API 默认仅监听 `127.0.0.1:3001`；`HOST` 只接受回环地址，`CORS_ORIGINS` 只接受明确的本地 HTTP/HTTPS origin。前端使用 `http://localhost:3000` 或 `http://127.0.0.1:3000`；Vite 切换端口时同步修改配置。跨域限制不替代认证。

1. 在服务端 `.env` 中填写你自己的模型 API Key，重启 API；不要在浏览器输入或提交密钥。
2. 打开 Setting 的模型使用列表。当前 UI 只支持代码中列出的 DeepSeek 模型 ID，并非任意 OpenAI-compatible 模型选择器。
3. 新建自定义列表，选择通用或分类模式，检查 Chat 与 Document 的模型、Base URL、推理参数及计价；在聊天模型选择器中选用该列表。
4. 使用合成需求验证一次流程；确认服务商支持选定 ID。显示的价格是配置快照，模型费用由你承担，多 Agent 与 PRD 评分会产生多次调用。

模型服务会收到对话和相关产品上下文；搜索服务会收到查询文本。默认关闭的 LangSmith tracing 启用后可能上传 prompt、输出与执行记录。调试摘要及本地崩溃报告可能包含产品信息，分享前脱敏。首次发布移除了许可未确定的本地 tokenizer 资产，缺失用量不再通过该资产校正；以服务商用量和账单为准。

## 开源许可与发布资料

项目原创部分采用 [Apache License 2.0](LICENSE)，第三方内容保留原许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

- [贡献指南](CONTRIBUTING.md) 与 [安全报告](SECURITY.md)
- [完整合成示例](examples/local-preview.md) 与 [界面截图说明](assets/screenshots/README.md)
- [已知限制](KNOWN_LIMITATIONS.md)、[预览版发布说明](RELEASE_NOTES.md) 与 [发布检查表](RELEASE_CHECKLIST.md)
