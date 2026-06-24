/**
 * 前端聊天领域类型
 *
 * 定义 SSE 事件、聊天消息、工作区和历史消息恢复所需的数据结构。
 * token 用量以 Agent 单次执行为粒度记录，实时流和历史恢复共用同一结构。
 *
 * Responsibilities:
 * - 描述 API/SSE 与前端状态之间的类型契约
 * - 定义产品工作流结构化卡片的数据模型
 * - 定义 token 用量实时展示和历史恢复字段
 *
 * Notes:
 * - 本文件仅包含类型定义，不包含运行时逻辑。
 */

export type StreamEventType =
  | "start"
  | "thinking"
  | "thinking-done"
  | "text"
  | "question-form-start"
  | "question-form-complete"
  | "user-input-start"
  | "user-input-complete"
  | "request-analysis-start"
  | "request-analysis-complete"
  | "todo-update"
  | "tool-call"
  | "tool-result"
  | "token-usage"
  | "conversation-title"
  | "step-finish"
  | "finish"
  | "error"
  | "abort";

export interface StreamEvent {
  type: StreamEventType;
  id?: string;
  content?: string;
  agentType?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  usage?: Record<string, unknown>;
  inputTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costInput?: number;
  costOutput?: number;
  costTotal?: number;
  durationMs?: number;
  createdAt?: string;
  error?: unknown;
  chatId?: string;
  title?: string;
  todos?: Array<{ index: number; content: string; status: string }>;
  analysis?: RequestAnalysis;
}

export interface TokenUsageInfo {
  id?: string;
  conversationId?: string;
  messageId?: string;
  agentType: string;
  inputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  durationMs: number;
  createdAt?: string;
}

export interface TodoItem {
  index: number;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface UserInputItem {
  index: number;
  content: string;
  type: "陈述" | "提问" | "补充" | "请求";
}

export interface MissingInformation {
  index: number;
  description: string;
  importance: number;
}

export interface BusinessModelItem {
  index: number;
  user_goal: string;
  goal_constraints: string[];
  missing_information: MissingInformation[];
  covered_user_input_indexes: number[];
}

export interface RequestAnalysis {
  business_model: BusinessModelItem[];
  questions: number[];
  chitchat: number[];
}

export type ProductWorkflowAgentType =
  | "product_director"
  | "planner"
  | "executor-product-strategy"
  | "executor-market-research"
  | "executor-gtm"
  | "executor-product-discovery"
  | "executor-product-execution"
  | "executor-marketing-growth"
  | "executor-data-analytics"
  | "executor-ai-shipping"
  | "executor-toolkit"
  | "executor-interface-craft"
  | string;

export interface TaskExecutionNode {
  task_id: string;
  sequence: number;
  title: string;
  description: string;
  assigned_agent: ProductWorkflowAgentType;
  depends_on: string[];
  covered_business_model_indexes: number[];
  expected_output: string;
  quality_check: {
    status: "pending" | "passed" | "failed";
    criteria: string[];
    result?: string;
  };
}

export interface TaskExecutionPlan {
  request_summary: string;
  dag: {
    nodes: string[];
    edges: Array<{ source: string; target: string }>;
  };
  tasks: TaskExecutionNode[];
  assumptions: string[];
}

export interface ExecutorAgentResult {
  task_id: string;
  agent_type: ProductWorkflowAgentType;
  focus_layer: string;
  summary: string;
  entities: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  decisions: string[];
  risks: string[];
  open_questions: string[];
  quality_result: {
    passed: boolean;
    notes: string;
  };
  knowledge_graph_patch?: string;
  knowledge_graph_markdown?: string;
}

export interface ProductWorkflowResult {
  status: "pending_user_confirmation" | "completed" | "discarded";
  confirmation_id: string;
  request_summary: string;
  planner: TaskExecutionPlan;
  executor_results: ExecutorAgentResult[];
  review: {
    accepted_task_ids: string[];
    rejected_task_ids: string[];
    notes: string;
  };
  product_context_update: string;
  knowledge_graph_update: {
    entities: Array<Record<string, unknown>>;
    relations: Array<Record<string, unknown>>;
    markdown?: string;
    notes: string[];
  };
  confirmation_message: string;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  type?: string | null;
  content: string;
  thinking?: string;
  reasoningBlocks?: ReasoningBlock[];
  questionForm?: { state: "generating" | "complete"; content?: string };
  userInput?: { state: "generating" | "complete"; content?: string };
  requestAnalysis?: {
    state: "generating" | "complete";
    content?: string;
    analysis?: RequestAnalysis;
  };
  plannerExecution?: {
    state: "complete";
    content?: string;
    plan: TaskExecutionPlan;
  };
  executorResults?: ExecutorAgentResult[];
  activeAgent?: string;
  agentError?: {
    agentType?: string;
    message: string;
  };
  todos?: TodoItem[];
  toolCalls?: Array<{
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
    agentType?: string;
  }>;
  usage?: Record<string, unknown>;
  tokenUsages?: TokenUsageInfo[];
  timestamp: number;
}

/**
 * Agent 工具调用展示数据，实时流和历史消息恢复共用同一结构。
 */
export type ToolCallInfo = NonNullable<Message["toolCalls"]>[number];

/**
 * 按 Agent 阶段记录推理过程，便于在对应业务卡片附近展示。
 */
export interface ReasoningBlock {
  agentType: string;
  content: string;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export interface ThreadInfo {
  id: string;
  workspaceId: string;
  requestFormId?: string;
  title: string;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInfo {
  id: string;
  userId: string;
  name: string;
  storageType?: string | null;
  localPath?: string | null;
  cloudPath?: string | null;
  syncStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountInfo {
  id: string;
  email?: string | null;
  username?: string | null;
  avatar?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PersistedMessageInfo {
  id: string;
  role: "user" | "assistant";
  type?: string | null;
  content: string;
  timestamp: string;
  reasoningContent?: string;
  toolCalls?: ToolCallInfo[];
  userInput?: Array<{ index: number; content: string; type: string }> | null;
  requestAnalysis?: RequestAnalysis | null;
  taskExecutionPlan?: TaskExecutionPlan | null;
  executorResult?: ExecutorAgentResult | null;
  executorResults?: ExecutorAgentResult[];
  productWorkflow?: ProductWorkflowResult | null;
  tokenUsages?: TokenUsageInfo[];
}
