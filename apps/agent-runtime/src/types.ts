import type { RequestAnalysis } from "@repo/shared";
import type { AgentRuntimeTool } from "@repo/shared";

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
      type: "tool-call";
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType?: AgentMessageType;
    }
  | {
      type: "tool-result";
      toolName: string;
      toolResult: unknown;
      agentType?: AgentMessageType;
    }
  | { type: "question-form-start"; agentType?: AgentMessageType }
  | { type: "question-form-complete"; content: string; agentType?: AgentMessageType }
  | { type: "user-input-start" }
  | { type: "user-input-complete"; content: string }
  | { type: "request-analysis-start"; agentType?: AgentMessageType }
  | {
      type: "request-analysis-complete";
      content: string;
      analysis: RequestAnalysis;
      agentType?: AgentMessageType;
    }
  | { type: "error"; error: string; agentType?: AgentMessageType };

/**
 * 会话流选项
 */
export interface ConversationStreamOptions {
  enabledTools?: AgentRuntimeTool[];
  productContext?: string;
  signal?: AbortSignal;
}
