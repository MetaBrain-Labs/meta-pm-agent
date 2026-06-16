import type { ConversationStreamEvent } from "@repo/agent-runtime";

export function toApiEvent(event: ConversationStreamEvent) {
  if (event.type === "reasoning") {
    return {
      type: "thinking" as const,
      content: event.content,
    };
  }

  return event;
}
