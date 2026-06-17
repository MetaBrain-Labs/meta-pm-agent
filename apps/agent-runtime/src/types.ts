import type { RequestAnalysis } from "@repo/shared";

/**
 * 流切片
 */
export interface StreamChunk {
  type: "reasoning" | "text";
  content: string;
}

/**
 * SSE事件
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
