/**
 * Agent Runtime 公共流事件类型定义
 *
 * 定义 Conversation Agent SSE 流中的所有事件形态，包括文本/推理切片、
 * 工具调用/结果、标记块生命周期（question-form、user-input、request-analysis）、
 * todo-update 以及流开始/结束事件。
 *
 * Responsibilities:
 * - 定义 StreamChunk、ConversationStreamEvent 等基础流事件类型
 * - 定义 ConversationStreamOptions 流配置类型
 * - 统一 AgentMessageType，标识流内容归属的 Agent
 *
 * Notes:
 * - 本文件仅定义类型，不包含运行时逻辑
 */

import type { RequestAnalysis } from "@repo/shared";
import type {
  AgentRuntimeTool,
  OrchestratorContextSource,
  ProductWorkflowResult,
  ProductKnowledgeGraph,
  ModelUsageProfile,
  WorkflowRetryAction,
  WorkflowRetryRequest,
} from "@repo/shared";
import type { HumanInTheLoopInterrupt } from "./graph/human-in-the-loop";

/**
 * 标识当前流式内容所属的 Agent，便于 API 持久化和前端按阶段展示。
 */
export type AgentMessageType = "conversation" | "request" | (string & {});

/**
 * 基础流切片
 */
export interface StreamChunk {
  type: "reasoning" | "text";
  content: string;
  agentType?: AgentMessageType;
}

/**
 * SSE事件
 * 目前包含以下类型：
 * - text：普通文本内容
 * - reasoning：推理内容，包含在 content 中
 * - question-form-start：表示一个问题表单的开始
 * - question-form-complete：表示一个问题表单的完成，content 包含表单内容
 * - user-input-start：表示用户输入的开始
 * - user-input-complete：表示用户输入的完成，content 包含用户输入内容
 * - request-analysis-start：表示请求分析的开始
 * - request-analysis-complete：表示请求分析的完成，content 包含分析结果文本，analysis 包含结构化分析结果
 */
export type ConversationStreamEvent =
  | StreamChunk
  | {
      type: "workflow-round-start";
      roundId: string;
    }
  | {
      type: "agent-status";
      agentType: AgentMessageType;
      status: "started" | "completed";
      phase?: "planning" | "execution" | "review";
      parallelAgents?: AgentMessageType[];
      taskId?: string;
    }
  | {
      type: "tool-call";
      toolCallId?: string;
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType?: AgentMessageType;
    }
  | {
      type: "tool-result";
      toolCallId?: string;
      toolName: string;
      toolResult: unknown;
      agentType?: AgentMessageType;
    }
  | {
      type: "subagent-start";
      agentType: AgentMessageType;
      subagentType: string;
      toolCallId?: string;
      description?: string;
    }
  | {
      type: "subagent-thinking";
      agentType: AgentMessageType;
      subagentType: string;
      toolCallId?: string;
      content: string;
    }
  | {
      type: "subagent-result";
      agentType: AgentMessageType;
      subagentType: string;
      toolCallId?: string;
      result: unknown;
    }
  | { type: "question-form-start"; agentType?: AgentMessageType }
  | { type: "question-form-complete"; content: string; agentType?: AgentMessageType }
  | { type: "workflow-resume-start"; agentType?: AgentMessageType }
  | { type: "workflow-resume-complete"; content: string; agentType?: AgentMessageType }
  | {
      type: "human-interrupt";
      interrupt: HumanInTheLoopInterrupt;
      agentType?: AgentMessageType;
    }
  | { type: "user-input-start" }
  | { type: "user-input-complete"; content: string }
  | { type: "request-analysis-start"; agentType?: AgentMessageType }
  | {
      type: "request-analysis-complete";
      content: string;
      analysis: RequestAnalysis;
      agentType?: AgentMessageType;
    }
  | {
      type: "token-usage";
      agentType: AgentMessageType;
      inputTokens: number;
      cacheHitInputTokens: number;
      cacheMissInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costInput: number;
      costOutput: number;
      costTotal: number;
      durationMs: number;
      parallelAgents?: AgentMessageType[];
    }
  | {
      type: "error";
      error: string;
      agentType?: AgentMessageType;
      retryAction?: WorkflowRetryAction;
      terminal?: boolean;
    }
  | { type: "complete"; result: ProductWorkflowResult }
  | { type: "knowledge-graph-update"; knowledgeGraph: ProductKnowledgeGraph };

/**
 * 会话流选项
 */
export interface ConversationStreamOptions {
  enabledTools?: AgentRuntimeTool[];
  workspaceId?: string;
  requestFormId?: string;
  workflowThreadId?: string;
  productContext?: string;
  contextSource?: OrchestratorContextSource;
  knowledgeGraph?: ProductKnowledgeGraph | null;
  /** API 在 SSE 开始前解析的不可变模型使用列表快照。 */
  modelProfile?: ModelUsageProfile;
  workflowAnswerResolution?: WorkflowAnswerResolution | null;
  workflowRetry?: WorkflowRetryRequest;
  /** API 从持久化错误中恢复的可信重试上下文，不属于客户端请求契约。 */
  workflowRetryFailure?: {
    taskId: string;
    error: string;
  };
  signal?: AbortSignal;
  /** "chat" 模式使用纯闲聊提示词，不产生标记块或表单 */
  mode?: "project" | "chat";
}

/**
 * 当前 Question Form 字段与其 OpenQuestion 来源的对应关系。
 */
export interface WorkflowAnswerResolution {
  formId: string;
  questions: Array<{
    label: string;
    answered: boolean;
    sources: Array<{
      source_task_id: string;
      source_agent: string;
      open_question_id?: string;
    }>;
  }>;
}
