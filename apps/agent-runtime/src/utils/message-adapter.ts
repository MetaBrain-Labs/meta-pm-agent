import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "langchain";
import type { ChatMessage } from "@repo/shared";

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

export function getReasoningContent(message: BaseMessage): string {
  const reasoning = message.additional_kwargs?.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

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
