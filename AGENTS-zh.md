# AGENTS-zh.md

## Role

作为 `meta-pm-agent` monorepo 的务实型软件工程代理开展工作。修改前先理解现有架构，遵循项目已有模式，并将改动严格限定在用户要求的目标范围内。

## Goal

交付正确、可维护，并能融入当前 pnpm workspace、Turbo 构建图、TypeScript 配置和应用边界的改动。在本地环境允许的情况下，完成实现和相应验证。

## Importants

- 使用根目录 `packageManager` 字段强制指定的 `pnpm` v11.3.0。
- Workspace 范围是 `apps/*` 和 `packages/*`。
- Turbo 负责任务编排。`pnpm build` 会运行 `turbo run build`，并通过 `dependsOn: ["^build"]` 确保先构建 packages，再构建 apps。
- 运行应用开发脚本前必须先构建共享包，因为各包入口指向 `dist/`，而不是 TypeScript 源码。首次执行 `pnpm dev` 前至少运行一次 `pnpm build`。
- 不要提交 `dist/`；生成的构建产物已被 Git 忽略。
- 根目录及 Node.js 应用/包使用 TypeScript 6.0.3。由于 `baseUrl` 已废弃，基础配置中的 `ignoreDeprecations: "6.0"` 必须保留。
- `apps/web` 使用 TypeScript 5.8.3，并拥有独立的 `baseUrl`、`paths` 和 `noEmit: true` 配置。不要升级它的 TypeScript 版本。
- `packages/shared`、`packages/database` 和 `apps/agent-runtime` 使用 TypeScript project references，并启用 `composite: true`。新增可导入共享包时遵循此模式。
- 保留 `packages/database/tsconfig.json` 中的 `"types": ["node"]`；pnpm 严格隔离不会自动暴露 `@types/node`。
- `apps/agent-runtime/src/graph.ts` 历史上存在由 `@langchain/langgraph` 版本不匹配引起的 LangGraph typed-state API 类型问题。分析包级 TypeScript 失败时需要考虑这一点。
- `apps/web` 通过 `eslint-config-next` 配置 ESLint；如果本地缺少 Next 的 compiled parser 包，lint 可能失败。根目录 Turbo 的 lint 和 typecheck 任务当前没有完整生效脚本。

## Constraint

- 保持以下包与应用边界：

```text
apps/
  agent-runtime/   基于 LangGraph/DeepAgents 的 PM Agent（Node.js，composite TypeScript）
  api/             Hono HTTP API 服务（端口 3001，SSE 流式响应，Prisma 持久化）
  web/             Vite + React + Ant Design 5 前端（TypeScript 5.8.3，浅色主题）
  worker/          BullMQ Redis Worker
packages/
  shared/          共享类型、Zod Schema、DTO、Agent 状态/图/运行时类型
  database/        从 dist/ 导出的 Prisma Client 单例
```

- 使用 `.env` 管理本地配置。复制 `.env.example` 并填写：
  - PostgreSQL/Prisma：`DATABASE_URL`
  - Redis/BullMQ：`REDIS_HOST`、`REDIS_PORT` 及相关配置
  - LLM Runtime：`OPENAI_API_KEY`、`LLM_MODEL`、`LLM_BASE_URL`
- Prisma 命令必须在 `packages/database` 下运行：`pnpm db:generate`、`pnpm db:push` 或 `pnpm db:migrate`。
- 构建 `@repo/database` 前必须执行 `prisma generate`；`pnpm-workspace.yaml` 中的 `allowBuilds` 负责处理安装阶段的该项要求。
- 保持 `/api/chat` 的 SSE 协议不变。接口返回 `text/event-stream`，事件类型包括 `start`、`text`、`thinking`、`question-form-start`、`question-form-complete`、`user-input-start`、`user-input-complete`、`todo-update`、`tool-call`、`tool-result`、`step-finish`、`finish` 和 `error` 等。
- 保持工作区/聊天路由的当前划分：`/workplace` 是工作区首页，`/chat/:workspaceId` 是工作区详情页，`/chat/:workspaceId/:threadId` 是具体对话页。
- API 通过 Prisma/PostgreSQL 持久化账号、工作区、会话、消息和请求表单数据。前端可以使用 localStorage 做响应式缓存，但持久化数据应通过 API 加载（`/api/account`、`/api/workspaces`、`/api/chats`、`/api/chats/:id/messages`）。
- 修改持久化聊天/工作区协议时，需要同步更新 API schemas、repositories、services、routes 和前端 types。
- 标准 Web 环境中的目录选择无法可靠暴露完整绝对路径。保留可编辑路径输入，并在可用时保留宿主环境提供的 `file.path` 处理。
- `apps/agent-runtime` 会在输出用户可见 `text` 前过滤 `No files found in /` 等 DeepAgent/运行环境内部噪声。不要把内部工具或环境噪声重新引入普通助手正文。
- 除非任务确有需要，不要修改依赖版本、生成文件、无关模块或仓库级配置。

## Workflow

1. 编辑前阅读相关源码、配置和 package scripts。
2. 检查工作区状态，并保留用户已有的无关改动。
3. 找出符合仓库现有模式的最小完整改动。
4. 协议发生变化时，先更新共享类型或 Schema，再更新使用方。
5. 运行依赖共享包的应用或测试前，先构建所需共享包。
6. 优先执行范围最小但有效的验证，再根据改动风险扩大验证范围。
7. 分析 TypeScript 失败时，考虑 `apps/agent-runtime/src/graph.ts` 的已知类型风险。
8. 最终检查 diff，排除意外改动、生成产物、密钥泄露和协议回归。

## Output

- 简要说明修改内容及原因。
- 列出已执行的验证命令及其结果。
- 说明未能执行的测试或检查，并给出具体阻塞原因。
- 明确剩余风险、假设、迁移步骤或必要的环境配置。
- 直接引用变更文件，并保持最终回复简洁。
