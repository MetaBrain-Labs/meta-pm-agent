/**
 * 带 SubAgent 的 Agent 专用执行器
 *
 * 为需要显式委派同步 SubAgent 的 DeepAgent 提供独立运行封装，负责创建
 * 带 task 工具权限的 Agent、追踪 SubAgent 调用、转发子代理事件，并解析最终 JSON 输出。
 *
 * Responsibilities:
 * - runAgentWithSubagent()：创建并驱动携带 SubAgent 的 DeepAgent
 * - 将 task 工具调用转换为 subagent-start/subagent-thinking/subagent-result 事件
 * - 解析最终 JSON 输出并在失败时使用确定性 fallback
 *
 * Notes:
 * - 该执行器服务 Orchestrator 这类明确需要子代理委派的 Agent。
 * - 普通结构化 Agent 应继续使用 runJsonAgent，不应通过本执行器引入 task 工具。
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type StructuredTool,
} from "langchain";
import { createDeepAgent, type SubAgent } from "deepagents";
import { calculateCost } from "../../config";
import { parseJsonObject } from "../../utils/json";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
} from "../../utils/message-adapter";
import {
  createAgentRunSummaryMiddleware,
  createAgentRunSummaryRecorder,
  createSubagentTaskCallExtractor,
  extractSubagentTaskResult,
  type AgentRunSummaryRecorder,
  type SubagentTaskCallRecord,
} from "./agent-run-summary";
import { createDeepAgentToolAllowlistMiddleware } from "./deep-agent-tool-policy";
import { createDefaultAgentMiddleware } from "./middleware";
import { createChatModel, type ChatModelOptions } from "./model";

/**
 * 带 SubAgent Agent 的推理事件。
 */
export interface AgentWithSubagentReasoningEvent<AgentType extends string> {
  type: "reasoning";
  agentType: AgentType;
  content: string;
}

export type AgentWithSubagentEvent<AgentType extends string> =
  | AgentWithSubagentReasoningEvent<AgentType>
  | {
      type: "subagent-start";
      agentType: AgentType;
      subagentType: string;
      toolCallId?: string;
    }
  | {
      type: "subagent-thinking";
      agentType: AgentType;
      subagentType: string;
      toolCallId?: string;
      content: string;
    }
  | {
      type: "subagent-result";
      agentType: AgentType;
      subagentType: string;
      toolCallId?: string;
      result: unknown;
    }
  | {
      type: "tool-call";
      toolCallId?: string;
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType: AgentType;
    }
  | {
      type: "tool-result";
      toolCallId?: string;
      toolName: string;
      toolResult: unknown;
      agentType: AgentType;
    }
  | {
      type: "token-usage";
      agentType: AgentType;
      inputTokens: number;
      cacheHitInputTokens: number;
      cacheMissInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costInput: number;
      costOutput: number;
      costTotal: number;
      durationMs: number;
    };

export interface RunAgentWithSubagentOptions<T, AgentType extends string> {
  agentType: AgentType;
  agentLabel: string;
  name: string;
  modelOptions?: ChatModelOptions;
  systemPrompt: string;
  tools?: StructuredTool[];
  subagents: SubAgent[];
  payload: unknown;
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: unknown };
  };
  fallback: (reason: string) => T;
  /** JSON 解析失败或 schema 校验失败时的最大重试次数，默认 0（不重试，直接 fallback）。 */
  maxRetries?: number;
  suppressInvalidJsonReasoning?: boolean;
  signal?: AbortSignal;
}

/**
 * 构造 JSON 结构化失败时的重试载荷，将原始任务、失败原因和上一次原始输出
 * 打包为 retry_context，供 Agent 在下一轮尝试中定位并修复错误。
 */
function buildRetryPayload(
  originalPayload: unknown,
  attempt: number,
  maxRetries: number,
  error: string,
  previousRawOutput: string,
): string {
  const basePayload =
    originalPayload && typeof originalPayload === "object" && !Array.isArray(originalPayload)
      ? (originalPayload as Record<string, unknown>)
      : { original_task: originalPayload };

  return JSON.stringify({
    ...basePayload,
    retry_context: {
      attempt: attempt + 1,
      max_attempts: maxRetries + 1,
      error,
      previous_raw_output: previousRawOutput.slice(0, 3000),
      instruction:
        "Your previous attempt produced invalid output. Review the error above, examine the previous raw output to understand what went wrong, fix the issues, and produce valid JSON that strictly matches the required schema. Do not repeat the same mistake.",
    },
  });
}

/**
 * 判断当前 namespace 是否属于 SubAgent 内部工具执行上下文。
 */
function isSubagentNamespace(namespace: string[]): boolean {
  return namespace.some((segment) => segment.startsWith("tools:"));
}

/**
 * 从当前消息中提取 task 工具调用，注册到映射并产出 subagent-start 事件。
 */
async function* handleSubagentTaskCalls<AgentType extends string>(
  taskCalls: SubagentTaskCallRecord[],
  options: { agentType: AgentType },
  summaryRecorder: AgentRunSummaryRecorder,
  taskCallToSubagent: Map<string, string>,
  openSubagentCalls: Array<{ toolCallId?: string; subagentType: string }>,
): AsyncGenerator<AgentWithSubagentEvent<AgentType>, void, void> {
  for (const taskCall of taskCalls) {
    if (taskCall.toolCallId) {
      taskCallToSubagent.set(taskCall.toolCallId, taskCall.subagentType);
    }
    openSubagentCalls.push({
      toolCallId: taskCall.toolCallId,
      subagentType: taskCall.subagentType,
    });
    summaryRecorder.recordSubagentCall({
      toolCallId: taskCall.toolCallId,
      subagentType: taskCall.subagentType,
      input: taskCall.input,
    });
    yield {
      type: "subagent-start",
      agentType: options.agentType,
      subagentType: taskCall.subagentType,
      toolCallId: taskCall.toolCallId,
    };
  }
}

/**
 * 处理主 Agent 层面的可见工具调用和工具结果事件。
 */
async function* handleVisibleToolEvents<AgentType extends string>(
  message: BaseMessage,
  visibleToolNames: ReadonlySet<string>,
  options: { agentType: AgentType },
  summaryRecorder: AgentRunSummaryRecorder,
): AsyncGenerator<AgentWithSubagentEvent<AgentType>, void, void> {
  for (const toolCall of getToolCalls(message, visibleToolNames)) {
    summaryRecorder.recordToolCall({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      toolArgs: toolCall.args,
    });
    yield {
      type: "tool-call",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      toolArgs: toolCall.args,
      agentType: options.agentType,
    };
  }

  const toolResult = getToolResult(message, visibleToolNames);
  if (toolResult) {
    summaryRecorder.recordToolResult({
      toolCallId: toolResult.id,
      toolName: toolResult.name,
      toolResult: toolResult.content,
    });
    yield {
      type: "tool-result",
      toolCallId: toolResult.id,
      toolName: toolResult.name,
      toolResult: toolResult.content,
      agentType: options.agentType,
    };
  }
}

/**
 * 当消息是可见工具结果时，后续无需再处理文本/推理。
 */
function shouldSkipTextAfterToolResult(
  message: BaseMessage,
  visibleToolNames: ReadonlySet<string>,
): boolean {
  return getToolResult(message, visibleToolNames) !== null;
}

/**
 * 处理 SubAgent task 工具返回结果（ToolMessage），产出 subagent-result 事件并关闭对应调用。
 *
 * @returns 是否已处理（true 表示消息已被消费，调用方应 continue）
 */
async function* handleSubagentTaskResult<AgentType extends string>(
  message: BaseMessage,
  options: { agentType: AgentType },
  summaryRecorder: AgentRunSummaryRecorder,
  taskCallToSubagent: Map<string, string>,
  openSubagentCalls: Array<{ toolCallId?: string; subagentType: string }>,
): AsyncGenerator<AgentWithSubagentEvent<AgentType>, boolean, void> {
  if (!ToolMessage.isInstance(message)) {
    return false;
  }

  const structuredResult = extractSubagentTaskResult(
    message,
    taskCallToSubagent,
  );
  if (structuredResult) {
    summaryRecorder.recordSubagentResult({
      toolCallId: structuredResult.toolCallId,
      subagentType: structuredResult.subagentType,
      output: structuredResult.output,
    });
    yield {
      type: "subagent-result",
      agentType: options.agentType,
      subagentType: structuredResult.subagentType,
      toolCallId: structuredResult.toolCallId,
      result: structuredResult.output,
    };
    closeSubagentCall(openSubagentCalls, structuredResult);
    return true;
  }

  if (message.name === "task") {
    const toolCallId = (message as { tool_call_id?: string }).tool_call_id;
    const subagentType =
      (toolCallId ? taskCallToSubagent.get(toolCallId) : undefined) ??
      "unknown";
    summaryRecorder.recordSubagentResult({
      toolCallId,
      subagentType,
      output: message.content,
    });
    yield {
      type: "subagent-result",
      agentType: options.agentType,
      subagentType,
      toolCallId,
      result: message.content,
    };
    closeSubagentCall(openSubagentCalls, { toolCallId, subagentType });
    return true;
  }

  return false;
}

/**
 * 处理主 Agent 层面的推理内容。
 *
 * 当本消息中刚产出了 task 调用（hasNewTaskCallInThisMessage=true）时，推理归属于主 Agent；
 * 否则若存在未关闭的 SubAgent 调用，推理归属于最近的 SubAgent。
 */
async function* handleMainAgentReasoning<AgentType extends string>(
  message: BaseMessage,
  openSubagentCalls: Array<{ toolCallId?: string; subagentType: string }>,
  hasNewTaskCallInThisMessage: boolean,
  options: { agentType: AgentType },
  summaryRecorder: AgentRunSummaryRecorder,
): AsyncGenerator<AgentWithSubagentEvent<AgentType>, void, void> {
  const reasoning = getReasoningContent(message);
  if (!reasoning) return;

  // 如果本消息中刚刚产出了 task 调用（main agent 正在做委派决策），
  // 推理内容属于主 Agent 自身，不应归属给之前打开的 SubAgent。
  const activeSubagent = hasNewTaskCallInThisMessage
    ? undefined
    : openSubagentCalls[openSubagentCalls.length - 1];

  if (activeSubagent) {
    summaryRecorder.recordSubagentThinking({
      toolCallId: activeSubagent.toolCallId,
      subagentType: activeSubagent.subagentType,
      content: reasoning,
    });
    yield {
      type: "subagent-thinking",
      agentType: options.agentType,
      subagentType: activeSubagent.subagentType,
      toolCallId: activeSubagent.toolCallId,
      content: reasoning,
    };
  } else {
    summaryRecorder.recordThinking(reasoning);
    yield {
      type: "reasoning",
      agentType: options.agentType,
      content: reasoning,
    };
  }
}

/**
 * 处理 SubAgent 内部的推理内容，始终归属给最近打开的 SubAgent。
 */
async function* handleSubagentReasoning<AgentType extends string>(
  message: BaseMessage,
  openSubagentCalls: Array<{ toolCallId?: string; subagentType: string }>,
  options: { agentType: AgentType },
  summaryRecorder: AgentRunSummaryRecorder,
): AsyncGenerator<AgentWithSubagentEvent<AgentType>, void, void> {
  const reasoning = getReasoningContent(message);
  if (!reasoning) return;

  const activeSubagent = openSubagentCalls[openSubagentCalls.length - 1];
  if (!activeSubagent) return;

  summaryRecorder.recordSubagentThinking({
    toolCallId: activeSubagent.toolCallId,
    subagentType: activeSubagent.subagentType,
    content: reasoning,
  });
  yield {
    type: "subagent-thinking",
    agentType: options.agentType,
    subagentType: activeSubagent.subagentType,
    toolCallId: activeSubagent.toolCallId,
    content: reasoning,
  };
}

/**
 * 运行携带同步 SubAgent 的 DeepAgent，并把 task 工具轨迹转换为业务流事件。
 *
 * 当 options.maxRetries 大于 0 时，JSON 解析失败或 schema 校验失败不会立即回退，
 * 而是将错误信息打包进 retry_context 重试 Agent，最多重试 maxRetries 次。
 * 所有重试均失败后才使用 fallback。
 */
export async function* runAgentWithSubagent<T, AgentType extends string>(
  options: RunAgentWithSubagentOptions<T, AgentType>,
): AsyncGenerator<AgentWithSubagentEvent<AgentType>, T, void> {
  const maxRetries = options.maxRetries ?? 0;
  const maxAttempts = maxRetries + 1;
  const startTime = Date.now();
  const tools = options.tools ?? [];
  const visibleToolNameSet = new Set(tools.map((tool) => tool.name));
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: options.agentLabel,
    agentName: options.name,
    agentType: options.agentType,
    context: {
      modelOptions: options.modelOptions,
      payload: options.payload,
      subagents: compactSubagentDefinitions(options.subagents),
      systemPrompt: options.systemPrompt,
      tools: compactToolDefinitions(tools),
      allowedBuiltinToolNames: ["task"],
    },
  });

  /** 上一次尝试的失败原因，用于重试时反馈给 Agent。 */
  let lastError = "";
  /** 上一次尝试的原始输出文本，用于重试时反馈给 Agent。 */
  let lastRawOutput = "";
  /** 所有尝试中最后有效的 token 用量。 */
  let finalTokenUsage: ReturnType<typeof getTokenUsage> = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 非首次尝试时产出重试提示，让前端知晓 Agent 正在重试生成。
    if (attempt > 0) {
      const retryContent = `结构化输出失败（第 ${attempt} 次），正在重试…\n上次错误：${lastError}`;
      summaryRecorder.recordThinking(retryContent);
      yield {
        type: "reasoning",
        agentType: options.agentType,
        content: retryContent,
      };
    }

    // 构造本轮载荷：首次使用原始 payload，重试时附带 retry_context。
    const payloadStr =
      attempt === 0
        ? JSON.stringify(options.payload)
        : buildRetryPayload(
            options.payload,
            attempt,
            maxRetries,
            lastError,
            lastRawOutput,
          );

    let responseText = "";
    let attemptTokenUsage: ReturnType<typeof getTokenUsage> = null;

    try {
      const agent = createDeepAgent({
        model: createChatModel(options.modelOptions) as any,
        systemPrompt: options.systemPrompt,
        tools,
        name: options.name,
        subagents: options.subagents,
        middleware: [
          createDeepAgentToolAllowlistMiddleware({
            agentName: options.name,
            allowedToolNames: [...tools.map((tool) => tool.name), "task"],
          }),
          ...createDefaultAgentMiddleware(),
          ...createAgentRunSummaryMiddleware(summaryRecorder),
        ] as any,
      });

      const run = await agent.stream(
        {
          messages: [new HumanMessage(payloadStr)],
        },
        { streamMode: "messages", signal: options.signal, subgraphs: true },
      );

      /** 跟踪 task 工具调用中 tool_call_id -> subagentType 的映射，用于结果匹配。 */
      const taskCallToSubagent = new Map<string, string>();
      /** 当前仍在执行的 SubAgent 调用，用于把模型 reasoning 归属到内嵌卡片。 */
      const openSubagentCalls: Array<{
        toolCallId?: string;
        subagentType: string;
      }> = [];
      /** 缓存 SubAgent namespace 的原始返回值，兼容未产生 task ToolMessage 的 DeepAgents 流。 */
      const pendingSubagentOutputs = new Map<string, string>();
      const subagentTaskCallExtractor = createSubagentTaskCallExtractor();

      for await (const [namespace, chunk] of run) {
        const [message, metadata] = chunk;
        const isSubagentMessage = isSubagentNamespace(namespace);

        // task 工具结果可能带有 tools:task 命名空间，必须先关闭 SubAgent 调用，
        // 避免把子代理返回值误记为主 Agent 的流式输出。
        const subagentResultHandled = yield* handleSubagentTaskResult(
          message,
          options,
          summaryRecorder,
          taskCallToSubagent,
          openSubagentCalls,
        );
        if (subagentResultHandled) {
          continue;
        }

        // SubAgent 内部消息只归档推理和 token 用量，不参与主 Agent 最终 JSON 拼接。
        if (isSubagentMessage) {
          yield* handleSubagentReasoning(
            message,
            openSubagentCalls,
            options,
            summaryRecorder,
          );
          const rawSubagentOutput = getTextContent(message);
          if (rawSubagentOutput) {
            const activeSubagent =
              openSubagentCalls[openSubagentCalls.length - 1];
            if (activeSubagent) {
              const key = activeSubagent.toolCallId ?? activeSubagent.subagentType;
              pendingSubagentOutputs.set(
                key,
                `${pendingSubagentOutputs.get(key) ?? ""}${rawSubagentOutput}`,
              );
            }
            summaryRecorder.recordSubagentRawOutput({
              toolCallId: activeSubagent?.toolCallId,
              subagentType: activeSubagent?.subagentType,
              content: rawSubagentOutput,
            });
          }
          const usage = getTokenUsage(message);
          if (usage) attemptTokenUsage = usage;
          continue;
        }

        // 主 Agent 层面：完整处理 task 委派、工具事件、推理和文本。
        const subagentTaskCalls = subagentTaskCallExtractor.extract(message);

        yield* handleSubagentTaskCalls(
          subagentTaskCalls,
          options,
          summaryRecorder,
          taskCallToSubagent,
          openSubagentCalls,
        );

        yield* handleVisibleToolEvents(
          message,
          visibleToolNameSet,
          options,
          summaryRecorder,
        );
        if (shouldSkipTextAfterToolResult(message, visibleToolNameSet)) {
          continue;
        }

        yield* handleMainAgentReasoning(
          message,
          openSubagentCalls,
          subagentTaskCalls.length > 0,
          options,
          summaryRecorder,
        );

        const text = getTextContent(message);
        responseText += text;
        summaryRecorder.recordOutput(text);

        const usage = getTokenUsage(message);
        if (usage) attemptTokenUsage = usage;
      }

      // 更新最后一次有效的 token 用量。
      // 部分 DeepAgents provider 不会回传 task ToolMessage；使用已结束 namespace 的原始输出完成委派。
      for (const activeSubagent of [...openSubagentCalls]) {
        const key = activeSubagent.toolCallId ?? activeSubagent.subagentType;
        const output = pendingSubagentOutputs.get(key);
        if (!output) continue;

        summaryRecorder.recordSubagentResult({
          toolCallId: activeSubagent.toolCallId,
          subagentType: activeSubagent.subagentType,
          output,
        });
        yield {
          type: "subagent-result",
          agentType: options.agentType,
          subagentType: activeSubagent.subagentType,
          toolCallId: activeSubagent.toolCallId,
          result: output,
        };
        closeSubagentCall(openSubagentCalls, activeSubagent);
      }

      if (attemptTokenUsage) finalTokenUsage = attemptTokenUsage;

      const tokenUsageSummary = finalTokenUsage
        ? {
            ...finalTokenUsage,
            durationMs: Date.now() - startTime,
          }
        : undefined;
      if (finalTokenUsage) {
        const cost = calculateCost(
          finalTokenUsage.cacheMissInputTokens,
          finalTokenUsage.cacheHitInputTokens,
          finalTokenUsage.outputTokens,
        );
        yield {
          type: "token-usage",
          agentType: options.agentType,
          inputTokens: finalTokenUsage.inputTokens,
          cacheHitInputTokens: finalTokenUsage.cacheHitInputTokens,
          cacheMissInputTokens: finalTokenUsage.cacheMissInputTokens,
          outputTokens: finalTokenUsage.outputTokens,
          totalTokens: finalTokenUsage.totalTokens,
          costInput: cost.costInput,
          costOutput: cost.costOutput,
          costTotal: cost.costTotal,
          durationMs: Date.now() - startTime,
        };
      }

      // --- JSON 解析与 schema 校验，带重试 ---

      const parsed = parseJsonObject(responseText);
      if (parsed === null) {
        const invalidJsonReason = formatInvalidJsonReason(
          responseText,
          finalTokenUsage,
          options.modelOptions?.maxTokens,
        );
        lastError = invalidJsonReason;
        lastRawOutput = responseText;

        if (attempt < maxAttempts - 1) continue; // 还有重试机会

        // 所有重试耗尽，使用 fallback。
        const fallbackResult = options.fallback(invalidJsonReason);
        if (!options.suppressInvalidJsonReasoning) {
          const content = invalidJsonReason.startsWith("output-truncated")
            ? `结构化输出疑似在模型 maxTokens 前被截断，已使用 ${options.agentLabel} 的 MVP 回退结果。\n`
            : `结构化输出不是可解析的 JSON，已使用 ${options.agentLabel} 的 MVP 回退结果。\n`;
          summaryRecorder.recordThinking(content);
          yield {
            type: "reasoning",
            agentType: options.agentType,
            content,
          };
        }
        await summaryRecorder.finish({
          error: invalidJsonReason,
          output: fallbackResult,
          status: "fallback",
          tokenUsage: tokenUsageSummary,
        });
        return fallbackResult;
      }

      const schemaResult = options.schema.safeParse(parsed);
      if (schemaResult.success) {
        await summaryRecorder.finish({
          output: schemaResult.data,
          status: "completed",
          tokenUsage: tokenUsageSummary,
        });
        return schemaResult.data;
      }

      const schemaError = `schema-validation: ${formatSchemaError(schemaResult.error)}`;
      lastError = schemaError;
      lastRawOutput = responseText;

      if (attempt < maxAttempts - 1) continue; // 还有重试机会

      // 所有重试耗尽，使用 fallback。
      const fallbackResult = options.fallback(schemaError);
      if (!options.suppressInvalidJsonReasoning) {
        const content = `结构化输出未通过契约校验，已使用 ${options.agentLabel} 的 MVP 回退结果：${schemaError}\n`;
        summaryRecorder.recordThinking(content);
        yield {
          type: "reasoning",
          agentType: options.agentType,
          content,
        };
      }
      await summaryRecorder.finish({
        error: schemaError,
        output: fallbackResult,
        status: "fallback",
        tokenUsage: tokenUsageSummary,
      });
      return fallbackResult;
    } catch (error) {
      const message = getErrorMessage(error);
      lastError = message;

      if (attempt < maxAttempts - 1) continue; // 还有重试机会

      // 所有重试耗尽，使用 fallback。
      const fallbackResult = options.fallback(message);
      const content = `${options.agentLabel} 执行失败，已使用 MVP 回退结果：${message}\n`;
      summaryRecorder.recordThinking(content);
      yield {
        type: "reasoning",
        agentType: options.agentType,
        content,
      };
      await summaryRecorder.finish({
        error: message,
        output: fallbackResult,
        status: "fallback",
      });
      return fallbackResult;
    }
  }

  // 理论上不会走到这里；所有路径都已 return。
  const unreachableFallback = options.fallback("max-retries-exhausted");
  await summaryRecorder.finish({
    error: "max-retries-exhausted",
    output: unreachableFallback,
    status: "fallback",
  });
  return unreachableFallback;
}

/**
 * 提取异常的可读消息，避免把未知错误对象直接写入用户流。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 关闭已返回结果的 SubAgent 调用，避免后续主 Agent reasoning 被错误归属。
 */
function closeSubagentCall(
  openSubagentCalls: Array<{ toolCallId?: string; subagentType: string }>,
  completed: { toolCallId?: string; subagentType?: string },
): void {
  const index = completed.toolCallId
    ? openSubagentCalls.findIndex(
        (item) => item.toolCallId === completed.toolCallId,
      )
    : findLastSubagentCallIndex(openSubagentCalls, completed.subagentType);

  if (index !== -1) {
    openSubagentCalls.splice(index, 1);
  }
}

/**
 * 按 SubAgent 类型从后向前匹配最近一次未完成调用。
 */
function findLastSubagentCallIndex(
  openSubagentCalls: Array<{ toolCallId?: string; subagentType: string }>,
  subagentType: string | undefined,
): number {
  for (let index = openSubagentCalls.length - 1; index >= 0; index -= 1) {
    if (
      !subagentType ||
      openSubagentCalls[index]?.subagentType === subagentType
    ) {
      return index;
    }
  }

  return -1;
}

/**
 * 区分普通 JSON 格式错误和模型输出截断，避免把截断误诊为 schema 契约问题。
 */
function formatInvalidJsonReason(
  responseText: string,
  tokenUsage: ReturnType<typeof getTokenUsage>,
  maxTokens: number | undefined,
): string {
  if (
    isLikelyTruncatedRootJson(responseText) ||
    didReachModelOutputLimit(tokenUsage, maxTokens)
  ) {
    return "output-truncated: model reached maxTokens before completing JSON";
  }

  return "invalid-json";
}

/**
 * 判断模型是否已经顶到输出上限；这通常意味着完整 JSON 被截断。
 */
function didReachModelOutputLimit(
  tokenUsage: ReturnType<typeof getTokenUsage>,
  maxTokens: number | undefined,
): boolean {
  return (
    typeof maxTokens === "number" &&
    tokenUsage !== null &&
    tokenUsage.outputTokens >= maxTokens
  );
}

/**
 * 根 JSON 从响应开头出现却没有闭合时，不应继续解析内部对象。
 */
function isLikelyTruncatedRootJson(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!normalized.startsWith("{")) return false;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (const char of normalized) {
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") continue;

    depth -= 1;
    if (depth === 0) return false;
  }

  return depth > 0 || inString;
}

/**
 * 压缩 Zod 校验错误，避免把完整 schema 失败对象写入用户流或调试摘要。
 */
function formatSchemaError(error: unknown): string {
  const issues = getSchemaIssues(error);
  if (issues.length === 0) return getErrorMessage(error);

  return issues
    .slice(0, 5)
    .map((issue) => {
      const path =
        Array.isArray(issue.path) && issue.path.length > 0
          ? issue.path.join(".")
          : "(root)";
      return `${path}: ${issue.message ?? "Invalid value"}`;
    })
    .join("; ");
}

/**
 * 兼容 Zod v3/v4 的 issues 形状。
 */
function getSchemaIssues(
  error: unknown,
): Array<{ path?: Array<string | number>; message?: string }> {
  if (!error || typeof error !== "object") return [];

  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const record = issue as { path?: unknown; message?: unknown };
    const path = Array.isArray(record.path)
      ? record.path.flatMap((item) =>
          typeof item === "string" || typeof item === "number" ? [item] : [],
        )
      : undefined;

    return [
      {
        path,
        message:
          typeof record.message === "string" ? record.message : undefined,
      },
    ];
  });
}

/**
 * 压缩工具定义，只保留汇总排查需要的工具名称。
 */
function compactToolDefinitions(tools: StructuredTool[]): Array<{
  name: string;
}> {
  return tools.map((tool) => ({
    name: typeof tool.name === "string" ? tool.name : "unknown",
  }));
}

/**
 * 压缩子代理定义，避免本地运行摘要保存完整提示词。
 */
function compactSubagentDefinitions(subagents: SubAgent[]): Array<{
  name: string;
  description: string;
}> {
  return subagents.map((subagent) => ({
    name: subagent.name,
    description: subagent.description,
  }));
}

/**
 * 从模型消息中提取业务可见工具调用。
 */
function getToolCalls(
  message: BaseMessage,
  visibleToolNames: ReadonlySet<string>,
): Array<{ id?: string; name: string; args?: Record<string, unknown> }> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.name && visibleToolNames.has(toolCall.name))
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      args:
        typeof toolCall.args === "object" && toolCall.args !== null
          ? (toolCall.args as Record<string, unknown>)
          : undefined,
    }));
}

/**
 * 从工具响应消息中提取业务可见工具结果。
 */
function getToolResult(
  message: BaseMessage,
  visibleToolNames: ReadonlySet<string>,
): { id?: string; name: string; content: unknown } | null {
  if (!ToolMessage.isInstance(message)) return null;
  if (!visibleToolNames.has(message.name ?? "unknown")) return null;

  return {
    id: (message as { tool_call_id?: string }).tool_call_id,
    name: message.name ?? "unknown",
    content: message.content,
  };
}
