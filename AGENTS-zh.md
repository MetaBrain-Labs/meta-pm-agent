# AGENTS-zh.md

## 角色

作为 `meta-pm-agent` monorepo 的务实型软件工程代理开展工作。修改前先理解现有架构，遵循项目已有模式，并把改动严格限制在用户要求的目标范围内。

## 目标

交付正确、可维护，并能融入当前 pnpm workspace、Turbo 构建图、TypeScript 配置、数据库持久化模型、SSE 协议和应用边界的改动。在本地环境允许的情况下，完成实现和相应验证。

## 重要规则

- 使用根目录 `packageManager` 字段强制指定的 `pnpm` v11.3.0。
- Workspace 范围是 `apps/*` 和 `packages/*`。
- Turbo 负责任务编排。`pnpm build` 会运行 `turbo run build`，并通过 `dependsOn: ["^build"]` 确保先构建 packages，再构建 apps。
- 运行应用开发脚本前必须先构建共享包，因为各包入口指向 `dist/`，而不是 TypeScript 源码。首次执行 `pnpm dev` 前至少运行一次 `pnpm build`。
- 不要提交 `dist/`；生成的构建产物已被 Git 忽略。
- 根目录及 Node.js 应用/包使用 TypeScript 6.0.3。由于 `baseUrl` 已废弃，基础配置中的 `ignoreDeprecations: "6.0"` 必须保留。
- `apps/web` 使用 TypeScript 5.8.3，并拥有独立的 `baseUrl`、`paths` 和 `noEmit: true` 配置。不要升级它的 TypeScript 版本。
- `apps/web` 当前使用 React、Vite 和 Ant Design 6。处理前端时保留 Ant Design 6 的导入方式和组件 API。
- `packages/shared`、`packages/database` 和 `apps/agent-runtime` 使用 TypeScript project references，并启用 `composite: true`。新增可导入共享包时遵循此模式。
- 保留 `packages/database/tsconfig.json` 中的 `"types": ["node"]`，pnpm 严格隔离不会自动暴露 `@types/node`。
- `apps/agent-runtime/src/graph.ts` 历史上存在由 `@langchain/langgraph` 版本不匹配引起的 LangGraph typed-state API 类型问题。分析包级 TypeScript 失败时需要考虑这一点。
- `apps/web` 通过 `eslint-config-next` 配置 ESLint；如果本地缺少 Next 的 compiled parser 包，lint 可能失败。根目录 Turbo 的 lint 和 typecheck 任务当前没有完整生效脚本。

## 应用边界

保持以下包与应用边界：

```text
apps/
  agent-runtime/   基于 LangGraph/DeepAgents 的 PM Runtime（Node.js，composite TypeScript）
  api/             Hono HTTP API 服务（端口 3001，SSE 流式响应，Prisma 持久化）
  web/             Vite + React + Ant Design 6 前端（TypeScript 5.8.3，浅色主题）
  worker/          BullMQ Redis Worker
packages/
  shared/          共享类型、Zod Schema、DTO、Agent 状态/图/运行时类型
  database/        从 dist/ 导出的 Prisma Client 单例
```

- 使用 `.env` 管理本地配置。复制 `.env.example` 并填写 `DATABASE_URL`、Redis 配置、`OPENAI_API_KEY`、`LLM_MODEL` 和 `LLM_BASE_URL`。
- Prisma 命令必须在 `packages/database` 下运行：`pnpm db:generate`、`pnpm db:push` 或 `pnpm db:migrate`。
- 构建 `@repo/database` 前必须执行 `prisma generate`；`pnpm-workspace.yaml` 中的 `allowBuilds` 负责处理安装阶段的该项要求。
- 保持工作区/聊天路由的当前划分：`/workplace`、`/chat/:workspaceId`、`/chat/:workspaceId/:threadId`。
- 标准 Web 环境中的目录选择无法可靠暴露完整绝对路径。保留可编辑路径输入，并在可用时保留宿主环境提供的 `file.path` 处理。
- 除非任务确有需要，不要修改依赖版本、生成文件、无关模块或仓库级配置。

## Web 结构规则

- 保持 `apps/web/src/App.tsx` 作为路由级组合层。它负责串联状态、路由、工作区/聊天流程和弹窗，但不要继续堆积 API 客户端或数据映射逻辑。
- 浏览器侧 API 调用放在 `apps/web/src/api/`。
- 共享 UI 常量和本地偏好 key 放在 `apps/web/src/constants/`。
- DTO 到视图模型的恢复逻辑放在 `apps/web/src/mappers/`。
- 路径解析和 History 辅助函数放在 `apps/web/src/router/`。
- 流事件 reducer、Markdown 工具和结构化块解析器放在 `apps/web/src/utils/`。
- React 视图组件放在 `apps/web/src/components/`，可复用 Hook 放在 `apps/web/src/hooks/`。
- 在继续向 `App.tsx` 增加代码前，优先把逻辑移动到这些职责清晰的模块中。

## 聊天和 Agent 协议

- 保持 `/api/chat` 的 SSE 协议。接口返回 `text/event-stream`，事件类型包括 `start`、`text`、`thinking`、`question-form-start`、`question-form-complete`、`user-input-start`、`user-input-complete`、`request-analysis-start`、`request-analysis-complete`、`todo-update`、`tool-call`、`tool-result`、`step-finish`、`finish` 和 `error`。
- `thinking` 事件可以携带 `agentType`。转发或转换流事件时必须保留该字段。
- Conversation Agent 的流片段使用 `agentType: "conversation"`。
- Request Agent 的流片段使用 `agentType: "request"`。
- 后续新增 Agent 时，需要分配稳定的 `agentType`，并在 runtime 事件、API 持久化和前端渲染中保持一致。
- `apps/agent-runtime` 会在输出用户可见 `text` 前过滤 `No files found in /` 等 DeepAgent/运行环境内部噪声。不要把内部工具或环境噪声重新引入普通助手正文。

## 持久化规则

- API 通过 Prisma/PostgreSQL 持久化账号、工作区、会话、消息和请求表单数据。
- 持久化数据应通过 API 加载：`/api/account`、`/api/workspaces`、`/api/chats`、`/api/chats/:id/messages`。
- 不要把聊天消息历史持久化到浏览器 `localStorage`。浏览器本地存储只能用于非权威 UI 偏好，例如当前工作区 id。
- 用户消息在 Agent 执行前持久化。
- Conversation Agent 的助手输出必须以 `message.type = "conversation"` 持久化。
- Request Agent 的助手输出必须以 `message.type = "request"` 持久化。
- Agent 推理过程必须写入 `message.meta.reasoningContent`。
- Conversation Agent 整理出的结构化用户输入写入 `message.user_input`。
- Request Agent 分析结果必须保留在 request 类型消息正文中，并同步写入 request-form items。
- 修改持久化聊天/工作区协议时，需要同步更新 API schemas、repositories、services、routes/controllers、前端 types，以及历史消息恢复/渲染逻辑。

## 前端展示规则

- 推理过程应展示在它所属的业务阶段附近。
- Conversation Agent 推理展示在普通助手消息处。
- Request Agent 推理展示在“用户输入整理”之后、“Request Agent 分析”之前。
- 后续新增 Agent 时，继续按 `agentType` 放置对应推理过程。
- “用户输入整理”和“Request Agent 分析”卡片默认折叠。
- 新增样式优先使用 Tailwind 工具类。除非明确要求或无法避免，不要创建新的 CSS/SCSS/Less/CSS Module 文件。
- 除非任务明确需要，不要新增全局样式规则或内联 `<style>`。

## 代码注释规则

所有生成的后端代码、前端函数、类、服务、仓储、Hook、Agent、工作流和工具函数都必须包含注释。

- 使用简体中文注释。
- 类、具有业务含义的接口/类型、导出函数、公共方法、React Hook、Service、Repository、Controller、Agent 实现、LangGraph 节点和工作流步骤使用 JSDoc。
- 重要业务逻辑、分支、状态迁移、图转换和复杂计算使用单行注释。
- 注释描述业务意图，而不是重复实现细节。
- 避免 `// 定义变量` 这类无意义注释。

示例：

```ts
/**
 * 获取当前工作区的产品上下文。
 */
export async function getProductContext() {}

// 将需求分析结果交给 Planner Agent。
graph.addEdge("request-agent", "planner-agent");
```

## 工作流程

1. 编辑前阅读相关源码、配置和 package scripts。
2. 检查工作树状态，并保留用户已有的无关改动。
3. 找出符合仓库现有模式的最小完整改动。
4. 协议发生变化时，先更新共享类型或 Schema，再更新使用方。
5. 运行依赖共享包的应用或测试前，先构建所需共享包。
6. 优先执行范围最小但有效的验证，再根据改动风险扩大验证范围。
7. 分析 TypeScript 失败时，考虑 `apps/agent-runtime/src/graph.ts` 的已知类型风险。
8. 最终检查 diff，排除意外改动、生成产物、密钥泄露、依赖漂移和协议回归。

## 输出要求

- 简要说明修改内容及原因。
- 列出已执行的验证命令及其结果。
- 说明未能执行的测试或检查，并给出具体阻塞原因。
- 明确剩余风险、假设、迁移步骤或必要的环境配置。
- 直接引用变更文件，并保持最终回复简洁。
