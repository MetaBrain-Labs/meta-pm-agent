/**
 * 前端聊天领域类型
 *
 * 定义 SSE 事件、聊天消息、工作区和历史消息恢复所需的数据结构。
 * token 用量以 Agent 单次执行为粒度记录，实时流和历史恢复共用同一结构。
 *
 * Responsibilities:
 * - 复用 shared 的 API/SSE 事件契约
 * - 定义产品工作流结构化卡片的数据模型
 * - 定义 token 用量实时展示和历史恢复字段
 *
 * Notes:
 * - 本文件仅包含类型定义，不包含运行时逻辑。
 */

import type { ChatSseEvent } from "@repo/shared";

export type StreamEvent = ChatSseEvent;

/** DeepSeek 模型使用列表中的单模型配置。 */
export interface DeepSeekModelConfig {
  provider: "deepseek";
  modelId: "deepseek-flash";
  customName: string;
  baseUrl: string;
  thinking: true;
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoningEffort: "low" | "high" | "max";
  pricing: {
    cacheHitInputPricePerMillion: number;
    cacheMissInputPricePerMillion: number;
    outputPricePerMillion: number;
  };
}

export type ModelTier = "reasoning" | "standard" | "fast";
export type AgentModelGroup =
  | "conversation"
  | "pre-orchestrator"
  | "request"
  | "orchestrator"
  | "planner"
  | "executors"
  | "critique"
  | "document";

/** 设置页和 Chat 选择器共享的模型使用列表 DTO。 */
export interface ModelUsageProfile {
  id: string;
  name: string;
  isSystem: boolean;
  config:
    | {
        mode: "tiered";
        models: Record<ModelTier, DeepSeekModelConfig>;
        assignments: Record<AgentModelGroup, ModelTier>;
      }
    | { mode: "universal"; model: DeepSeekModelConfig };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Executor 错误卡片携带的定点重试动作。
 */
export interface WorkflowRetryAction {
  type: "resume_executor_task";
  taskId: string;
  agentType: string;
}

/**
 * 浏览器提交给 API 的工作流重试命令。
 */
export type WorkflowRetryRequest = Omit<WorkflowRetryAction, "agentType">;

/**
 * LangChain HITL 中的一项待人工处理动作。
 */
export interface HumanInTheLoopActionRequest {
  name: "question_form";
  args: {
    questionForm: string;
    formId: string;
    agentType?: string;
  };
  description?: string;
}

/**
 * LangChain HITLRequest 风格的中断 payload。
 */
export interface HumanInTheLoopRequest {
  actionRequests: HumanInTheLoopActionRequest[];
  reviewConfigs: Array<{
    allowedDecisions: Array<"approve" | "reject" | "edit" | "respond">;
  }>;
}

/**
 * LangGraph interrupt 元数据，包含可恢复线程和前端渲染值。
 */
export interface HumanInTheLoopInterrupt {
  id: string;
  threadId: string;
  value: HumanInTheLoopRequest;
}

/**
 * 前端提交给 API 的 HITL 恢复命令。
 */
export interface HumanInTheLoopResume {
  threadId: string;
  response: {
    decisions: Array<
      | { type: "approve" }
      | { type: "reject"; message?: string }
      | {
          type: "edit";
          editedAction: {
            name: string;
            args: Record<string, unknown>;
          };
        }
      | { type: "respond"; message: string }
    >;
  };
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
  parallelAgents?: string[];
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
  | "orchestrator"
  | "planner"
  | "critique"
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
  status?: "initial" | "supplement";
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
  decisions: Array<{ id: string; text: string; source_task_id?: string }>;
  risks: Array<{ id: string; text: string; source_task_id?: string }>;
  open_questions: Array<{ id: string; text: string; source_task_id?: string }>;
  quality_result: {
    passed: boolean;
    notes: string;
  };
  knowledge_graph_patch?: string;
  knowledge_graph_markdown?: string;
}

export interface ProductWorkflowResult {
  status:
    | "pending_user_confirmation"
    | "requires_executor_retry"
    | "completed"
    | "discarded";
  confirmation_id: string;
  request_summary: string;
  planner: TaskExecutionPlan;
  executor_results: ExecutorAgentResult[];
  review: {
    accepted_task_ids: string[];
    rejected_task_ids: string[];
    retry_task_ids?: string[];
    issues?: Array<{
      code: string;
      severity: "error" | "warning";
      task_id?: string;
      message: string;
    }>;
    notes: string;
  };
  product_context_update: string;
  knowledge_graph_update: {
    entities: Array<Record<string, unknown>>;
    relations: Array<Record<string, unknown>>;
    decisions?: Array<Record<string, unknown>>;
    risks?: Array<Record<string, unknown>>;
    open_questions?: Array<Record<string, unknown>>;
    markdown?: string;
    notes: string[];
  };
  knowledge_graph_review?: {
    graph_ref?: {
      version?: number;
      checksum?: string;
      entity_count?: number;
      relation_count?: number;
    };
    accepted_task_ids?: string[];
    rejected_task_ids?: string[];
    retry_task_ids?: string[];
    issues?: Array<{
      code: string;
      severity: "error" | "warning";
      task_id?: string;
      message: string;
    }>;
    notes?: string[];
  };
  proposal_questions?: ProductWorkflowProposalQuestion[];
  confirmation_message: string;
}

export interface ProductWorkflowProposalQuestion {
  id: string;
  label: string;
  type: "radio" | "checkbox" | "select" | "text" | "textarea";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  maxSelections?: number;
  source_task_id?: string;
  source_agent?: ProductWorkflowAgentType;
  sources?: Array<{
    source_task_id: string;
    source_agent: ProductWorkflowAgentType;
  }>;
  priority?: number;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  type?: string | null;
  workflowRoundId?: string;
  content: string;
  thinking?: string;
  reasoningBlocks?: ReasoningBlock[];
  questionForm?: { state: "generating" | "complete"; content?: string };
  humanInterrupt?: {
    state: "pending" | "resolved";
    interrupt: HumanInTheLoopInterrupt;
  };
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
  plannerReview?: {
    state: "generating" | "complete";
    result?: ProductWorkflowResult;
  };
  workflowCompletion?: {
    state: "complete";
    content: string;
  };
  documentEvidenceResolutionComplete?: {
    runId: string;
    workspaceId: string;
  };
  executorResults?: ExecutorAgentResult[];
  activeAgent?: string;
  activeAgents?: string[];
  parallelExecutorAgents?: Record<string, string[]>;
  agentError?: {
    agentType?: string;
    message: string;
    retryAction?: WorkflowRetryAction;
  };
  /** 连接中断或服务端中止后留下的运行时标记，仅前端展示态，不入库。 */
  interrupted?: boolean;
  todos?: TodoItem[];
  toolCalls?: Array<{
    id?: string;
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
    agentType?: string;
    status?: "running" | "complete";
  }>;
  subagentTraces?: SubagentTrace[];
  usage?: Record<string, unknown>;
  tokenUsages?: TokenUsageInfo[];
  timestamp: number;
}

/**
 * Agent 工具调用展示数据，实时流和历史消息恢复共用同一结构。
 */
export type ToolCallInfo = NonNullable<Message["toolCalls"]>[number];

/**
 * Orchestrator 内嵌 SubAgent 的前端展示轨迹。
 */
export interface SubagentTrace {
  id?: string;
  parentAgentType?: string;
  subagentType: string;
  description?: string;
  thinking?: string;
  result?: unknown;
  status: "running" | "complete";
}

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
  name: string;
  localPath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedMessageInfo {
  id: string;
  role: "user" | "assistant";
  type?: string | null;
  workflowRoundId?: string;
  content: string;
  timestamp: string;
  reasoningContent?: string;
  toolCalls?: ToolCallInfo[];
  subagentTraces?: SubagentTrace[];
  agentError?: Message["agentError"];
  userInput?: Array<{ index: number; content: string; type: string }> | null;
  requestAnalysis?: RequestAnalysis | null;
  taskExecutionPlan?: TaskExecutionPlan | null;
  executorResult?: ExecutorAgentResult | null;
  executorResults?: ExecutorAgentResult[];
  productWorkflow?: ProductWorkflowResult | null;
  tokenUsages?: TokenUsageInfo[];
}
