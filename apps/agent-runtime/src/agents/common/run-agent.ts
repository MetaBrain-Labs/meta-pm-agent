/**
 * Agent 通用执行器
 *
 * 为 DeepAgent 提供统一的流式执行封装，负责模型创建、工具与推理事件、
 * token 统计、可选 SubAgent 追踪和最终结果解析。
 *
 * Responsibilities:
 * - 创建并驱动普通或携带 SubAgent 的 DeepAgent
 * - 统一输出 reasoning、tool、subagent 和 token 事件
 * - 通过调用方解析回调生成最终结果
 *
 * Notes:
 * - 结果解析与业务 fallback 由调用方提供，执行器不感知具体输出 schema。
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type StructuredTool,
} from "langchain";
import { createDeepAgent, type FileData, type SubAgent } from "deepagents";
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

const SKILL_READ_TOOL_NAMES = new Set(["read_file"]);

/**
 * 带 SubAgent Agent 的推理事件。
 */
export interface AgentReasoningEvent<AgentType extends string> {
  type: "reasoning";
  agentType: AgentType;
  content: string;
}

export type AgentRunEvent<AgentType extends string> =
  | AgentReasoningEvent<AgentType>
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

/** Agent 最终输出解析上下文。 */
export interface AgentOutputContext {
  text: string;
  tokenUsage: ReturnType<typeof getTokenUsage>;
  maxTokens?: number;
}

/** Agent 最终输出解析结果。 */
export type AgentOutputResolution<T> =
  | { success: true; data: T }
  | { success: false; reason: string; userMessage?: string };

/** Agent 最终输出解析函数。 */
export type AgentOutputResolver<T> = (
  context: AgentOutputContext,
) => AgentOutputResolution<T>;

/** 通用 Agent 执行选项。 */
export interface RunAgentOptions<T, AgentType extends string> {
  agentType: AgentType;
  agentLabel: string;
  name: string;
  modelOptions?: ChatModelOptions;
  systemPrompt: string;
  tools?: StructuredTool[];
  skills?: string[];
  skillFiles?: Record<string, FileData>;
  subagents?: SubAgent[];
  payload: unknown;
  resolveOutput: AgentOutputResolver<T>;
  fallback: (reason: string) => T;
  /** 要求每次成功响应前必须通过 task 真实调用的 SubAgent。 */
  requiredSubagentType?: string;
  suppressFallbackReasoning?: boolean;
  throwOnError?: boolean;
  signal?: AbortSignal;
}

/** 结构化 JSON Agent 的默认模型参数。 */
export const JSON_AGENT_MODEL_OPTIONS = {
  enableThinking: false,
  responseFormat: "json_object",
  temperature: 0,
} satisfies Omit<ChatModelOptions, "maxTokens">;

/** 自由文本 Agent 的默认模型参数。 */
export const TEXT_AGENT_MODEL_OPTIONS = {
  enableThinking: false,
  temperature: 0,
} satisfies Omit<ChatModelOptions, "maxTokens" | "timeout">;

/**
 * 解析并校验 JSON Agent 的最终输出。
 */
export function resolveJsonOutput<T>(
  context: AgentOutputContext,
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: unknown };
  },
): AgentOutputResolution<T> {
  const parsed = parseJsonObject(context.text);
  if (parsed === null) {
    return {
      success: false,
      reason: formatInvalidJsonReason(
        context.text,
        context.tokenUsage,
        context.maxTokens,
      ),
    };
  }

  const result = schema.safeParse(parsed);
  return result.success
    ? result
    : {
        success: false,
        reason: `schema-validation: ${formatSchemaError(result.error)}`,
      };
}

/**
 * 解析自由文本 Agent 的最终输出。
 */
export function resolveTextOutput(
  context: AgentOutputContext,
): AgentOutputResolution<string> {
  const text = context.text.trim();
  if (text) return { success: true, data: text };

  return {
    success: false,
    reason: didReachModelOutputLimit(context.tokenUsage, context.maxTokens)
      ? `output-truncated: model reached maxTokens (${context.maxTokens}) before completing`
      : "empty-output",
  };
}

/**
 * 校验当前尝试是否真实调用了指定 SubAgent。
 */
export function getMissingRequiredSubagentError(
  requiredSubagentType: string | undefined,
  invokedSubagentTypes: ReadonlySet<string>,
): string | null {
  return requiredSubagentType && !invokedSubagentTypes.has(requiredSubagentType)
    ? `required-subagent-not-invoked: ${requiredSubagentType}`
    : null;
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
): AsyncGenerator<AgentRunEvent<AgentType>, void, void> {
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
): AsyncGenerator<AgentRunEvent<AgentType>, void, void> {
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
 * 仅在本地调试摘要中记录隔离 Skill 的读取，不暴露正文或产生运行时工具事件。
 *
 * @returns 当前消息是否为需要从普通文本处理链路中移除的 read_file 结果。
 */
export function recordSkillReadForSummary(
  message: BaseMessage,
  summaryRecorder: Pick<
    AgentRunSummaryRecorder,
    "recordToolCall" | "recordToolResult"
  >,
): boolean {
  for (const toolCall of getToolCalls(message, SKILL_READ_TOOL_NAMES)) {
    summaryRecorder.recordToolCall({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      toolArgs: toolCall.args,
    });
  }

  if (!ToolMessage.isInstance(message) || message.name !== "read_file") {
    return false;
  }

  summaryRecorder.recordToolResult({
    toolCallId: message.tool_call_id,
    toolName: "read_file",
    toolResult: {
      status: message.status ?? "unknown",
      content: "Skill file content omitted.",
    },
  });
  return true;
}

/** 判断当前消息是否为业务可见工具结果。 */
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
): AsyncGenerator<AgentRunEvent<AgentType>, boolean, void> {
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
): AsyncGenerator<AgentRunEvent<AgentType>, void, void> {
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
): AsyncGenerator<AgentRunEvent<AgentType>, void, void> {
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
 * 运行普通或携带 SubAgent 的 DeepAgent。
 */
export async function* runAgent<T, AgentType extends string>(
  options: RunAgentOptions<T, AgentType>,
): AsyncGenerator<AgentRunEvent<AgentType>, T, void> {
  const startTime = Date.now();
  const tools = options.tools ?? [];
  const subagents = options.subagents ?? [];
  const skillFiles = options.skillFiles ?? {};
  const hasSkillFiles = Object.keys(skillFiles).length > 0;
  const allowedBuiltinToolNames = [
    ...(hasSkillFiles ? ["read_file"] : []),
    ...(subagents.length ? ["task"] : []),
  ];
  const visibleToolNames = new Set(tools.map((tool) => tool.name));
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: options.agentLabel,
    agentName: options.name,
    agentType: options.agentType,
    context: {
      modelOptions: options.modelOptions,
      payload: options.payload,
      skills: options.skills ?? [],
      subagents: compactSubagentDefinitions(subagents),
      systemPrompt: options.systemPrompt,
      tools: compactToolDefinitions(tools),
      allowedBuiltinToolNames,
    },
  });
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;

  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools,
      name: options.name,
      skills: options.skills ?? [],
      ...(subagents.length ? { subagents } : {}),
      middleware: [
        createDeepAgentToolAllowlistMiddleware({
          agentName: options.name,
          allowedToolNames: [
            ...tools.map((tool) => tool.name),
            ...allowedBuiltinToolNames,
          ],
        }),
        ...createDefaultAgentMiddleware(),
        ...createAgentRunSummaryMiddleware(summaryRecorder),
      ] as any,
    });

    const run = await agent.stream(
      {
        messages: [new HumanMessage(JSON.stringify(options.payload))],
        ...(hasSkillFiles ? { files: skillFiles } : {}),
      },
      {
        streamMode: "messages",
        signal: options.signal,
        subgraphs: true,
      },
    );

    let responseText = "";
    const invokedSubagentTypes = new Set<string>();
    const taskCallToSubagent = new Map<string, string>();
    const openSubagentCalls: Array<{
      toolCallId?: string;
      subagentType: string;
    }> = [];
    const pendingSubagentOutputs = new Map<string, string>();
    const subagentTaskCallExtractor = createSubagentTaskCallExtractor();

    for await (const item of run as AsyncIterable<
      [string[], [BaseMessage, Record<string, unknown>]]
    >) {
      const [namespace, [message]] = item;
      const isSubagentMessage = isSubagentNamespace(namespace);
      const subagentResultHandled = yield* handleSubagentTaskResult(
        message,
        options,
        summaryRecorder,
        taskCallToSubagent,
        openSubagentCalls,
      );
      if (subagentResultHandled) continue;

      if (isSubagentMessage) {
        yield* handleSubagentReasoning(
          message,
          openSubagentCalls,
          options,
          summaryRecorder,
        );
        const text = getTextContent(message);
        const activeSubagent =
          openSubagentCalls[openSubagentCalls.length - 1];
        if (text && activeSubagent) {
          const key =
            activeSubagent.toolCallId ?? activeSubagent.subagentType;
          pendingSubagentOutputs.set(
            key,
            `${pendingSubagentOutputs.get(key) ?? ""}${text}`,
          );
          summaryRecorder.recordSubagentRawOutput({
            toolCallId: activeSubagent.toolCallId,
            subagentType: activeSubagent.subagentType,
            content: text,
          });
        }
        tokenUsage = getTokenUsage(message) ?? tokenUsage;
        continue;
      }

      if (
        hasSkillFiles &&
        recordSkillReadForSummary(message, summaryRecorder)
      ) {
        continue;
      }

      const taskCalls = subagentTaskCallExtractor.extract(message);
      taskCalls.forEach((call) =>
        invokedSubagentTypes.add(call.subagentType),
      );
      yield* handleSubagentTaskCalls(
        taskCalls,
        options,
        summaryRecorder,
        taskCallToSubagent,
        openSubagentCalls,
      );
      yield* handleVisibleToolEvents(
        message,
        visibleToolNames,
        options,
        summaryRecorder,
      );
      if (shouldSkipTextAfterToolResult(message, visibleToolNames)) continue;

      yield* handleMainAgentReasoning(
        message,
        openSubagentCalls,
        taskCalls.length > 0,
        options,
        summaryRecorder,
      );
      const text = getTextContent(message);
      responseText += text;
      summaryRecorder.recordOutput(text);
      tokenUsage = getTokenUsage(message) ?? tokenUsage;
    }

    // 某些 provider 不产生 task ToolMessage，使用子图最终文本补齐结果事件。
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

    const tokenUsageSummary = tokenUsage
      ? { ...tokenUsage, durationMs: Date.now() - startTime }
      : undefined;
    if (tokenUsage) {
      const cost = calculateCost(
        tokenUsage.cacheMissInputTokens,
        tokenUsage.cacheHitInputTokens,
        tokenUsage.outputTokens,
      );
      yield {
        type: "token-usage",
        agentType: options.agentType,
        ...tokenUsage,
        ...cost,
        durationMs: Date.now() - startTime,
      };
    }

    const resolution = options.resolveOutput({
      text: responseText,
      tokenUsage,
      maxTokens: options.modelOptions?.maxTokens,
    });
    if (resolution.success) {
      const missingSubagent = getMissingRequiredSubagentError(
        options.requiredSubagentType,
        invokedSubagentTypes,
      );
      if (missingSubagent) {
        await summaryRecorder.finish({
          error: missingSubagent,
          output: resolution.data,
          status: "failed",
          tokenUsage: tokenUsageSummary,
        });
        throw new Error(missingSubagent);
      }
      await summaryRecorder.finish({
        output: resolution.data,
        status: "completed",
        tokenUsage: tokenUsageSummary,
      });
      return resolution.data;
    }

    const fallback = options.fallback(resolution.reason);
    if (!options.suppressFallbackReasoning) {
      const content =
        resolution.userMessage ??
        formatFallbackReasoning(options.agentLabel, resolution.reason);
      summaryRecorder.recordThinking(content);
      yield {
        type: "reasoning",
        agentType: options.agentType,
        content,
      };
    }
    await summaryRecorder.finish({
      error: resolution.reason,
      output: fallback,
      status: "fallback",
      tokenUsage: tokenUsageSummary,
    });
    return fallback;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (
      options.throwOnError ||
      errorMessage.startsWith("required-subagent-not-invoked:")
    ) {
      await summaryRecorder.finish({
        error: errorMessage,
        status: "failed",
      });
      throw error;
    }

    const fallback = options.fallback(errorMessage);
    const content = `${options.agentLabel} 执行失败，已使用 MVP 回退结果：${errorMessage}\n`;
    summaryRecorder.recordThinking(content);
    yield {
      type: "reasoning",
      agentType: options.agentType,
      content,
    };
    await summaryRecorder.finish({
      error: errorMessage,
      output: fallback,
      status: "fallback",
    });
    return fallback;
  }
}

/**
 * 根据解析失败原因生成紧凑的用户提示。
 */
function formatFallbackReasoning(agentLabel: string, reason: string): string {
  if (reason.startsWith("output-truncated")) {
    return `结构化输出疑似在模型 maxTokens 前被截断，已使用 ${agentLabel} 的 MVP 回退结果。\n`;
  }
  if (reason.startsWith("schema-validation")) {
    return `结构化输出未通过契约校验，已使用 ${agentLabel} 的 MVP 回退结果：${reason}\n`;
  }
  if (reason === "empty-output") {
    return `${agentLabel} 未返回有效内容，已使用 MVP 回退结果。\n`;
  }
  return `结构化输出不是可解析的 JSON，已使用 ${agentLabel} 的 MVP 回退结果。\n`;
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
