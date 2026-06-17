import type { RequestAnalysis } from "@repo/shared";

/**
 * 基础流切片
 */
export interface StreamChunk {
  type: "reasoning" | "text";
  content: string;
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
  | { type: "question-form-start" }
  | { type: "question-form-complete"; content: string }
  | { type: "user-input-start" }
  | { type: "user-input-complete"; content: string }
  | { type: "request-analysis-start" }
  | {
      type: "request-analysis-complete";
      content: string;
      analysis: RequestAnalysis;
    };

/**
 * 会话流选项
 */
export interface ConversationStreamOptions {
  productContext?: string;
}
