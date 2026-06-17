import { AIMessage, HumanMessage, type BaseMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";

/**
 * 将 ChatMessage 转换为 LangChain 官方推荐并自带的 HumanMessage 或 AIMessage。
 * 如果 ChatMessage 中包含 reasoningContent，则将其作为 additional_kwargs 的 reasoning_content 属性传递给 AIMessage。
 */
export function toLangChainMessages(
  messages: ChatMessage[],
): Array<HumanMessage | AIMessage> {
  return messages.map((message) => {
    if (message.role === "user") {
      return new HumanMessage(message.content);
    }

    return new AIMessage({
      content: message.content,
      ...(message.reasoningContent
        ? {
            additional_kwargs: {
              reasoning_content: message.reasoningContent,
            },
          }
        : {}),
    });
  });
}

/**
 * 从 message 中获取推理内容
 */
export function getReasoningContent(message: BaseMessage): string {
  const reasoning = message.additional_kwargs?.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

/**
 * 从 message 中获取文本内容
 */
export function getTextContent(message: BaseMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}
