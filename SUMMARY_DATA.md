# 前端数据契约汇总

> 面向前端开发人员的后端 / Agent Runtime 数据手册  
> 契约快照：2026-07-23  
> API 基础路径：`/api`  
> 时间字段：ISO 8601 字符串，例如 `2026-07-23T08:30:00.000Z`

---

## 1. 阅读导航

| 你要实现的功能 | 优先阅读 |
| --- | --- |
| 工作区和会话侧边栏 | [3. 基础与工作区接口](#3-基础与工作区接口)、[4. 会话接口](#4-会话接口) |
| 聊天实时流 | [6. 聊天 SSE 协议](#6-聊天-sse-协议) |
| 刷新后恢复历史消息 | [5. 历史消息](#5-历史消息) |
| Question Form / 人工确认 | [7. Question Form 与 HITL](#7-question-form-与-hitl) |
| Planner DAG / Executor 卡片 | [8. 产品工作流结构化数据](#8-产品工作流结构化数据) |
| 知识图谱 | [9. 产品知识图谱](#9-产品知识图谱) |
| PRD 生成页 | [10. 文档生成接口](#10-文档生成接口) |
| 错误处理和兼容性 | [11. 错误响应](#11-错误响应)、[12. 前端实现注意事项](#12-前端实现注意事项) |

### 1.1 数据通道总览

| 通道 | 用途 | 前端接收方式 |
| --- | --- | --- |
| REST JSON | 账号、工作区、会话、历史消息、知识图谱 | 普通 `fetch()` |
| Chat SSE | 聊天文本、推理、Agent 状态、工具、表单、Token 用量 | `fetch()` + `ReadableStream` |
| 文档状态轮询 | PRD 后台任务状态、思考、评分和产物 | 定时调用 REST |

> **重要：**文档生成不使用聊天 SSE。页面跳转不会取消文档任务，前端应通过状态接口轮询。

---

## 2. 通用约定

### 2.1 字段标记

| 标记 | 含义 |
| --- | --- |
| 必填 | 正常成功响应中始终存在 |
| 可选 | 字段可能完全不返回 |
| 可空 | 字段存在，但值可能为 `null` |

### 2.2 常用标识符

| 字段 | 类型 | 作用 | 示例 |
| --- | --- | --- | --- |
| `workspaceId` | UUID | 工作区主键 | `"71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a"` |
| `chatId` / `conversationId` | UUID | 会话主键；两种名称指向同一业务对象 | `"e24ec116-64c1-442c-bde2-d7798a6573df"` |
| `requestFormId` | UUID | 当前会话的需求表单上下文 | `"01f94a0b-6903-46f4-a8a6-11bcfb817469"` |
| `messageId` | UUID | 持久化消息主键 | `"96caf793-f829-4c09-a334-ceca01c541ed"` |
| `runId` | UUID | 文档生成任务主键 | `"cfdb69ce-e312-46e3-a97f-e63ad6eefc85"` |
| `task_id` | string | Planner DAG 中的业务任务 ID | `"TASK-001"` |
| `toolCallId` | string | 一次工具调用的关联 ID | `"call_7a93e1"` |

### 2.3 Agent 类型

`agentType` 用来决定状态提示、推理卡片、工具卡片和 Token 用量的归属。

| 值 | 作用 |
| --- | --- |
| `conversation` | Conversation Agent，自然对话和用户输入整理 |
| `conversation_confirmation` | 面向用户展示工作流确认或补充表单 |
| `request` | Request Agent，结构化需求分析 |
| `orchestrator` | 产品工作流编排与路由 |
| `planner` | 生成 Planner DAG |
| `critique` | 审查 Executor 产出并决定是否完成 |
| `executor-product-strategy` | 产品战略 |
| `executor-market-research` | 市场研究 |
| `executor-gtm` | Go-To-Market |
| `executor-product-discovery` | 产品发现 |
| `executor-product-execution` | 产品执行 |
| `executor-marketing-growth` | 营销增长 |
| `executor-data-analytics` | 数据分析 |
| `executor-ai-shipping` | AI 产品交付 |
| `executor-toolkit` | 产品工具方法 |
| `executor-interface-craft` | 界面与交互设计 |

历史数据中还可能出现 `product_director`。前端类型应对未知字符串保持兼容，不要用穷举判断直接丢弃新 Agent。

---

## 3. 基础与工作区接口

### 3.1 服务状态

#### `GET /`

```json
{
  "status": "ok"
}
```

#### `GET /api/health`

用于健康检查或服务可用性提示。

```json
{
  "status": "ok",
  "agents": ["deepagents-pm-agent"]
}
```

### 3.2 当前账号

#### `GET /api/account`

```json
{
  "account": {
    "id": "local",
    "email": null,
    "username": "Local User",
    "avatar": null,
    "createdAt": "2026-07-23T08:00:00.000Z",
    "updatedAt": "2026-07-23T08:00:00.000Z"
  }
}
```

| 字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `account.id` | string | 必填 | 当前用户 ID |
| `email` | string \| null | 可空 | 邮箱 |
| `username` | string \| null | 可空 | 显示名称 |
| `avatar` | string \| null | 可空 | 头像地址 |
| `createdAt` | string \| null | 可空 | 创建时间 |
| `updatedAt` | string \| null | 可空 | 更新时间 |

### 3.3 工作区列表

#### `GET /api/workspaces`

```json
{
  "workspaces": [
    {
      "id": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
      "userId": "local",
      "name": "智能客服项目",
      "storageType": "local",
      "localPath": "E:\\projects\\support-bot",
      "cloudPath": null,
      "syncStatus": "idle",
      "createdAt": "2026-07-22T02:10:00.000Z",
      "updatedAt": "2026-07-23T08:30:00.000Z"
    }
  ]
}
```

#### `POST /api/workspaces`

请求体：

```json
{
  "name": "智能客服项目",
  "localPath": "E:\\projects\\support-bot"
}
```

`name` 和 `localPath` 都是可选字段。成功状态码为 `201`，响应为：

```json
{
  "workspace": {
    "id": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
    "userId": "local",
    "name": "智能客服项目",
    "storageType": "local",
    "localPath": "E:\\projects\\support-bot",
    "cloudPath": null,
    "syncStatus": "idle",
    "createdAt": "2026-07-23T08:30:00.000Z",
    "updatedAt": "2026-07-23T08:30:00.000Z"
  }
}
```

| 工作区字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 必填，UUID | 工作区主键 |
| `userId` | string | 必填 | 所属用户 |
| `name` | string | 必填 | 工作区名称 |
| `storageType` | string \| null | 可空 | 当前通常为 `"local"` |
| `localPath` | string \| null | 可空 | 用户选择的本地目录 |
| `cloudPath` | string \| null | 可空 | 云端目录，当前可为空 |
| `syncStatus` | string \| null | 可空 | 当前通常为 `"idle"` |
| `createdAt` | string | 必填 | 创建时间 |
| `updatedAt` | string | 必填 | 更新时间 |

> 浏览器环境不保证能取得目录的绝对路径，因此 `localPath` 必须允许用户编辑，也必须接受 `null`。

---

## 4. 会话接口

### 4.1 创建会话

#### `POST /api/chats`

请求体：

```json
{
  "workspaceId": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
  "title": "New Chat"
}
```

`title` 可选，最大 120 个字符。成功状态码为 `201`。

```json
{
  "chat": {
    "id": "e24ec116-64c1-442c-bde2-d7798a6573df",
    "workspaceId": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
    "userId": "local",
    "title": "New Chat",
    "type": "chat",
    "status": "active",
    "createdAt": "2026-07-23T08:35:00.000Z",
    "updatedAt": "2026-07-23T08:35:00.000Z"
  },
  "requestForm": {
    "id": "01f94a0b-6903-46f4-a8a6-11bcfb817469",
    "chatId": "e24ec116-64c1-442c-bde2-d7798a6573df",
    "version": 1,
    "status": "active",
    "summary": null,
    "createdAt": "2026-07-23T08:35:00.000Z",
    "updatedAt": "2026-07-23T08:35:00.000Z"
  }
}
```

`requestForm` 字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | string | 需求表单 ID，后续聊天请求作为 `requestFormId` 传回 |
| `chatId` | string | 所属会话 |
| `version` | 正整数 | 表单版本 |
| `status` | string | 当前处理阶段；新建时为 `"active"` |
| `summary` | string \| null | 需求摘要 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 最近更新时间 |

运行期间的内部状态可能依次为 `received`、`conversation_consumed`、`request_agent_running`、`request_analyzed`、`workflow_running`、`pending_user_confirmation`、`completed`、`stopped` 或 `failed`。当前没有单独读取 `requestForm` 最新状态的 REST 接口，聊天 UI 应以 SSE 卡片状态为准。

### 4.2 获取会话列表

#### `GET /api/chats?workspaceId={workspaceId}`

```json
{
  "chats": [
    {
      "id": "e24ec116-64c1-442c-bde2-d7798a6573df",
      "workspaceId": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
      "userId": "local",
      "title": "设计智能客服 MVP",
      "type": "chat",
      "status": "active",
      "requestFormId": "01f94a0b-6903-46f4-a8a6-11bcfb817469",
      "messageCount": 12,
      "createdAt": "2026-07-23T08:35:00.000Z",
      "updatedAt": "2026-07-23T08:46:00.000Z"
    }
  ]
}
```

| 会话字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 必填 | 会话 ID |
| `workspaceId` | string | 必填 | 所属工作区 |
| `userId` | string | 必填 | 所属用户 |
| `title` | string | 必填 | 会话标题；首轮完成后可能自动更新 |
| `type` | string \| null | 可空 | 当前通常为 `"chat"` |
| `status` | string \| null | 可空 | 活跃会话通常为 `"active"` |
| `requestFormId` | string | 可选 | 最新需求表单 ID |
| `messageCount` | number | 列表必填 | 消息数量 |
| `createdAt` | string | 必填 | 创建时间 |
| `updatedAt` | string | 必填 | 最后消息时间，没有消息时等于创建时间 |

### 4.3 停止聊天运行

#### `POST /api/chat/stop`

请求体：

```json
{
  "chatId": "e24ec116-64c1-442c-bde2-d7798a6573df"
}
```

响应：

```json
{
  "stopped": true
}
```

`stopped: false` 表示服务端未找到该会话正在运行的 Agent。前端停止按钮应先调用此接口，再中止浏览器侧的聊天 `fetch`。

---

## 5. 历史消息

### 5.1 获取历史消息

#### `GET /api/chats/{chatId}/messages`

```json
{
  "messages": [
    {
      "id": "96caf793-f829-4c09-a334-ceca01c541ed",
      "role": "assistant",
      "type": "planner",
      "content": "已根据需求生成执行计划。",
      "timestamp": "2026-07-23T08:40:00.000Z",
      "reasoningContent": "先识别核心目标，再拆分可并行任务。",
      "taskExecutionPlan": {
        "status": "initial",
        "request_summary": "设计智能客服 MVP",
        "dag": {
          "nodes": ["TASK-001"],
          "edges": []
        },
        "tasks": [],
        "assumptions": []
      },
      "executorResults": [],
      "toolCalls": [],
      "subagentTraces": [],
      "tokenUsages": []
    }
  ]
}
```

### 5.2 `PersistedMessage` 字段

| 字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 必填 | 消息 ID |
| `role` | `"user"` \| `"assistant"` | 必填 | 消息角色 |
| `type` | string \| null | 可选/可空 | assistant 对应的 Agent 类型 |
| `content` | string | 必填 | 已移除结构化 tagged block 后的展示正文 |
| `timestamp` | string | 必填 | 消息时间 |
| `reasoningContent` | string | 可选 | 对应 Agent 的完整推理文本 |
| `toolCalls` | `ToolCall[]` | 可选 | 可恢复的工具调用卡片 |
| `subagentTraces` | `SubagentTrace[]` | 可选 | Orchestrator 内嵌 SubAgent 轨迹 |
| `userInput` | `UserInputItem[] \| null` | 可选 | Conversation Agent 用户输入整理 |
| `requestAnalysis` | `RequestAnalysis \| null` | 可选 | Request Agent 分析 |
| `taskExecutionPlan` | `TaskExecutionPlan \| null` | 可选 | Planner DAG |
| `executorResult` | `ExecutorAgentResult \| null` | 可选 | 当前消息承载的单个 Executor 结果 |
| `executorResults` | `ExecutorAgentResult[]` | 可选 | 挂回 Planner 消息的同轮 Executor 结果 |
| `productWorkflow` | `ProductWorkflowResult \| null` | 可选 | Critique 后的工作流总结果 |
| `tokenUsages` | `TokenUsage[]` | 可选 | 归属于该消息的 Agent 用量 |

### 5.3 工具调用

```json
{
  "id": "call_7a93e1",
  "name": "web_search",
  "args": {
    "query": "2026 AI customer service market"
  },
  "result": {
    "results": [
      {
        "title": "Market report",
        "url": "https://example.com/report",
        "snippet": "Market summary..."
      }
    ]
  },
  "agentType": "conversation",
  "status": "complete"
}
```

| 字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 可选 | 将调用和结果关联起来 |
| `name` | string | 必填 | 工具名 |
| `args` | object | 可选 | 调用参数 |
| `result` | unknown | 可选 | 工具结果；不同工具结构不同 |
| `agentType` | string | 可选 | 工具归属 |
| `status` | `"running"` \| `"complete"` | 可选 | 展示加载或完成态 |

当前用户可选择开启的工具是 `web_search`。知识图谱工具由运行时策略自动授权，不应作为任意文件访问能力暴露给用户。

### 5.4 SubAgent 轨迹

```json
{
  "id": "call_sub_001",
  "parentAgentType": "orchestrator",
  "subagentType": "planner",
  "description": "生成任务 DAG",
  "thinking": "正在检查任务依赖关系。",
  "result": {
    "status": "ready"
  },
  "status": "complete"
}
```

| 字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 可选 | SubAgent 调用关联 ID |
| `parentAgentType` | string | 可选 | 发起调用的主 Agent |
| `subagentType` | string | 必填 | SubAgent 类型 |
| `description` | string | 可选 | 任务描述 |
| `thinking` | string | 可选 | 流式累加后的思考 |
| `result` | unknown | 可选 | SubAgent 最终结果 |
| `status` | `"running"` \| `"complete"` | 必填 | 执行状态 |

### 5.5 Token 用量

```json
{
  "id": "08437f79-ff90-40b7-8fb4-123ace9da169",
  "conversationId": "e24ec116-64c1-442c-bde2-d7798a6573df",
  "messageId": "96caf793-f829-4c09-a334-ceca01c541ed",
  "agentType": "planner",
  "inputTokens": 4200,
  "cacheHitInputTokens": 1200,
  "cacheMissInputTokens": 3000,
  "outputTokens": 860,
  "totalTokens": 5060,
  "costInput": 0.0042,
  "costOutput": 0.00258,
  "costTotal": 0.00678,
  "durationMs": 8432,
  "createdAt": "2026-07-23T08:40:08.000Z"
}
```

费用字段为数值，货币单位由后端模型价格配置决定；当前响应中没有单独的 `currency` 字段。

---

## 6. 聊天 SSE 协议

### 6.1 建立流

#### `POST /api/chat`

请求体示例：

```json
{
  "chatId": "e24ec116-64c1-442c-bde2-d7798a6573df",
  "requestFormId": "01f94a0b-6903-46f4-a8a6-11bcfb817469",
  "enabledTools": ["web_search"],
  "messages": [
    {
      "id": "2d17a45f-6fcf-4ec9-93bf-baf02d5101d7",
      "role": "user",
      "content": "帮我设计一个智能客服 MVP",
      "timestamp": "2026-07-23T08:36:00.000Z",
      "sessionId": "local"
    }
  ]
}
```

每条 SSE 数据格式：

```text
data: {"type":"text","content":"正在整理需求。","agentType":"conversation"}

```

流结束标记：

```text
data: [DONE]

```

> 当前前端使用 `fetch()` 读取流，而不是 `EventSource`，因为请求需要 `POST` JSON body。

### 6.2 事件速查

| 事件 | 核心字段 | 前端作用 |
| --- | --- | --- |
| `start` | 无 | 初始化本轮流 |
| `agent-status` | `agentType`, `status`, `phase`, `parallelAgents?` | Agent 加载态与并行态 |
| `thinking` | `content`, `agentType?` | 按 Agent 累加推理 |
| `text` | `content`, `agentType?` | 累加正文或解析 tagged block |
| `question-form-start` | `agentType?` | 表单生成态 |
| `question-form-complete` | `content`, `agentType?` | 渲染 Question Form |
| `human-interrupt` | `interrupt`, `agentType?` | 保存可恢复的 HITL 中断 |
| `user-input-start` | 无 | 用户输入整理加载态 |
| `user-input-complete` | `content` | 展示用户输入整理卡片 |
| `request-analysis-start` | `agentType?` | Request Agent 加载态 |
| `request-analysis-complete` | `content`, `analysis`, `agentType?` | 展示结构化需求分析 |
| `tool-call` | `toolCallId?`, `toolName`, `toolArgs?`, `agentType?` | 新建/更新工具卡片 |
| `tool-result` | `toolCallId?`, `toolName`, `toolResult`, `agentType?` | 完成工具卡片 |
| `subagent-start` | SubAgent 字段 | 新建 SubAgent 卡片 |
| `subagent-thinking` | `content` + SubAgent 字段 | 累加 SubAgent 思考 |
| `subagent-result` | `result` + SubAgent 字段 | 完成 SubAgent 卡片 |
| `token-usage` | Token 数值字段 | 追加单 Agent 用量 |
| `conversation-title` | `chatId`, `title` | 更新侧边栏标题 |
| `error` | `error`, `agentType?` | 展示紧凑可操作错误 |
| `abort` | 无 | 用户主动停止 |

### 6.3 `start`

```json
{
  "type": "start"
}
```

每次成功建立聊天 SSE 后首先发送。它不代表任何 Agent 已经开始。

### 6.4 `agent-status`

```json
{
  "type": "agent-status",
  "agentType": "executor-market-research",
  "status": "started",
  "phase": "execution",
  "parallelAgents": [
    "executor-market-research",
    "executor-product-strategy"
  ]
}
```

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `agentType` | string | 必填 | 当前 Agent |
| `status` | `"started"` \| `"completed"` | 必填 | 开始或完成 |
| `phase` | `"planning"` \| `"execution"` \| `"review"` | 可选 | 所属业务阶段 |
| `parallelAgents` | string[] | 可选 | 当前并行批次；用于同时点亮多个 Executor |

`agent-status` 是前端活动 Agent 状态的权威来源。收到 `completed` 时，应同时结束该 Agent 尚未完成的工具加载态。

### 6.5 `thinking`

Agent Runtime 内部叫 `reasoning`，API 会统一重命名为 `thinking`。

```json
{
  "type": "thinking",
  "content": "需要先确认目标用户和首版范围。",
  "agentType": "request"
}
```

`content` 是流式增量，前端必须按到达顺序拼接，不能覆盖之前的内容。

### 6.6 `text`

```json
{
  "type": "text",
  "content": "我已经整理好首版方案。",
  "agentType": "conversation"
}
```

`content` 通常是 Markdown 增量，也可能包含以下完整 tagged block：

| Tagged block | JSON 内容 | 前端用途 |
| --- | --- | --- |
| `<question-form>...</question-form>` | Question Form | 表单卡片 |
| `<user-input>...</user-input>` | 用户输入整理 | 用户输入卡片 |
| `<request-analysis>...</request-analysis>` | Request 分析 | 分析卡片 |
| `<task-execution>...</task-execution>` | `TaskExecutionPlan` | Planner DAG |
| `<executor-result>...</executor-result>` | `ExecutorAgentResult` | 单个 Executor 完成卡片 |
| `<product-workflow>...</product-workflow>` | `ProductWorkflowResult` | Critique Review 与整轮结果 |

结构化 block 应从普通正文中移除，避免 JSON 原文和卡片重复展示。

### 6.7 Question Form 生命周期

开始：

```json
{
  "type": "question-form-start",
  "agentType": "orchestrator"
}
```

完成：

```json
{
  "type": "question-form-complete",
  "agentType": "orchestrator",
  "content": "<question-form id=\"orch-clarification-1784796000000\" title=\"确认需求\">\n{\"description\":\"我需要确认几个关键信息。\",\"questions\":[{\"id\":\"goal\",\"label\":\"核心目标是什么？\",\"type\":\"textarea\",\"required\":true}],\"submitLabel\":\"提交\"}\n</question-form>"
}
```

`content` 是完整标签字符串，不是已解析的 JSON。解析规则见 [7.1 Question Form](#71-question-form)。

### 6.8 `human-interrupt`

```json
{
  "type": "human-interrupt",
  "agentType": "conversation_confirmation",
  "interrupt": {
    "id": "4ae00efe-9446-4b6c-96f3-d8931205c3f9",
    "threadId": "hitl:request-form:01f94a0b:product-workflow-confirmation",
    "value": {
      "actionRequests": [
        {
          "name": "question_form",
          "args": {
            "questionForm": "<question-form>...</question-form>",
            "formId": "product-workflow-confirmation",
            "agentType": "conversation_confirmation"
          },
          "description": "等待用户提交表单后继续工作流。"
        }
      ],
      "reviewConfigs": [
        {
          "allowedDecisions": ["approve", "reject", "edit", "respond"]
        }
      ]
    }
  }
}
```

该事件表示运行时已暂停在人工确认点。前端提交表单时，需要把对应的 `threadId` 带回 `/api/chat` 的 `hitlResume`。

### 6.9 用户输入整理

```json
{
  "type": "user-input-start"
}
```

```json
{
  "type": "user-input-complete",
  "content": "<user-input>\n{\"user_input\":[{\"index\":1,\"content\":\"设计一个智能客服 MVP\",\"type\":\"请求\"}]}\n</user-input>"
}
```

`UserInputItem`：

| 字段 | 类型 | 作用 | 示例 |
| --- | --- | --- | --- |
| `index` | 正整数 | 用户输入片段序号 | `1` |
| `content` | string | 原始意图片段 | `"设计一个智能客服 MVP"` |
| `type` | string | 语义分类 | `"陈述"`、`"提问"`、`"补充"`、`"请求"` |

### 6.10 Request Agent 分析

```json
{
  "type": "request-analysis-start",
  "agentType": "request"
}
```

```json
{
  "type": "request-analysis-complete",
  "agentType": "request",
  "content": "<request-analysis>\n{\"business_model\":[...],\"questions\":[],\"chitchat\":[]}\n</request-analysis>",
  "analysis": {
    "business_model": [
      {
        "index": 1,
        "user_goal": "设计可上线验证的智能客服 MVP",
        "goal_constraints": ["首版只覆盖 Web 客服入口", "需要人工转接"],
        "missing_information": [
          {
            "index": 1,
            "description": "尚未明确目标响应时延",
            "importance": 0.8
          }
        ],
        "covered_user_input_indexes": [1]
      }
    ],
    "questions": [],
    "chitchat": []
  }
}
```

| `RequestAnalysis` 字段 | 类型 | 作用 |
| --- | --- | --- |
| `business_model` | `BusinessModelItem[]` | 后续产品工作流实际处理的业务目标 |
| `questions` | number[] | 属于普通问答的 `UserInputItem.index` |
| `chitchat` | number[] | 属于闲聊的 `UserInputItem.index` |

`MissingInformation.importance` 范围为 `0` 到 `1`，越高表示越值得优先补充。

### 6.11 工具事件

```json
{
  "type": "tool-call",
  "toolCallId": "call_7a93e1",
  "toolName": "web_search",
  "toolArgs": {
    "query": "AI customer support trends 2026"
  },
  "agentType": "conversation"
}
```

```json
{
  "type": "tool-result",
  "toolCallId": "call_7a93e1",
  "toolName": "web_search",
  "toolResult": {
    "results": [],
    "error": "Search backend temporarily unavailable."
  },
  "agentType": "conversation"
}
```

工具失败通常作为结构化 `toolResult` 返回，不一定触发整条 SSE 的 `error`。`toolResult` 是 `unknown`，前端应按工具名选择展示器，并为未知结构提供 JSON/文本兜底。

### 6.12 SubAgent 事件

```json
{
  "type": "subagent-start",
  "agentType": "orchestrator",
  "subagentType": "planner",
  "toolCallId": "call_sub_001",
  "description": "生成 Planner DAG"
}
```

```json
{
  "type": "subagent-thinking",
  "agentType": "orchestrator",
  "subagentType": "planner",
  "toolCallId": "call_sub_001",
  "content": "正在检查任务依赖。"
}
```

```json
{
  "type": "subagent-result",
  "agentType": "orchestrator",
  "subagentType": "planner",
  "toolCallId": "call_sub_001",
  "result": {
    "status": "ready"
  }
}
```

### 6.13 `token-usage`

```json
{
  "type": "token-usage",
  "id": "08437f79-ff90-40b7-8fb4-123ace9da169",
  "agentType": "planner",
  "inputTokens": 4200,
  "cacheHitInputTokens": 1200,
  "cacheMissInputTokens": 3000,
  "outputTokens": 860,
  "totalTokens": 5060,
  "costInput": 0.0042,
  "costOutput": 0.00258,
  "costTotal": 0.00678,
  "durationMs": 8432,
  "parallelAgents": ["planner"],
  "createdAt": "2026-07-23T08:40:08.000Z"
}
```

API 会补充：

- `id`：成功持久化后的 Token 记录 ID；没有会话或 `totalTokens <= 0` 时可能缺失。
- `createdAt`：API 发送事件时生成的时间。

### 6.14 标题、错误和中止

自动标题：

```json
{
  "type": "conversation-title",
  "chatId": "e24ec116-64c1-442c-bde2-d7798a6573df",
  "title": "设计智能客服 MVP"
}
```

运行错误：

```json
{
  "type": "error",
  "agentType": "executor-market-research",
  "error": "市场研究任务失败，请检查模型服务后重试。"
}
```

用户中止：

```json
{
  "type": "abort"
}
```

### 6.15 当前不会透传给浏览器的数据

以下 Agent Runtime 事件会被 API 消费后跳过，前端不要等待：

| Runtime 事件 | 原因 |
| --- | --- |
| `complete` | API 用它持久化 `ProductWorkflowResult` |
| `knowledge-graph-update` | API 用它增量归档工作区知识图谱 |

以下名称存在于前端或 Runtime 的兼容类型中，但当前聊天链路没有实际生产者，不能作为流程完成依据：

- `thinking-done`
- `step-finish`
- `finish`
- `todo-update`（聊天链路）
- `workflow-resume-start`
- `workflow-resume-complete`

聊天流的结束依据是读取到 `[DONE]` 或网络流结束；产品工作流的业务完成依据是结构化 `ProductWorkflowResult.status` 或完成提示卡片。

---

## 7. Question Form 与 HITL

### 7.1 Question Form

后端通过一个带属性的标签传输表单：

```html
<question-form id="request-discovery" title="需求确认">
{
  "description": "为了继续规划，请补充以下信息。",
  "questions": [
    {
      "id": "platform",
      "label": "首版平台",
      "type": "radio",
      "options": ["Web", "iOS", "Android"],
      "required": true,
      "defaultValue": "Web",
      "help": "用于确定首版交付范围"
    },
    {
      "id": "constraints",
      "label": "其他约束",
      "type": "textarea",
      "placeholder": "例如预算、时间、技术限制",
      "required": false,
      "collapsible": true,
      "defaultCollapsed": true
    }
  ],
  "submitLabel": "提交补充信息"
}
</question-form>
```

表单级字段：

| 字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 必填 | 取自标签属性或 JSON；提交答案时使用 |
| `title` | string | 必填 | 取自标签属性或 JSON |
| `description` | string | 可选 | 表单说明 |
| `questions` | `FormQuestion[]` | 必填 | 表单字段 |
| `submitLabel` | string | 可选 | 主按钮文案 |
| `variant` | `"optional-followup"` | 可选 | 全部为选填问题时的变体 |
| `requireAnyAnswer` | boolean | 可选 | 主提交至少需要一个非空答案 |
| `secondarySubmitLabel` | string | 可选 | 次要操作文案，例如“不再继续” |
| `secondaryActionValue` | string | 可选 | 次要操作稳定值，例如 `"stop_optional_questions"` |

问题字段：

| 字段 | 类型 | 约束 | 作用 |
| --- | --- | --- | --- |
| `id` | string | 必填 | 答案键 |
| `label` | string | 必填 | 用户可见问题 |
| `type` | string | 必填 | `radio`、`checkbox`、`select`、`text`、`textarea`、`direction-cards` |
| `options` | string[] | 选择类可选 | 选项 |
| `placeholder` | string | 可选 | 输入提示 |
| `required` | boolean | 可选 | 是否必填 |
| `help` | string | 可选 | 帮助或问题来源 |
| `defaultValue` | string \| string[] | 可选 | 默认值 |
| `maxSelections` | 正整数 | checkbox 可选 | 多选上限 |
| `collapsible` | boolean | 可选 | 是否可折叠 |
| `defaultCollapsed` | boolean | 可选 | 是否默认折叠 |
| `cards` | `DirectionCard[]` | direction-cards 可选 | 视觉方向卡片 |

`DirectionCard` 字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | string | 提交值，应与 `options` 中的值对应 |
| `label` | string | 卡片标题 |
| `mood` | string | 氛围说明 |
| `references` | string[] | 参考品牌或产品 |
| `palette` | string[] | HEX / OKLch 色板 |
| `displayFont` | string | 标题字体栈 |
| `bodyFont` | string | 正文字体栈 |

### 7.2 表单答案

当前前端将表单答案序列化进用户消息 `content`。示例：

```text
[form answers - product-workflow-confirmation]
decision: 确认但补充新需求
notes: 增加多语言支持
```

后端依赖表单 ID 识别恢复路径，因此不要只发送自然语言答案。

### 7.3 HITL 恢复请求

`POST /api/chat` 的 `hitlResume`：

```json
{
  "threadId": "hitl:request-form:01f94a0b:product-workflow-confirmation",
  "response": {
    "decisions": [
      {
        "type": "respond",
        "message": "[form answers - product-workflow-confirmation]\ndecision: 确认接受"
      }
    ]
  }
}
```

支持的 decision：

```ts
type HitlDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | {
      type: "edit";
      editedAction: {
        name: string;
        args: Record<string, unknown>;
      };
    }
  | { type: "respond"; message: string };
```

---

## 8. 产品工作流结构化数据

### 8.1 Planner DAG：`TaskExecutionPlan`

```json
{
  "status": "initial",
  "request_summary": "设计智能客服 MVP",
  "dag": {
    "nodes": ["TASK-001", "TASK-002"],
    "edges": [
      {
        "source": "TASK-001",
        "target": "TASK-002"
      }
    ]
  },
  "tasks": [
    {
      "task_id": "TASK-001",
      "sequence": 1,
      "title": "定义产品目标与边界",
      "description": "明确目标用户、核心价值和 MVP 范围。",
      "assigned_agent": "executor-product-strategy",
      "depends_on": [],
      "covered_business_model_indexes": [1],
      "expected_output": "目标、范围与成功指标",
      "required_open_question_count": 0,
      "quality_check": {
        "status": "pending",
        "criteria": ["目标可衡量", "范围可在首版交付"]
      }
    }
  ],
  "assumptions": [
    "首版服务对象为中国大陆 Web 用户"
  ]
}
```

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `status` | `"initial"` \| `"supplement"` | 首轮计划或表单答复后的补充计划 |
| `request_summary` | string | 本轮需求摘要 |
| `dag.nodes` | string[] | DAG 任务 ID 列表 |
| `dag.edges` | `{source,target}[]` | 任务依赖边 |
| `tasks` | `TaskExecutionNode[]` | 任务详细定义 |
| `assumptions` | string[] | Planner 使用的显式假设 |

`TaskExecutionNode`：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `task_id` | string | 稳定任务 ID |
| `sequence` | 正整数 | 展示排序 |
| `title` | string | 任务标题 |
| `description` | string | 任务说明 |
| `assigned_agent` | Executor agentType | 执行 Agent |
| `depends_on` | string[] | 前置任务 ID |
| `covered_business_model_indexes` | 正整数[] | 覆盖的 Request 业务目标 |
| `expected_output` | string | 预期产出 |
| `required_open_question_ids` | string[] | 可选，历史兼容的阻塞问题 ID |
| `required_open_question_count` | 非负整数 | 可选，本任务允许产生的阻塞问题数量 |
| `quality_check.status` | `"pending"` \| `"passed"` \| `"failed"` | 验收状态 |
| `quality_check.criteria` | string[] | 验收标准 |
| `quality_check.result` | string | 可选，验收结果说明 |

### 8.2 Executor 结果：`ExecutorAgentResult`

```json
{
  "task_id": "TASK-001",
  "agent_type": "executor-product-strategy",
  "focus_layer": "Goal",
  "summary": "明确了 MVP 的目标、边界和关键指标。",
  "entities": [
    {
      "id": "G-001",
      "type": "Goal",
      "name": "降低人工客服重复咨询量",
      "description": "上线三个月内降低 30%",
      "source_task_id": "TASK-001",
      "status": "proposed"
    }
  ],
  "relations": [],
  "decisions": [
    {
      "id": "D-001",
      "text": "首版仅支持 Web 渠道",
      "source_task_id": "TASK-001"
    }
  ],
  "risks": [
    {
      "id": "RISK-001",
      "text": "知识库覆盖不足会降低自动解决率",
      "source_task_id": "TASK-001"
    }
  ],
  "open_questions": [
    {
      "id": "OQ-001",
      "text": "是否需要支持英文？",
      "source_task_id": "TASK-001",
      "source_agent": "executor-product-strategy",
      "blocking": false
    }
  ],
  "quality_result": {
    "passed": true,
    "notes": "目标和指标均可验证。"
  }
}
```

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `task_id` | string | 对应 Planner 任务 |
| `agent_type` | Executor agentType | 结果来源 |
| `focus_layer` | string | `Goal`、`Requirement`、`Evidence`、`Decision`、`Feature`、`Component`、`Metric`、`Custom` |
| `summary` | string | 用户可见摘要 |
| `entities` | `KnowledgeGraphEntity[]` | 新增/更新节点 |
| `relations` | `KnowledgeGraphRelation[]` | 新增/更新关系 |
| `decisions` | `{id,text,source_task_id?}[]` | 结构化决策 |
| `risks` | `{id,text,source_task_id?}[]` | 结构化风险 |
| `open_questions` | `OpenQuestion[]` | 待确认问题 |
| `quality_result` | object | Executor 自检 |
| `knowledge_graph_patch` | string | 可选；历史兼容，正常持久化会剔除大图数据 |
| `knowledge_graph_markdown` | string | 可选；历史兼容，正常持久化会剔除大图数据 |

### 8.3 工作流总结果：`ProductWorkflowResult`

```json
{
  "status": "pending_user_confirmation",
  "confirmation_id": "review-001",
  "request_summary": "设计智能客服 MVP",
  "planner": {
    "status": "initial",
    "request_summary": "设计智能客服 MVP",
    "dag": {"nodes": ["TASK-001"], "edges": []},
    "tasks": [],
    "assumptions": []
  },
  "executor_results": [],
  "review": {
    "accepted_task_ids": ["TASK-001"],
    "rejected_task_ids": [],
    "retry_task_ids": [],
    "issues": [],
    "notes": "当前结果可进入用户确认。"
  },
  "product_context_update": "已形成智能客服 MVP 的首轮产品上下文。",
  "knowledge_graph_update": {
    "current_state": "building",
    "description": "智能客服 MVP 产品上下文",
    "entities": [],
    "relations": [],
    "decisions": [],
    "risks": [],
    "open_questions": [],
    "resolved_open_question_ids": [],
    "summary": [],
    "markdown": "",
    "notes": []
  },
  "knowledge_graph_review": {
    "graph_ref": {
      "version": 1,
      "entity_count": 12,
      "relation_count": 9
    },
    "accepted_task_ids": ["TASK-001"],
    "rejected_task_ids": [],
    "retry_task_ids": [],
    "issues": [],
    "notes": ["图谱引用完整。"]
  },
  "proposal_questions": [],
  "confirmation_message": "请确认当前产品设计结果。"
}
```

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `status` | `"pending_user_confirmation"` \| `"completed"` \| `"discarded"` | 整轮工作流状态 |
| `confirmation_id` | string | 表单/确认稳定 ID |
| `request_summary` | string | 需求摘要 |
| `planner` | `TaskExecutionPlan` | 本轮 DAG |
| `executor_results` | `ExecutorAgentResult[]` | 所有 Executor 结果 |
| `review.accepted_task_ids` | string[] | 已接受任务 |
| `review.rejected_task_ids` | string[] | 已拒绝任务 |
| `review.retry_task_ids` | string[] | 可选，需要重试的任务 |
| `review.issues` | `ReviewIssue[]` | 可选，审查问题 |
| `review.notes` | string | 审查摘要 |
| `product_context_update` | string | 产品上下文更新摘要 |
| `knowledge_graph_update` | `ProductKnowledgeGraph` | Runtime 完整图谱快照 |
| `knowledge_graph_review` | object | 可选，图谱轻量审查 |
| `proposal_questions` | `ProposalQuestion[]` | 待用户补充的问题 |
| `confirmation_message` | string | 用户可见确认文案 |

`ReviewIssue`：

```json
{
  "code": "MISSING_METRIC",
  "severity": "warning",
  "task_id": "TASK-001",
  "message": "成功指标缺少明确时间范围。"
}
```

`ProposalQuestion`：

```json
{
  "id": "target-language",
  "label": "首版需要支持哪些语言？",
  "type": "checkbox",
  "options": ["中文", "英文", "日文"],
  "required": true,
  "maxSelections": 2,
  "source_task_id": "TASK-001",
  "source_agent": "executor-product-strategy",
  "sources": [
    {
      "source_task_id": "TASK-001",
      "source_agent": "executor-product-strategy",
      "open_question_id": "OQ-001"
    }
  ],
  "priority": 3
}
```

| ProposalQuestion 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | string | 表单字段 ID |
| `label` | string | 用户可见问题 |
| `type` | `"radio"` \| `"checkbox"` \| `"select"` \| `"text"` \| `"textarea"` | 控件类型 |
| `options` | string[] | 可选，选择类控件的选项 |
| `placeholder` | string | 可选，输入提示 |
| `required` | boolean | 是否必须回答 |
| `help` | string | 可选，帮助或来源摘要 |
| `maxSelections` | 正整数 | 可选，checkbox 选择上限 |
| `source_task_id` | string | 可选，主要来源任务 |
| `source_agent` | string | 可选，主要来源 Agent |
| `sources` | array | 合并问题覆盖的全部来源 |
| `sources[].open_question_id` | string | 可选，被该字段解决的精确 OpenQuestion ID |
| `priority` | integer | 优先级，值越大越靠前 |

`knowledge_graph_review`：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `graph_ref.version` | 非负整数 | 可选，被审查的持久化图谱版本 |
| `graph_ref.checksum` | string | 可选，图谱校验和或稳定引用 |
| `graph_ref.entity_count` | 非负整数 | 可选，实体数 |
| `graph_ref.relation_count` | 非负整数 | 可选，关系数 |
| `accepted_task_ids` | string[] | 图谱更新被接受的任务 |
| `rejected_task_ids` | string[] | 图谱更新被拒绝的任务 |
| `retry_task_ids` | string[] | 需要修正或重试的任务 |
| `issues` | `ReviewIssue[]` | 图谱审查问题 |
| `notes` | string[] | 简短审查说明 |

---

## 9. 产品知识图谱

### 9.1 查询接口

#### `GET /api/workspaces/{workspaceId}/knowledge-graph`

有数据：

```json
{
  "hasData": true,
  "markdown": "# Product Knowledge Graph\n\n## Graph Updates\n...",
  "nodes": [
    {
      "id": "G-001",
      "type": "Goal",
      "name": "降低重复咨询量",
      "description": "三个月内降低 30%",
      "source_task_id": "TASK-001",
      "status": "confirmed"
    }
  ],
  "relations": [
    {
      "id": "REL-001",
      "type": "Measures",
      "source": "G-001",
      "target": "M-001",
      "description": "通过自动解决率衡量目标",
      "source_task_id": "TASK-001"
    }
  ],
  "version": 3,
  "updatedAt": "2026-07-23T08:50:00.000Z"
}
```

没有数据库记录时：

```json
{
  "hasData": false,
  "markdown": "",
  "nodes": [],
  "relations": [],
  "version": 0,
  "updatedAt": ""
}
```

`hasData` 当前以 `nodes.length > 0` 为准，不要求 `relations` 非空。

### 9.2 图谱节点

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | string | 节点 ID |
| `type` | enum | 节点类型 |
| `name` | string | 节点名称 |
| `description` | string | 可选，节点说明 |
| `source_task_id` | string | 可选，来源任务 |
| `status` | `"proposed"` \| `"confirmed"` \| `"deprecated"` | 可选，节点状态 |
| `blocking` | boolean | 可选，OpenQuestion 是否阻塞 |

节点类型：

`Goal`、`Requirement`、`Evidence`、`Decision`、`Feature`、`Component`、`Metric`、`Risk`、`OpenQuestion`、`Custom`。

### 9.3 图谱关系

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | string | 关系 ID |
| `type` | enum | 关系类型 |
| `source` | string | 起点节点 ID |
| `target` | string | 终点节点 ID |
| `description` | string | 可选，业务关系说明 |
| `source_task_id` | string | 可选，来源任务 |

关系类型：

`Drives`、`Satisfies`、`Promotes`、`Produces`、`Constrains`、`Implements`、`Measures`、`Validates`、`References`、`Composes`、`Custom`。

### 9.4 Runtime 完整图谱与 REST 图谱的差异

Runtime 的 `ProductKnowledgeGraph` 还包含：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `current_state` | `"initial"` \| `"building"` \| `"refining"` \| `"stable"` | 产品上下文生命周期 |
| `description` | string | 累计上下文活动摘要 |
| `decisions` | array | Runtime 决策 |
| `risks` | array | Runtime 风险 |
| `open_questions` | array | Runtime 待确认问题 |
| `resolved_open_question_ids` | string[] | 已回答问题的墓碑 ID |
| `summary` | string[] | Runtime 摘要 |
| `markdown` | string | 可选生成文本 |
| `notes` | string[] | 其他说明 |

数据库和 REST 长期事实源只保留 `nodes` 与 `relations`。决策、风险和待确认问题会被规范化为对应类型的节点。因此知识图谱页面应以 REST 返回的 `nodes` / `relations` 为准。

---

## 10. 文档生成接口

### 10.1 状态响应外层

所有文档查询与启动接口都使用：

```ts
interface DocumentGenerationStatusResponse {
  run: DocumentGenerationRun | null;
  artifact: DocumentArtifact | null;
}
```

没有任务时：

```json
{
  "run": null,
  "artifact": null
}
```

### 10.2 启动文档生成

#### `POST /api/workspaces/{workspaceId}/document-generation`

请求体：

```json
{
  "kind": "prd"
}
```

成功状态码为 `202`。类型枚举保留 `prd`、`mrd`、`brd`，但当前只有 `prd` 可执行。

### 10.3 查询最新任务

#### `GET /api/workspaces/{workspaceId}/document-generation/latest?kind=prd`

`kind` 缺省时按 `prd` 处理。

### 10.4 按任务查询

#### `GET /api/document-generation/{runId}`

任务不存在时返回 `404`：

```json
{
  "error": "文档任务不存在。"
}
```

### 10.5 停止文档任务

#### `POST /api/document-generation/{runId}/stop`

```json
{
  "stopped": true
}
```

### 10.6 `DocumentGenerationRun`

```json
{
  "id": "cfdb69ce-e312-46e3-a97f-e63ad6eefc85",
  "workspaceId": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
  "kind": "prd",
  "status": "running",
  "workflowThreadId": "document:71fe4f6a:cfdb69ce:prd",
  "currentStage": "scoreDraft",
  "todos": [
    {
      "index": 0,
      "content": "解析产品知识图谱",
      "status": "completed"
    },
    {
      "index": 1,
      "content": "生成并评分 PRD",
      "status": "in_progress"
    }
  ],
  "reasoningLog": [
    {
      "index": 0,
      "agentType": "document-workflow",
      "content": "进入阶段：评分草稿",
      "createdAt": "2026-07-23T09:00:00.000Z"
    }
  ],
  "scoringAttempts": [],
  "documentArtifactId": null,
  "errorMessage": null,
  "startedAt": "2026-07-23T08:55:00.000Z",
  "finishedAt": null,
  "createdAt": "2026-07-23T08:55:00.000Z",
  "updatedAt": "2026-07-23T09:00:00.000Z"
}
```

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | string | run ID |
| `workspaceId` | string | 所属工作区 |
| `kind` | `"prd"` \| `"mrd"` \| `"brd"` | 文档类型 |
| `status` | enum | `queued`、`running`、`completed`、`stopped`、`failed` |
| `workflowThreadId` | string | Document LangGraph 线程 ID |
| `currentStage` | stage \| null | 当前工作流阶段 |
| `todos` | `DocumentTodo[]` | 用户可见 Task planning |
| `reasoningLog` | `ReasoningLogEntry[]` | 持久化思考过程 |
| `scoringAttempts` | `DocumentScoreAttempt[]` | 每轮评分结果，包含未选中的草稿 |
| `documentArtifactId` | string \| null | 完成后的产物 ID |
| `errorMessage` | string \| null | 失败时的紧凑错误 |
| `startedAt` | string \| null | 实际开始时间 |
| `finishedAt` | string \| null | 完成、停止或失败时间 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 最近进度更新时间 |

文档阶段：

| 值 | 含义 |
| --- | --- |
| `parseKg` | 解析知识图谱 |
| `normalizeGraph` | 规范化图谱 |
| `buildSectionDossiers` | 构建章节资料包 |
| `draftSection` | 生成章节草稿 |
| `crossCheck` | 跨章节一致性检查 |
| `scoreDraft` | 三个独立评分 Agent 评分 |
| `aggregateScore` | 加权汇总 |
| `humanReview` | 人工审查阶段 |
| `exportPrd` | 导出并持久化 PRD |

### 10.7 `DocumentScoreAttempt`

```json
{
  "attempt": 1,
  "markdown": "# 智能客服 MVP PRD\n...",
  "reviewerScores": [
    {
      "reviewerId": "reviewer-a",
      "reviewerName": "结构与逻辑评分员",
      "score": 88,
      "dimensions": {
        "relevance": 90,
        "completeness": 86,
        "structure": 91,
        "feasibility": 85,
        "language": 88
      },
      "strengths": ["目标清晰"],
      "weaknesses": ["异常流程略少"],
      "revisionAdvice": ["补充人工转接失败流程"]
    }
  ],
  "scoreSpread": 5,
  "varianceAccepted": true,
  "aggregate": {
    "score": 87.4,
    "passed": true,
    "confidence": 0.91,
    "rationale": "内容完整且评分一致。",
    "requiredRevisions": [],
    "weights": {
      "averageScore": 88,
      "minimumScore": 85,
      "spreadPenalty": 0.8,
      "consistencyBonus": 0.2
    }
  },
  "passed": true,
  "selected": true
}
```

评分规则相关字段：

- `scoreSpread`：三个评分的最高分减最低分。
- `varianceAccepted`：分差是否在允许范围内。
- `aggregate.confidence`：`0` 到 `1`。
- `selected`：该草稿是否最终被选中。
- 当前可靠质量阈值为 `85/100`，最大允许分差为 `8`，最多尝试 `3` 版；这些值也会出现在最终 `qualityScore` 中。

### 10.8 `DocumentArtifact`

```json
{
  "id": "2ba4111b-8156-42fb-97d5-dbf5ae05c491",
  "workspaceId": "71fe4f6a-13b9-4bb0-a04c-0a88ab38c29a",
  "runId": "cfdb69ce-e312-46e3-a97f-e63ad6eefc85",
  "kind": "prd",
  "title": "智能客服 MVP 产品需求文档",
  "markdown": "# 智能客服 MVP 产品需求文档\n...",
  "content": {
    "kind": "prd",
    "title": "智能客服 MVP 产品需求文档",
    "markdown": "# 智能客服 MVP 产品需求文档\n...",
    "sections": [
      {
        "id": "overview",
        "title": "产品概述",
        "summary": "定义产品目标、用户和范围。",
        "nodeIds": ["G-001", "REQ-001"],
        "relationIds": ["REL-001"]
      }
    ],
    "sourceGraphStats": {
      "nodeCount": 18,
      "relationCount": 14
    },
    "crossCheck": {
      "passed": true,
      "notes": ["术语一致", "范围与目标一致"]
    },
    "qualityScore": {
      "threshold": 85,
      "maxAllowedScoreSpread": 8,
      "maxAttempts": 3,
      "selectedAttempt": 1,
      "finalScore": 87.4,
      "passed": true,
      "selectionReason": "满足质量阈值且评分分差可接受。",
      "attempts": []
    }
  },
  "version": 1,
  "createdAt": "2026-07-23T09:08:00.000Z",
  "updatedAt": "2026-07-23T09:08:00.000Z"
}
```

`content` 可能为 `null`，前端查看/下载正文时应优先使用顶层 `markdown`。完整 PRD 不应直接铺在文档规划页，应放在查看弹窗和下载操作中。

---

## 11. 错误响应

### 11.1 参数校验错误

状态码通常为 `400`，`error` 可能是 Zod flatten 对象：

```json
{
  "error": {
    "formErrors": [],
    "fieldErrors": {
      "workspaceId": ["Invalid uuid"]
    }
  }
}
```

### 11.2 业务错误

```json
{
  "error": "当前工作区还没有可用于生成 PRD 的知识图谱。"
}
```

常见状态码：

| 状态码 | 场景 |
| --- | --- |
| `400` | 参数错误、暂不支持的文档类型 |
| `404` | 文档任务不存在 |
| `409` | 缺少生成文档所需图谱，或业务状态冲突 |
| `503` | 文档生成服务暂时不可用 |

前端错误读取建议：

```ts
const message =
  typeof data?.error === "string"
    ? data.error
    : data?.error
      ? JSON.stringify(data.error)
      : `Server error: ${response.status}`;
```

聊天流建立后的错误通过 SSE `error` 事件返回，不再使用 HTTP 错误状态。

---

## 12. 前端实现注意事项

### 12.1 SSE 解析

1. 只处理以 `data: ` 开头的行。
2. 用 `TextDecoder` 保留跨 chunk 的半行缓存。
3. `[DONE]` 不是 JSON，不要调用 `JSON.parse`。
4. 单条解析失败时跳过该条，不要终止后续事件消费。
5. `thinking`、`text`、`subagent-thinking` 都是增量内容，必须拼接。

### 12.2 事件关联

- 工具事件优先用 `toolCallId` 关联。
- 缺少 `toolCallId` 时，可用“同 Agent + 同工具名 + 最近未完成调用”兜底。
- SubAgent 同样优先用 `toolCallId`，其次匹配最近的同 `subagentType`。
- `token-usage.id` 可用于流重放去重。

### 12.3 实时数据与历史恢复

| 实时 SSE | 历史消息字段 |
| --- | --- |
| `thinking` | `reasoningContent` |
| `tool-call` / `tool-result` | `toolCalls` |
| `subagent-*` | `subagentTraces` |
| `user-input-complete` | `userInput` |
| `request-analysis-complete` | `requestAnalysis` |
| `<task-execution>` | `taskExecutionPlan` |
| `<executor-result>` | `executorResult` / `executorResults` |
| `<product-workflow>` | `productWorkflow` |
| `token-usage` | `tokenUsages` |

前端状态模型应让实时流和历史 DTO 汇入同一套卡片数据，避免刷新前后展示不一致。

### 12.4 数据展示建议

- `agentType` 决定推理、工具和 Token 卡片放在哪个阶段附近。
- `parallelAgents` 用于同时展示多个 Executor 的活动状态。
- `question-form-complete.content` 必须先解析标签属性，再解析标签体 JSON。
- 图谱关系的 `source` / `target` 是节点 ID，不是节点名称。
- 文档 `scoringAttempts` 包含未选中的候选稿，不要只保留 `selected: true`。
- `null` 表示“已知为空”，字段缺失表示“本响应不提供”；不要混为一谈。

---

## 13. 契约来源

本文档按以下实际代码路径汇总：

- 跨端 Schema：`packages/shared/src/`
- API 路由和 SSE：`apps/api/src/controllers/`
- API DTO / 持久化恢复：`apps/api/src/repositories/`、`apps/api/src/services/`
- Agent Runtime 事件：`apps/agent-runtime/src/types.ts`
- 产品工作流事件：`apps/agent-runtime/src/agents/product-workflow/types.ts`
- 前端消费类型与 reducer：`apps/web/src/types.ts`、`apps/web/src/utils/apply-stream-event.ts`
- 前端 API 客户端：`apps/web/src/api/`

当字段发生变更时，应同时更新 shared schema、API、Agent Runtime、前端类型/恢复逻辑和本文档。
