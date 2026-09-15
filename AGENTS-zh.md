# AGENTS-zh.md

## 职责与目标

作为 `meta-pm-agent` monorepo 的务实软件工程 Agent：修改前理解真实调用链，遵循现有模式，控制变更范围，并在环境允许时完成实现与适度验证。

## 行为原则

- 不虚构缺失需求或架构。歧义会实质改变结果时先提问；无人值守时采用最安全、合理的解释并记录假设。
- 选择最简单且正确的方案，优先复用已有代码、标准库和平台能力，避免预设抽象与依赖变更。
- 不修改无关代码；发现邻近问题时说明，但未经要求不顺手修复。
- 明示不确定性。若小型低风险实验可快速验证，则执行并报告假设与结果。
- 若替代方案能明显避免严重风险或返工，先说明权衡；否则继续完成用户要求的合理方案。

## 仓库不变量

- 使用 pnpm `11.3.0`；workspace 为 `apps/*`、`packages/*`。
- Turbo 管理构建图；`pnpm build` 通过 `dependsOn: ["^build"]` 先构建依赖。
- `@repo/shared`、`@repo/database` 从 `dist/` 导出。应用开发前先生成 Prisma Client 并构建共享包；不得提交 `dist/` 或 `tsconfig.tsbuildinfo`。
- 根目录与 Node 包使用 TypeScript `6.0.3`，保留 `ignoreDeprecations: "6.0"`；`apps/web` 固定 TypeScript `5.8.3`，保留独立 `baseUrl`、paths 和 `noEmit`。
- 保持 `packages/shared`、`packages/database`、`apps/agent-runtime` 的 project references 与 `composite: true`；保留 `packages/database/tsconfig.json` 的 `"types": ["node"]`。
- `apps/web` 使用 React 19、Vite 6、Tailwind 4、Ant Design 6；保持 Ant Design 6 API 与导入方式。
- Prisma 命令从 `packages/database` 执行：`pnpm db:generate`、`pnpm db:push`、`pnpm db:migrate`。
- 从 `.env.example` 创建 `.env`。PostgreSQL 可用 `POSTGRES_*` 或 `DATABASE_URL`；配置 `OPENAI_API_KEY`、`LLM_MODEL`、`LLM_BASE_URL`。配置 `TAVILY_API_KEY` 时使用 Tavily，否则搜索降级到公开索引。只有显式开发实验性 Worker 时才需要 Redis。
- 保持 `/workplace`、`/chat/:workspaceId`、`/chat/:workspaceId/:threadId`、`/documents/:workspaceId` 路由。
- 浏览器目录选择不保证提供绝对路径；保留可编辑路径和宿主环境 `file.path` 处理。
- 除任务必要外，不改依赖版本、生成文件、无关模块或仓库级配置。
- Web ESLint 可能因 Next 编译 parser 缺失失败；根 Turbo `lint`/`typecheck` 当前没有实质共享任务。必须如实说明验证边界。

## 应用边界

```text
apps/
  agent-runtime/  LangGraph/DeepAgents 运行时与测试
  api/            Hono API、SSE、持久化、后台文档任务
  web/            Vite/React/Ant Design 前端
  worker/         BullMQ/Redis worker 骨架
packages/
  shared/         Zod schema、DTO、事件和运行时契约
  database/       Prisma client 与 schema
references/       Executor profile、prompt 与 skill
resources/        运行时产品上下文快照；不得提交生成 JSON
```

共享契约放在 `packages/shared`；数据库访问放在 `packages/database` 或 API repository；编排放在 `apps/agent-runtime`；HTTP 与持久化协调放在 `apps/api`；浏览器行为放在 `apps/web`。

## LLM 语言规则

所有面向模型的指令文本必须使用英文，包括 system/Agent prompt、路由/规划/执行指令、工具名称与描述、`parameters.description`、模型消费的 schema metadata。

用户界面和最终回复可本地化；内部注释可用中文，除非会拼接进 prompt。产品契约中的固定本地化字面量可保留，但其周围指令、工具/schema 描述和校验说明必须使用英文。违反本规则应视为 prompt 校验错误。

## Web 结构

- `apps/web/src/App.tsx` 只负责 Provider 和页面组合；顶层状态/导航放在 `hooks/useAppShell.ts`。不得把页面 JSX、API client 或 SSE reader 堆回 `App.tsx`。
- 浏览器 API 放 `src/api/`，共享常量放 `src/constants/`，DTO 恢复放 `src/mappers/`，路由页放 `src/pages/`，路径/history 放 `src/router/`，复用 hook 放 `src/hooks/`，流、Markdown、表单工具放 `src/utils/`。
- 通用组件放 `src/components/`，复用弹窗壳放 `src/components/modals/`，页面编排留在页面目录。
- 助手 Markdown 统一由 `src/utils/markdown.tsx` 使用 `react-markdown` + `remark-gfm` 渲染；保留表格、链接、列表、代码、强调和引用，不得使用 `dangerouslySetInnerHTML`。
- `KnowledgeGraphView.tsx` 是聊天弹窗和文档页共享的 G6 数据转换与生命周期实现；筛选、详情和操作由调用方负责。

## Chat 与 Agent 契约

### 运行拓扑

- Pre-Orchestrator 在产品主图外运行，由 Orchestrator 的 `pre-orchestrator` SubAgent 实现，在 Conversation Agent 路由前处理意图分类、澄清/冲突表单和中断恢复识别。
- Conversation Agent 负责用户对话与结构化 `<user-input>`。发出 `user-input-complete` 后必须进入 `apps/agent-runtime/src/graph/workflow.ts`，不得从 Conversation Agent 手工串联后续 Agent。
- 产品主图为：

  ```text
  parse_user_input
    -> request_agent
    -> orchestrator_agent
    -> planner_agent（计划展示/恢复兼容节点）
    -> executor_router
    -> executor-*（依赖允许时并行）
    -> executor_aggregator
    -> executor_router
    -> orchestrator_agent（Critique）
    -> END
  ```

- Orchestrator 负责路由、上下文来源、生命周期、Planner SubAgent 委派和最终 Critique 调度。Planner SubAgent 在 Orchestrator 内生成 DAG；图中的 `planner_agent` 只展示/回放计划及恢复的 Executor 结果。所有 DAG 任务结束后由 `orchestrator_agent` 调用 Critique；Critique 不是独立图节点。
- 新产品阶段应增加图节点/边，不得在单个 Agent 中临时串联。`product-workflow/agent.ts` 只保留格式化和导出。
- DeepAgent 公共执行入口是 `agents/common/run-agent.ts`。Agent 模块传入 prompt、schema/resolver、工具、SubAgent、模型选项和确定性 fallback，不得另造 runner。
- 稳定产品 Agent 类型包括 `orchestrator`、`planner`、`critique` 和十个 Executor；`agentType` 必须贯穿运行时事件、API 持久化和前端渲染。

### 规划、执行与恢复

- `TaskExecutionPlan.status` 首轮为 `"initial"`，表单回答后的修正/补充轮为 `"supplement"`。
- 十个 Executor 领域为产品策略、市场研究、GTM、产品发现、产品执行、营销增长、数据分析、AI Shipping、工具箱和界面设计。定义位于 `executor-agent/definitions.ts`；领域 skill 位于 `references/executor/<domain>/skills/<skill>/SKILL.md`，通过 DeepAgents `skills` 传入。
- Executor 使用图谱工作副本，通过受控 `kg_file_*` 工具写入并返回结构化结果；结果只经 LangGraph state 合并一次，不得重复工具副作用。
- 重试/恢复时保持已完成 Executor 结果。重跑任务必须同时使其下游依赖失效，不受影响的结果继续显示完成。
- 手动停止与继续必须基于 checkpoint。使用稳定线程 `workflow:{conversationId}:{requestFormId}`；配置可用时使用 `PostgresSaver`，仅在持久存储不可用时降级 `MemorySaver`。
- 确认/proposal 表单回答必须通过 `conversation/workflow-resume.ts` 恢复 Request 分析、Orchestrator 决策、DAG、Executor 结果、Critique 问题和图谱；它不是新请求，Planner SubAgent 只生成必要的 supplement DAG。
- 合并重复用户问题时，保留全部来源 task、Agent 和 OpenQuestion ID；一次回答可关闭所有引用来源。
- 用户可见错误只说明 blocker、受影响 Agent/task 和下一步；不得输出 provider stack、大段 JSON 或重复重试细节。

### 知识图谱与工具

- 运行时状态是结构化 `ProductKnowledgeGraph`。Executor 只能创建其 definition 授权的实体/关系类型，并保留 task/source provenance。
- 受控工具实现在 `common/knowledge-graph-file-tool.ts`；历史文件名不代表文件访问，这些工具只修改当前内存图谱。
- 工具授权集中在 `common/tool-access.ts`。Conversation 可获得用户启用的 `web_search`；Executor 的图谱工具由 runtime 注入。市场研究、GTM、营销增长、数据分析、AI Shipping、工具箱、界面设计 Executor 还会获得 runtime 管理的 `web_search`。
- Planner SubAgent 只接收精简图谱上下文，不获得任意图谱/文件工具。Harness profile 与 allowlist middleware 必须继续排除 DeepAgents 默认文件系统工具。
- Document Agent 是允许使用内置 `write_todos`、`task` 的明确例外；其他 DeepAgents 内部 helper 不得进入普通 SSE 或持久化。
- 外部搜索失败返回 `{ results: [], error }`，不能抛错中止 SSE。搜索生成的 Evidence 必须引用已验证结果，用户输入和既有图谱来源必须可追溯。
- 授权的 `tool-call`/`tool-result` 必须保留 `agentType`；内部 helper、非授权读取、图谱 patch 和完整图谱 payload 不得进入用户 SSE 或 message 持久化。

### SSE 与停止

- 保持 `POST /api/chat` 为 `text/event-stream`：先发送 `start`，随后发送 `agent-status`、`text`、`thinking`、问题/用户输入/Request 分析/workflow resume 生命周期、`human-interrupt`、SubAgent、工具、token、`conversation-title`、`abort`、`error` 等事件，最后发送 `data: [DONE]`。
- runtime 的 `reasoning` 在 API 层映射为 `thinking`；转发时保留 `agentType`、`parallelAgents`、tool call ID 和 SubAgent 标识。
- `agent-status` 是 active Agent 权威来源；`user-input-complete` 后先移除 `conversation`，再展示后续 Agent。
- 前端停止必须先调用 `/api/chat/stop`，再 abort 浏览器 fetch，确保服务端把 `AbortSignal` 传给模型请求。

## 文档与 HITL 工作流

- Document Agent 及其 LangGraph 与聊天/产品图独立。实现与 prompt 位于 `agents/document-agent/`，编排位于 `graph/document-workflow.ts`。
- 当前 PRD 流程：

  ```text
  parseKg -> normalizeGraph -> buildSectionDossiers -> draftSection
    -> crossCheck -> scoreDraft -> rejectScore|aggregateScore
    -> draftSection|humanReview -> exportPrd
  ```

- 当前只启用 PRD；MRD/BRD 在拥有独立工作流前不渲染入口。
- 每版草稿由三个独立评分 Agent 评分：分差大于 `8` 则拒绝，可靠草稿还需达到 `85/100`；最多三版。必须保留所有草稿与评分历史，重试耗尽后沿用现有“最小分差/加权”选择逻辑。
- `humanReview` 当前自动通过；未真正接入 `interrupt()` 前不得宣称等待人工审核。
- 文档任务在 API 后台运行，页面跳转不得取消；只有停止接口或服务端/运行时失败可中断。
- `human-in-the-loop.ts` 的独立轻量 HITL 图只负责 Question Form 的 `interrupt()`/resume，不属于产品图或文档图。

## 持久化

- Prisma/PostgreSQL 是用户、工作区、会话、消息、请求表单/条目、任务/执行、token 用量和当前工作区图谱的权威来源。
- 部分 repository 使用 Prisma schema 未建模的 raw SQL 表，包括 `token_usage`、文档 run/artifact 和可选 `product_context_snapshot`。使用相关功能前必须确认表已创建，不能假设 `db:push` 会创建。
- Agent 执行前先保存用户消息。Conversation 输出使用 `message.type = "conversation"`，Request 输出使用 `"request"`；reasoning 存 `message.meta.reasoningContent`，结构化用户输入存 `message.user_input`，Request 分析写入 message/request-form。
- 禁止用浏览器 `localStorage` 保存聊天历史；历史从 API 恢复。localStorage 仅用于非权威 UI 偏好。
- 每个 workspace 只保留一行 `product_knowledge_graph`，可记录 conversation/request-form 来源。数据库图谱事实只保存结构化 `nodes`、`relations`；decision、risk、open question 规范化成 node。运行时 summary/生命周期放 resources 快照和可选 context-snapshot 表，不得新增旧式图谱列。
- 每个 Executor 完成后归档累计图谱但不增加 `version`；正常完成或手动停止时本轮最多递增一次。最终归档优先使用最新 runtime 快照，不使用 Critique 文案或模型摘要覆盖。
- `resources/product-contexts/` 下生成的 JSON 是运行时状态，不得提交，也不得作为 Agent 文件系统工具暴露。
- Executor patch、完整图谱 Markdown、大型工具结果和完整 workflow block 不得进入 message/request-form；其中只保留展示元数据，重数据进入图谱存储。
- 文档 run 保存 Task planning、reasoning、评分、错误和状态；artifact 单独保存完整 Markdown/结构化内容，不写入聊天历史。
- 保持 request-form 状态：`received`、`conversation_consumed`、`request_agent_running`、`request_analyzed`、`workflow_running`、`pending_user_confirmation`、`completed`、`stopped`、`failed`。表单决策必须完成所有被引用 proposal 条目并保存答案 metadata。
- 修改持久化契约时，必须同步 shared schema/type、API repository/service/controller、前端类型、恢复和渲染。

## 前端展示

- 保持阶段顺序：Conversation reasoning/工具、可见文本/表单、用户输入整理、Request reasoning/工具、Request 分析、Orchestrator/Planner DAG、各 Executor reasoning/工具/结果、Critique，最后确认或完成；Executor 提交后显示图谱已更新状态。
- reasoning 和工具卡必须靠近所属 Agent。Orchestrator/Planner/Executor/Critique 进度通过 Planner DAG 区域展示；每个 Executor 保留独立折叠 `ToolCallsCard`。
- 恢复 supplement DAG 时保持已完成节点，仅让新增、失败或失效任务进入运行态。
- 右上角可同时显示并行 Executor；每个标签必须跳到可见 reasoning/loading 位置，跳转前关闭自动贴底。
- 每个 Executor 结果到达后刷新图谱可用性，不等待整轮结束。
- `UserInputCard`、`RequestAnalysisCard`、工具详情默认折叠。
- 图谱弹窗需正确处理零尺寸初始化与关闭后重开；弹窗和文档页都复用 `KnowledgeGraphView`，包括密集图标签降噪。
- 仅进入 `/documents/:workspaceId` 时加载图谱/文档数据；展示 loading，节点点击更新右侧详情，完整 PRD 只通过弹窗/下载提供，不内嵌正文。
- 新样式优先 Tailwind。除非任务明确要求，不新增 CSS/SCSS/Less/CSS Module、全局规则或内联 `<style>`。

## 文件与代码注释

每个 `.ts`、`.tsx` 文件必须以 JSDoc 文件头开头并说明职责与边界。生成的函数、业务类型、类、service、repository、controller、hook、Agent、图节点和工作流步骤使用简体中文 JSDoc；关键分支和状态转换使用简短中文注释。注释解释业务意图，不解释语法；面向模型的 prompt 内不得出现中文说明。

```ts
/**
 * <模块名称 / 文件职责简述>
 *
 * <详细职责说明>
 *
 * Responsibilities:
 * - <职责>
 *
 * Notes:
 * - <边界说明>
 */
```

## 工作与交付

1. 阅读相关源码、配置、脚本以及被修改代码的全部调用方。
2. 检查工作树并保留用户的无关改动。
3. 选择最小完整修改集；先更新共享契约，再更新消费者。
4. 先运行最小有效检查，再按风险扩大；应用验证前先构建共享包。
5. 审查 diff，排除误改、secret、生成物、依赖漂移、prompt 语言和契约回归。

交付时简要说明：修改及原因、验证命令与结果、未运行检查及 blocker、剩余假设/风险/环境步骤、变更文件链接。
