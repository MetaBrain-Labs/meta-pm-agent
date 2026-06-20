import type { Message, PersistedMessageInfo } from "../types";

/**
 * 将后端持久化消息恢复成前端流式渲染组件可直接消费的消息结构。
 */
export function mapPersistedMessageToMessage(
  message: PersistedMessageInfo,
): Message {
  return {
    id: message.id,
    role: message.role === "assistant" ? "agent" : "user",
    type: message.type,
    content: message.content,
    timestamp: new Date(message.timestamp).getTime(),
    ...(message.reasoningContent &&
    message.type &&
    message.type !== "conversation"
      ? {
          reasoningBlocks: [
            {
              agentType: message.type,
              content: message.reasoningContent,
            },
          ],
        }
      : {}),
    ...(message.reasoningContent &&
    (!message.type || message.type === "conversation")
      ? { thinking: message.reasoningContent }
      : {}),
    ...(message.toolCalls && message.toolCalls.length > 0
      ? { toolCalls: message.toolCalls }
      : {}),
    ...(message.userInput
      ? {
          userInput: {
            state: "complete" as const,
            content: JSON.stringify(
              { user_input: message.userInput },
              null,
              2,
            ),
          },
        }
      : {}),
    // 历史消息从 API 返回结构化结果后，恢复成和流式事件一致的卡片状态。
    ...(message.requestAnalysis
      ? {
          requestAnalysis: {
            state: "complete" as const,
            content: JSON.stringify(message.requestAnalysis, null, 2),
            analysis: message.requestAnalysis,
          },
        }
      : {}),
  };
}
