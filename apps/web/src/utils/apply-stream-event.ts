import type { Message, StreamEvent } from "../types";

export function applyStreamEvent(
  message: Message,
  event: StreamEvent,
): Message {
  switch (event.type) {
    case "thinking":
      if (event.agentType && event.agentType !== "conversation") {
        return appendReasoningBlock(
          message,
          event.agentType,
          event.content ?? "",
        );
      }

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
    case "request-analysis-start":
      return {
        ...message,
        requestAnalysis: { state: "generating" },
      };
    case "request-analysis-complete":
      // Request Agent 结果用独立卡片展示，因此从普通正文里移除 tagged block。
      return {
        ...message,
        content: removeTaggedBlock(
          message.content,
          "<request-analysis",
          "</request-analysis>",
        ),
        requestAnalysis: {
          state: "complete",
          content: event.content,
          analysis: event.analysis,
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
        toolCalls: attachToolResult(
          message.toolCalls ?? [],
          event.toolName ?? "unknown",
          event.toolResult,
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

/**
 * 将指定 Agent 的推理过程追加到对应阶段，后续渲染时可放在业务卡片附近。
 */
function appendReasoningBlock(
  message: Message,
  agentType: string,
  content: string,
): Message {
  if (!content) return message;

  const blocks = message.reasoningBlocks ?? [];
  const existingIndex = blocks.findIndex(
    (block) => block.agentType === agentType,
  );

  if (existingIndex === -1) {
    return {
      ...message,
      reasoningBlocks: [...blocks, { agentType, content }],
    };
  }

  return {
    ...message,
    reasoningBlocks: blocks.map((block, index) =>
      index === existingIndex
        ? { ...block, content: block.content + content }
        : block,
    ),
  };
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

  const requestAnalysis = extractTaggedBlock(
    content,
    "<request-analysis",
    "</request-analysis>",
  );

  if (requestAnalysis) {
    // 兼容模型直接把完整 block 当 text chunk 输出的情况。
    return {
      ...message,
      content: requestAnalysis.remainingText,
      requestAnalysis: {
        state: "complete",
        content: requestAnalysis.block,
      },
    };
  }

  return { ...message, content };
}

/**
 * 将工具结果挂到最近一次同名未完成调用上，避免多工具连续调用时结果错位。
 */
function attachToolResult(
  toolCalls: NonNullable<Message["toolCalls"]>,
  toolName: string,
  toolResult: unknown,
): NonNullable<Message["toolCalls"]> {
  const targetIndex = findPendingToolCallIndex(toolCalls, toolName);

  if (targetIndex === -1) {
    return [...toolCalls, { name: toolName, result: toolResult }];
  }

  return toolCalls.map((toolCall, index) =>
    index === targetIndex ? { ...toolCall, result: toolResult } : toolCall,
  );
}

/**
 * 从后往前查找同名未完成工具调用，兼容当前前端 TypeScript lib 配置。
 */
function findPendingToolCallIndex(
  toolCalls: NonNullable<Message["toolCalls"]>,
  toolName: string,
): number {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const toolCall = toolCalls[index];
    if (
      toolCall?.name === toolName &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      return index;
    }
  }

  return -1;
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
