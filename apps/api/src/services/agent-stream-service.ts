import type { ConversationStreamEvent } from "@repo/agent-runtime";

/**
 * 将 Agent 运行时的流式事件转换为 API 层 SSE 事件格式。
 * reasoning 类型的事件重命名为 thinking，其他类型透传。
 */
export function toApiEvent(event: ConversationStreamEvent) {
  if (event.type === "reasoning") {
    return {
      type: "thinking" as const,
      content: event.content,
    };
  }

  return event;
}
