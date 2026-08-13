/**
 * Agent 运行时事件转换
 *
 * 将 agent-runtime 的内部流事件转换为浏览器 SSE 可消费的事件格式。
 * 当前只把 reasoning 重命名为 thinking，其余事件保持结构透传，确保前端能接收
 * Agent 运行状态、工具调用、token 用量和知识图谱更新等扩展事件。
 *
 * Responsibilities:
 * - 保持 API 层 SSE 事件命名兼容前端
 * - 透传 agentType、工具调用 ID 和并行批次元数据
 * - 避免在 API 边界改变运行时业务语义
 */

import type { ConversationStreamEvent } from "@repo/agent-runtime";
import { ChatSseEventSchema, type ChatSseEvent } from "@repo/shared";

/**
 * 将 Agent 运行时的流式事件转换为 API 层 SSE 事件格式。
 * reasoning 类型的事件重命名为 thinking，其他类型透传。
 */
export function toApiEvent(event: ConversationStreamEvent): ChatSseEvent | null {
  if (event.type === "reasoning") {
    return {
      type: "thinking" as const,
      content: event.content,
      agentType: event.agentType,
    };
  }

  if (
    event.type === "complete" ||
    event.type === "knowledge-graph-update" ||
    event.type === "document-evidence-resolution-plan"
  ) {
    return null;
  }

  return ChatSseEventSchema.parse(event);
}
