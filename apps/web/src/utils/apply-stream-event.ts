/**
 * 聊天流事件 reducer
 *
 * 将 API SSE 事件增量应用到当前助手消息，保持正文、推理、工具调用、
 * 结构化业务卡片和 token 用量展示的状态一致。
 *
 * Responsibilities:
 * - 合并流式文本和推理内容
 * - 维护工具调用、表单、分析和产品工作流卡片状态
 * - 追加每个 Agent 结束时产生的 token 用量记录
 *
 * Notes:
 * - 本工具不发起网络请求，只做前端状态转换。
 */

import type {
  ExecutorAgentResult,
  Message,
  ProductWorkflowResult,
  StreamEvent,
  TaskExecutionPlan,
  TokenUsageInfo,
} from "../types";

export function applyStreamEvent(
  message: Message,
  event: StreamEvent,
): Message {
  switch (event.type) {
    case "agent-status":
      return applyAgentStatus(message, event);
    case "thinking":
      if (event.agentType && event.agentType !== "conversation") {
        return {
          ...appendReasoningBlock(
            message,
            event.agentType,
            event.content ?? "",
          ),
          activeAgent: event.agentType,
          activeAgents: addActiveAgent(message.activeAgents, event.agentType),
        };
      }

      return {
        ...message,
        thinking:
          (message.thinking ?? "") + (event.content ?? ""),
        activeAgent: event.agentType ?? "conversation",
        activeAgents: addActiveAgent(
          message.activeAgents,
          event.agentType ?? "conversation",
        ),
      };
    case "text":
      return applyTextChunk(message, event);
    case "question-form-start":
      return {
        ...message,
        activeAgent: event.agentType ?? "conversation",
        activeAgents: addActiveAgent(
          message.activeAgents,
          event.agentType ?? "conversation",
        ),
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
        activeAgent: undefined,
        activeAgents: removeActiveAgent(
          message.activeAgents,
          event.agentType ?? "conversation",
        ),
        questionForm: {
          state: "complete",
          content: event.content,
        },
      };
    case "human-interrupt":
      if (!event.interrupt) return message;
      return {
        ...message,
        activeAgent: undefined,
        activeAgents: removeActiveAgent(
          message.activeAgents,
          event.agentType ?? "conversation",
        ),
        humanInterrupt: {
          state: "pending",
          interrupt: event.interrupt,
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
        activeAgent:
          message.activeAgent === "conversation" ? undefined : message.activeAgent,
        activeAgents: removeActiveAgent(message.activeAgents, "conversation"),
        userInput: {
          state: "complete",
          content: event.content,
        },
      };
    case "request-analysis-start":
      return {
        ...message,
        activeAgent: event.agentType ?? "request",
        activeAgents: addActiveAgent(
          message.activeAgents,
          event.agentType ?? "request",
        ),
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
        activeAgent: undefined,
        activeAgents: removeActiveAgent(
          message.activeAgents,
          event.agentType ?? "request",
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
      return appendToolCall(message, event);
    case "tool-result":
      return {
        ...message,
        toolCalls: attachToolResult(
          message.toolCalls ?? [],
          event.toolCallId,
          event.toolName ?? "unknown",
          event.toolResult,
          event.agentType,
        ),
      };
    case "token-usage":
      return appendTokenUsage(message, event);
    case "finish":
      return {
        ...message,
        usage: event.usage,
        activeAgent: undefined,
        activeAgents: [],
      };
    case "error":
      {
        const failedAgentType = event.agentType ?? message.activeAgent;
        const requestAnalysis =
          failedAgentType === "request" &&
          message.requestAnalysis?.state === "generating"
            ? undefined
            : message.requestAnalysis;

        return {
          ...message,
          activeAgent: undefined,
          activeAgents: removeActiveAgent(
            message.activeAgents,
            failedAgentType,
          ),
          requestAnalysis,
          agentError: {
            agentType: failedAgentType,
            message: normalizeErrorMessage(event.error),
          },
        };
      }
    default:
      return message;
  }
}

/**
 * 将单个 Agent 的 token 用量追加到消息上，按记录 ID 去重以兼容流重放。
 */
function appendTokenUsage(
  message: Message,
  event: StreamEvent,
): Message {
  if (!event.agentType || typeof event.totalTokens !== "number") {
    return message;
  }

  const usage: TokenUsageInfo = {
    id: event.id,
    agentType: event.agentType,
    inputTokens: event.inputTokens ?? 0,
    cacheHitInputTokens: event.cacheHitInputTokens ?? 0,
    cacheMissInputTokens: event.cacheMissInputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    totalTokens: event.totalTokens,
    costInput: event.costInput ?? 0,
    costOutput: event.costOutput ?? 0,
    costTotal: event.costTotal ?? 0,
    durationMs: event.durationMs ?? 0,
    createdAt: event.createdAt,
    parallelAgents:
      event.parallelAgents ??
      message.parallelExecutorAgents?.[event.agentType],
  };

  const existing = message.tokenUsages ?? [];
  const sameRecordIndex = existing.findIndex((item) =>
    usage.id
      ? item.id === usage.id
      : item.agentType === usage.agentType &&
        item.createdAt === usage.createdAt,
  );

  return {
    ...message,
    tokenUsages:
      sameRecordIndex === -1
        ? [...existing, usage]
        : existing.map((item, index) =>
            index === sameRecordIndex ? usage : item,
          ),
  };
}

/**
 * 应用 Agent 显式运行状态，避免只依赖推理文本驱动加载态。
 */
function applyAgentStatus(message: Message, event: StreamEvent): Message {
  if (!event.agentType || !event.status) return message;

  if (event.status === "started") {
    return {
      ...message,
      activeAgent: event.agentType,
      activeAgents: addActiveAgent(message.activeAgents, event.agentType),
      parallelExecutorAgents: rememberParallelExecutors(message, event),
      ...(event.agentType === "planner" && event.phase === "review"
        ? { plannerReview: { state: "generating" as const } }
        : {}),
    };
  }

  return {
    ...message,
    activeAgent:
      message.activeAgent === event.agentType ? undefined : message.activeAgent,
    activeAgents: removeActiveAgent(message.activeAgents, event.agentType),
    toolCalls: markAgentToolsComplete(message.toolCalls ?? [], event.agentType),
    ...(event.agentType === "planner" && event.phase === "review"
      ? { plannerReview: { state: "complete" as const } }
      : {}),
  };
}

/**
 * 记录本轮并行 Executor 批次，供稍后到达的 token 用量事件补充 tooltip。
 */
function rememberParallelExecutors(
  message: Message,
  event: StreamEvent,
): Message["parallelExecutorAgents"] {
  if (
    !event.parallelAgents ||
    event.parallelAgents.length <= 1 ||
    !event.agentType
  ) {
    return message.parallelExecutorAgents;
  }

  return {
    ...(message.parallelExecutorAgents ?? {}),
    [event.agentType]: event.parallelAgents,
  };
}

/**
 * 将 SSE 错误负载转换为简洁可展示的文本。
 */
function normalizeErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
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

/**
 * 将 Agent 加入当前运行集合，供并行 Executor 展示使用。
 */
function addActiveAgent(
  activeAgents: string[] | undefined,
  agentType: string,
): string[] {
  return [...new Set([...(activeAgents ?? []), agentType])];
}

/**
 * 追加工具调用并按 toolCallId 去重，避免同一工具调用流片段被重复展示。
 */
function appendToolCall(message: Message, event: StreamEvent): Message {
  const nextToolCall = {
    id: event.toolCallId,
    name: event.toolName ?? "unknown",
    args: event.toolArgs,
    agentType: event.agentType,
    status: "running" as const,
  };
  const existing = message.toolCalls ?? [];
  const existingIndex = findExistingToolCallIndex(existing, nextToolCall);

  return {
    ...message,
    toolCalls:
      existingIndex === -1
        ? [...existing, nextToolCall]
        : existing.map((toolCall, index) =>
            index === existingIndex ? { ...toolCall, ...nextToolCall } : toolCall,
          ),
  };
}

/**
 * 优先按工具调用 ID 去重；缺少 ID 时用同名同 Agent 的未完成调用兜底。
 */
function findExistingToolCallIndex(
  toolCalls: NonNullable<Message["toolCalls"]>,
  nextToolCall: NonNullable<Message["toolCalls"]>[number],
): number {
  if (nextToolCall.id) {
    const index = toolCalls.findIndex((toolCall) => toolCall.id === nextToolCall.id);
    if (index !== -1) return index;
  }

  return findPendingToolCallIndex(
    toolCalls,
    undefined,
    nextToolCall.name,
    nextToolCall.agentType,
  );
}

/**
 * 从当前运行集合移除已完成或失败的 Agent。
 */
function removeActiveAgent(
  activeAgents: string[] | undefined,
  agentType?: string,
): string[] {
  if (!agentType) return activeAgents ?? [];
  return (activeAgents ?? []).filter((item) => item !== agentType);
}

function applyTextChunk(
  message: Message,
  event: StreamEvent,
): Message {
  const chunk = event.content ?? "";
  if (isWorkflowCompletionText(event)) {
    return {
      ...message,
      workflowCompletion: {
        state: "complete",
        content: chunk,
      },
    };
  }

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

  const taskExecution = extractTaggedBlock(
    content,
    "<task-execution",
    "</task-execution>",
  );

  if (taskExecution) {
    const plan = parseJsonFromTaggedBlock<TaskExecutionPlan>(
      taskExecution.block,
      "<task-execution",
      "</task-execution>",
    );
    return {
      ...message,
      content: taskExecution.remainingText,
      ...(plan
        ? {
            plannerExecution: {
              state: "complete" as const,
              content: taskExecution.block,
              plan,
            },
          }
        : {}),
    };
  }

  const executorResult = extractTaggedBlock(
    content,
    "<executor-result",
    "</executor-result>",
  );

  if (executorResult) {
    const result = parseJsonFromTaggedBlock<ExecutorAgentResult>(
      executorResult.block,
      "<executor-result",
      "</executor-result>",
    );
    return {
      ...message,
      content: executorResult.remainingText,
      ...(result
        ? {
            activeAgent:
              message.activeAgent === result.agent_type
                ? undefined
                : message.activeAgent,
            activeAgents: removeActiveAgent(
              message.activeAgents,
              result.agent_type,
            ),
            executorResults: upsertExecutorResult(
              message.executorResults ?? [],
              result,
            ),
          }
        : {}),
    };
  }

  const productWorkflow = extractTaggedBlock(
    content,
    "<product-workflow",
    "</product-workflow>",
  );

  if (productWorkflow) {
    const result = parseJsonFromTaggedBlock<ProductWorkflowResult>(
      productWorkflow.block,
      "<product-workflow",
      "</product-workflow>",
    );
    return {
      ...message,
      content: productWorkflow.remainingText,
      ...(result
        ? {
            activeAgent: undefined,
            activeAgents: [],
            executorResults: result.executor_results,
            plannerReview: { state: "complete" as const },
          }
        : {}),
    };
  }

  return { ...message, content };
}

/**
 * 根据 task_id 合并 Executor 结果，驱动 Planner DAG 卡片中的节点状态变化。
 */
function upsertExecutorResult(
  results: ExecutorAgentResult[],
  next: ExecutorAgentResult,
): ExecutorAgentResult[] {
  const existingIndex = results.findIndex(
    (item) => item.task_id === next.task_id,
  );
  if (existingIndex === -1) return [...results, next];

  return results.map((item, index) =>
    index === existingIndex ? next : item,
  );
}

/**
 * 从 tagged block 中解析 JSON 负载。
 */
function parseJsonFromTaggedBlock<T>(
  block: string,
  startMarker: string,
  endMarker: string,
): T | null {
  const startIndex = block.search(new RegExp(escapeRegExp(startMarker), "i"));
  if (startIndex === -1) return null;

  const openEnd = block.indexOf(">", startIndex);
  const endIndex = block.indexOf(endMarker, openEnd + 1);
  if (openEnd === -1 || endIndex === -1) return null;

  try {
    return JSON.parse(block.slice(openEnd + 1, endIndex).trim()) as T;
  } catch {
    return null;
  }
}

/**
 * 转义正则特殊字符。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 将工具结果挂到最近一次同名未完成调用上，避免多工具连续调用时结果错位。
 */
function attachToolResult(
  toolCalls: NonNullable<Message["toolCalls"]>,
  toolCallId: string | undefined,
  toolName: string,
  toolResult: unknown,
  agentType?: string,
): NonNullable<Message["toolCalls"]> {
  const targetIndex = findPendingToolCallIndex(
    toolCalls,
    toolCallId,
    toolName,
    agentType,
  );

  if (targetIndex === -1) {
    return [
      ...toolCalls,
      {
        id: toolCallId,
        name: toolName,
        result: toolResult,
        agentType,
        status: "complete",
      },
    ];
  }

  return toolCalls.map((toolCall, index) =>
    index === targetIndex
      ? { ...toolCall, result: toolResult, status: "complete" }
      : toolCall,
  );
}

/**
 * 从后往前查找同名未完成工具调用，兼容当前前端 TypeScript lib 配置。
 */
function findPendingToolCallIndex(
  toolCalls: NonNullable<Message["toolCalls"]>,
  toolCallId: string | undefined,
  toolName: string,
  agentType?: string,
): number {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const toolCall = toolCalls[index];
    if (
      toolCallId &&
      toolCall?.id === toolCallId &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      return index;
    }
    if (
      toolCall?.name === toolName &&
      (!agentType || !toolCall.agentType || toolCall.agentType === agentType) &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      return index;
    }
  }

  return -1;
}

/**
 * Agent 完成时收敛未返回独立结果的工具调用，防止 UI 一直显示加载中。
 */
function markAgentToolsComplete(
  toolCalls: NonNullable<Message["toolCalls"]>,
  agentType: string,
): NonNullable<Message["toolCalls"]> {
  return toolCalls.map((toolCall) =>
    toolCall.agentType === agentType &&
    !Object.prototype.hasOwnProperty.call(toolCall, "result")
      ? { ...toolCall, status: "complete" as const }
      : toolCall,
  );
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

/**
 * 判断是否为产品工作流最终完成提示，用于渲染独立完成卡片。
 */
function isWorkflowCompletionText(event: StreamEvent): boolean {
  return (
    event.agentType === "conversation_confirmation" &&
    typeof event.content === "string" &&
    event.content.includes("本轮产品工作流已正式结束")
  );
}
