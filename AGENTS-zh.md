# AGENTS-zh.md

## 角色（Role）

作为 `meta-pm-agent` monorepo 中的务实软件工程 Agent 运行。

在进行任何修改前，需要先理解现有架构，遵循已有模式，并确保修改集中在目标范围内。

---

## 目标（Goal）

交付正确、可维护的代码变更，使其能够与以下系统正确集成：

- pnpm workspace
- Turbo 构建图
- TypeScript 配置
- 数据库持久化模型
- SSE 通信协议
- 应用边界结构

在本地环境允许的情况下，尽可能完成实现与验证。

---

## Agent 行为原则（Agent Operating Principles）

### 1. 明确优先（Clarification First）

- 不得对缺失信息做任何假设（需求 / 架构 / 意图）。
- 如果信息不清晰，必须先提问再实现。
- 在无人值守（autonomous mode）时：
  - 选择最合理解释
  - 继续执行
  - 明确记录所有假设，而不是阻塞流程

---

### 2. 简洁优先（Simplicity Principle）

- 优先选择最简单且正确的解决方案。
- 避免过度抽象与过早工程化。
- 只有在确实需要时才增加扩展性。

---

### 3. 修改范围控制（Scope Protection）

- 不得修改无关代码。
- 如果发现代码异味或设计问题：
  - 必须明确指出
  - 不得自行修复（除非被要求）
  - 可提出后续任务建议

---

### 4. 不确定性处理（Uncertainty Handling）

- 必须显式标注不确定性。
- 若可通过安全的小实验降低不确定性：
  - 执行局部、低风险实验
  - 总结假设与结果
  - 提交给用户确认

- 不允许表现出“虚假的确定性”。

---

### 5. 主动优化建议（Proactive Improvement Suggestions）

- 在合适情况下主动提出更优方案。
- 不仅限于当前任务，也应包含长期改进建议。

---

### 5.1 替代方案规则（新增）

- 如果发现明显更优方案，必须在实现前提出。
- 用 2–4 个要点解释权衡（tradeoff）。
- 如果当前方案仍然合理：
  - 可以继续执行当前方案
  - 除非替代方案可以避免严重风险、浪费或重大返工

---

## 重要规则（Important Rules）

- 使用 `pnpm v11.3.0`（由 packageManager 强制）。
- monorepo 结构：
  - `apps/*`
  - `packages/*`

- 使用 Turbo 进行构建编排：
  - `pnpm build` 等价于 `turbo run build`

- 构建依赖顺序：shared packages → apps
- `dist/` 是构建产物，不可提交到 git
- Node/Root 使用 TypeScript 6.0.3（保留 ignoreDeprecations="6.0"）
- `apps/web` 使用 TypeScript 5.8.3（不可升级）
- React + Vite + Ant Design 6（必须保持 API 兼容）
- `packages/*` 使用 TypeScript project references（composite: true）
- Prisma 必须在 `packages/database` 中执行
- `.env` 包含数据库、Redis、LLM、Tavily 等配置
- web_search 默认可用，但依赖配置
- build 前必须先构建 shared packages
- 不允许随意升级依赖版本

---

## 系统边界（Boundaries）

### 项目结构

- `apps/agent-runtime`：LangGraph / DeepAgents 运行时
- `apps/api`：Hono API + SSE
- `apps/web`：React 前端
- `apps/worker`：BullMQ worker
- `packages/shared`：共享 schema / types
- `packages/database`：Prisma client

---

## Web 结构规则（Frontend Architecture）

### app 结构约束

- `App.tsx` 仅作为应用入口（路由 + provider）
- API 调用必须在 `src/api/`
- UI 常量在 `src/constants/`
- DTO 转换在 `src/mappers/`
- 页面在 `src/pages/`
- 路由工具在 `src/router/`
- 通用工具在 `src/utils/`
- 组件在 `src/components/`

---

## Chat & Agent 协议

- 保持 `/api/chat` SSE 流协议
- 支持事件类型：
  - start / text / thinking / tool-call / tool-result / finish 等

- 必须保持 `agentType` 字段贯穿
- Conversation / Request Agent 分离执行
- Workflow 由 LangGraph 管理（禁止手动串联 agent）
- Product workflow 顺序固定：

  ```
  parse_user_input → request_agent → planner → executor → planner → END
  ```
- Conversation Agent 产出 `user-input-complete` 后，后续 Request Agent、Planner、Executor 必须继续由 LangGraph 主图编排，不要在 Conversation Agent 中直接串联这些 Agent。
- Planner 使用 `apps/agent-runtime/src/agents/common/run-json-agent.ts`；Executor 使用 `apps/agent-runtime/src/agents/common/run-text-agent.ts`。
- Executor 必须通过授权的 `kg_file_*` 结构化工具维护当前工作流的 `ProductKnowledgeGraph`，不要把完整图谱作为最终 JSON 或 markdown 正文直接塞回 message。
- 只允许显式授权、用户可见的工具进入 `tool-call` / `tool-result` SSE。DeepAgents 内置的任务/todo 工具、未授权文件读取等内部工具事件必须过滤，避免在前端出现长期加载卡片或内部文件错误。

---

## 产品知识图谱（Product Knowledge Graph）

- 运行时知识图谱是工作流内共享的结构化 `ProductKnowledgeGraph` 对象，不再依赖工作区 markdown 文件作为主状态。
- Executor Agent 和 Planner Agent 只能通过 `apps/agent-runtime/src/agents/common/knowledge-graph-file-tool.ts` 中的受控结构化工具读写当前图谱，不得直接接入任意文件系统工具。
- 单个 Executor 执行工具时应使用当前图谱的工作副本；Executor 结束后，由 LangGraph 状态通过一次结构化 merge 写回累计图谱，避免节点、关系、决策、风险、开放问题和摘要被重复追加。
- 每个 Executor 完成后，API 必须将累计图谱快照写入 `product_knowledge_graph` 表；这样即使流程中断，已完成 Executor 的图谱结果也不会丢失。
- 产品工作流结束后，最终归档优先使用运行时累计图谱快照，而不是 Planner Review 模型输出的 `knowledge_graph_update`，因为模型汇总可能省略字段或只包含局部结果。
- `product_knowledge_graph` 以 `workspace_id` 唯一约束保证一个工作区只有一份当前图谱，并保留可选 `conversation_id`、`request_form_id` 来源信息。
- `product_knowledge_graph` 应保存生成的 markdown `content` 以及结构化 `summary`、`nodes`、`relations`、`decisions`、`risks`、`open_questions`。
- Executor 的 `knowledge_graph_patch`、完整 `knowledge_graph_markdown` 和大块知识图谱工具结果不要写入 `message` 或 `request_form_item.payload`；这些重内容只应进入 `product_knowledge_graph`，message 中只保留轻量摘要。

---

## 持久化规则（Persistence）

- 聊天、workspace、message 使用 Prisma 持久化
- conversation / request message 分类型存储
- reasoning 必须存入 meta.reasoningContent
- 产品工作流的完整 tagged payload 不应长期保存在 `message.content`；结构化结果落到对应业务表后，message 中保留短摘要即可。
- `message.meta.toolCalls` 中的知识图谱工具结果必须裁剪为可展示摘要，避免重复保存完整图谱。
- request_form 必须跟踪状态流转
- proposal 必须保留来源信息（不能合并丢失）
- 修改持久化协议时，必须同步更新 API schema、repository、service、controller、前端 type、历史消息恢复和渲染逻辑。

---

## 前端展示规则（Frontend Display Rules）

- reasoning 显示在对应 agent 阶段附近
- tool-call 使用 `ToolCallsCard` 折叠卡片展示，并且必须按 `agentType` 放在对应 Agent 阶段附近
- 不要把所有 Executor 的工具调用合并为一个总卡片；每个 Executor Agent 应在自己的推理/进度区域下方显示自己的知识图谱工具卡片
- `web_search` 属于 Conversation Agent；知识图谱文件工具属于 Planner 和十个 Executor Agent
- Executor 输出通过 DAG 展示
- 每个 Executor 结果到达前端后，应重新查询当前工作区知识图谱，让“查看知识图谱”按钮在单个 Executor 完成后即可变为可用。
- UI 默认使用 Tailwind
- 禁止新增全局 CSS

---

## 代码注释规则（Code Comment Rules）

- 后端 & 前端核心逻辑必须加注释
- 使用中文注释
- JSDoc 用于 public API / service / agent / workflow
- 注释强调业务意图，不解释语法

---

## 工作流（Workflow）

1. 阅读相关代码与配置
2. 保持未修改部分不变
3. 找最小修改集
4. 先更新 schema 再更新 consumer
5. 优先 build shared packages
6. 先做最小验证，再扩展验证范围
7. 注意已知 TS 报错
8. review diff 避免污染

---

## 输出要求（Output）

必须包含：

- 修改摘要
- 执行的验证命令及结果
- 未执行测试及原因
- 风险与假设
- 变更文件列表
