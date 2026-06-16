import type { Message, StreamEvent } from "../types";

export function applyStreamEvent(
  message: Message,
  event: StreamEvent,
): Message {
  switch (event.type) {
    case "thinking":
      return {
        ...message,
        thinking:
          (message.thinking ?? "") + (event.content ?? ""),
      };
    case "text":
      return applyTextChunk(message, event.content ?? "");
    case "question-form-start":
      return {
        ...message,
        questionForm: { state: "generating" },
      };
    case "question-form-complete":
      return {
        ...message,
        content: removeTaggedBlock(
          message.content,
          "<question-form",
          "</question-form>",
        ),
        questionForm: {
          state: "complete",
          content: event.content,
        },
      };
    case "user-input-start":
      return {
        ...message,
        userInput: { state: "generating" },
      };
    case "user-input-complete":
      return {
        ...message,
        content: removeTaggedBlock(
          message.content,
          "<user-input",
          "</user-input>",
        ),
        userInput: {
          state: "complete",
          content: event.content,
        },
      };
    case "todo-update":
      return {
        ...message,
        todos: (event.todos ?? []).map((todo) => ({
          index: todo.index,
          content: todo.content,
          status: todo.status as
            | "pending"
            | "in_progress"
            | "completed",
        })),
      };
    case "tool-call":
      return {
        ...message,
        toolCalls: [
          ...(message.toolCalls ?? []),
          {
            name: event.toolName ?? "unknown",
            args: event.toolArgs,
          },
        ],
      };
    case "tool-result":
      return {
        ...message,
        toolCalls: (message.toolCalls ?? []).map((toolCall, index) =>
          index === (message.toolCalls?.length ?? 1) - 1
            ? { ...toolCall, result: event.toolResult }
            : toolCall,
        ),
      };
    case "finish":
      return { ...message, usage: event.usage };
    case "error":
      return {
        ...message,
        content:
          message.content +
          `\n[Error: ${JSON.stringify(event.error)}]`,
      };
    default:
      return message;
  }
}

function applyTextChunk(
  message: Message,
  chunk: string,
): Message {
  const content = message.content + chunk;
  const questionForm = extractTaggedBlock(
    content,
    "<question-form",
    "</question-form>",
  );

  if (questionForm) {
    return {
      ...message,
      content: questionForm.remainingText,
      questionForm: {
        state: "complete",
        content: questionForm.block,
      },
    };
  }

  const userInput = extractTaggedBlock(
    content,
    "<user-input",
    "</user-input>",
  );

  if (userInput) {
    return {
      ...message,
      content: userInput.remainingText,
      userInput: {
        state: "complete",
        content: userInput.block,
      },
    };
  }

  return { ...message, content };
}

function removeTaggedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string {
  return extractTaggedBlock(content, startMarker, endMarker)
    ?.remainingText ?? content;
}

function extractTaggedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): { block: string; remainingText: string } | null {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = content.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    return null;
  }

  const blockEnd = endIndex + endMarker.length;
  return {
    block: content.slice(startIndex, blockEnd),
    remainingText:
      content.slice(0, startIndex) + content.slice(blockEnd),
  };
}
