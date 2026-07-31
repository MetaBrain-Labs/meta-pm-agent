/**
 * Agent 通用执行器
 *
 * 为 DeepAgent 提供统一的 Event Streaming v3 执行封装，负责模型创建、
 * 工具与推理事件、token 统计、可选 SubAgent 追踪和最终结果解析。
 *
 * Responsibilities:
 * - 创建并驱动普通或携带 SubAgent 的 DeepAgent Event Streaming projections
 * - 统一输出 reasoning、tool、subagent 和 token 事件
 * - 通过调用方解析回调生成最终结果
 *
 * Notes:
 * - 结果解析与业务 fallback 由调用方提供，执行器不感知具体输出 schema。
 */

import { randomUUID } from "node:crypto";
import type { AgentModelGroup, ModelUsageProfile } from "@repo/shared";
import { HumanMessage, type BaseMessage, type StructuredTool } from "langchain";
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
  type AgentRunSummaryRecorder,
} from "./agent-run-summary";
import { createDeepAgentToolAllowlistMiddleware } from "./deep-agent-tool-policy";
import { createDefaultAgentMiddleware } from "./middleware";
import { createChatModel, type ChatModelOptions } from "./model";
import {
  createModelSummarySnapshot,
  resolveAgentModelSelection,
  toLlmPricing,
  type ResolvedAgentModelSelection,
} from "./model-profile";

const SKILL_READ_TOOL_NAME = "read_file";

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
  modelProfile?: ModelUsageProfile;
  modelGroup?: AgentModelGroup;
  /** 主 Agent 报告需要同时展示 SubAgent 模型时可覆盖默认模型区块。 */
  modelSummary?: unknown;
  /** SubAgent 名称到职责组的映射，用于按其实际模型单独计费。 */
  subagentModelGroups?: Partial<Record<string, AgentModelGroup>>;
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
  /** 将调用方指定的工具失败结果提升为运行异常。 */
  getToolResultError?: (
    toolName: string,
    toolResult: unknown,
  ) => Error | null;
  signal?: AbortSignal;
}

/** 结构化 JSON Agent 的默认模型参数。 */
export const JSON_AGENT_MODEL_OPTIONS = {
  enableThinking: true,
  responseFormat: "json_object",
  temperature: 0,
} satisfies Omit<ChatModelOptions, "maxTokens">;

/** 自由文本 Agent 的默认模型参数。 */
export const TEXT_AGENT_MODEL_OPTIONS = {
  enableThinking: true,
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

/** Event Streaming v3 的模型消息投影最小契约。 */
export interface AgentMessageProjection {
  text: AsyncIterable<string>;
  reasoning: AsyncIterable<string>;
  output: PromiseLike<BaseMessage>;
}

/** Event Streaming v3 的工具调用投影最小契约。 */
export interface AgentToolCallProjection {
  name: string;
  callId: string;
  input: unknown;
  output: PromiseLike<unknown>;
  status: PromiseLike<"running" | "finished" | "error">;
  error: PromiseLike<string | undefined>;
}

/** Event Streaming v3 的 SubAgent 投影最小契约。 */
export interface AgentSubagentProjection {
  name: string;
  taskInput: PromiseLike<string>;
  output: PromiseLike<unknown>;
  messages: AsyncIterable<AgentMessageProjection>;
}

/** 公共运行器消费的 Event Streaming v3 投影集合。 */
export interface AgentEventStreamProjection {
  messages: AsyncIterable<AgentMessageProjection>;
  toolCalls: AsyncIterable<AgentToolCallProjection>;
  subagents: AsyncIterable<AgentSubagentProjection>;
  output: PromiseLike<unknown>;
}

/** Event Streaming 汇流完成后交给结果解析器的状态。 */
export interface AgentEventStreamResult {
  responseText: string;
  tokenUsage: ReturnType<typeof getTokenUsage>;
  invokedSubagentTypes: Set<string>;
}

interface AgentEventStreamAdapterOptions<AgentType extends string> {
  agentType: AgentType;
  visibleToolNames: ReadonlySet<string>;
  summaryRecorder: AgentRunSummaryRecorder;
  subagentSelections?: ReadonlyMap<string, ResolvedAgentModelSelection>;
  getToolResultError?: (
    toolName: string,
    toolResult: unknown,
  ) => Error | null;
}

/**
 * 将 Event Streaming v3 的并发 projections 汇流为仓库稳定的 AgentRunEvent。
 *
 * Notes:
 * - 仅消费顶层 messages/toolCalls，SubAgent 内容通过专属 handle 归属。
 * - 内部 Skill 读取只写脱敏调试摘要，不进入用户可见事件。
 */
export async function* adaptAgentEventStream<AgentType extends string>(
  run: AgentEventStreamProjection,
  options: AgentEventStreamAdapterOptions<AgentType>,
): AsyncGenerator<AgentRunEvent<AgentType>, AgentEventStreamResult, void> {
  const events: AgentRunEvent<AgentType>[] = [];
  let wakeConsumer: (() => void) | undefined;
  let completed = false;
  let failure: unknown;
  let responseText = "";
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  const invokedSubagentTypes = new Set<string>();

  const push = (event: AgentRunEvent<AgentType>) => {
    events.push(event);
    wakeConsumer?.();
    wakeConsumer = undefined;
  };

  const consumeMessages = async () => {
    for await (const message of run.messages) {
      await Promise.all([
        consumeTextChunks(message.text, (content) => {
          responseText += content;
          options.summaryRecorder.recordOutput(content);
        }),
        consumeTextChunks(message.reasoning, (content) => {
          options.summaryRecorder.recordThinking(content);
          push({
            type: "reasoning",
            agentType: options.agentType,
            content,
          });
        }),
      ]);
      tokenUsage = getTokenUsage(await message.output) ?? tokenUsage;
    }
  };

  const consumeToolCalls = async () => {
    for await (const call of run.toolCalls) {
      // 工具失败时 output 会 reject；立即观测全部 projection，避免未处理 Promise 杀死 API 进程。
      const settledCall = Promise.allSettled([
        call.status,
        call.output,
        call.error,
      ] as const);
      if (
        call.name !== SKILL_READ_TOOL_NAME &&
        !options.visibleToolNames.has(call.name)
      ) {
        continue;
      }

      const toolArgs = normalizeToolInput(call.input);
      options.summaryRecorder.recordToolCall({
        toolCallId: call.callId,
        toolName: call.name,
        toolArgs,
      });

      if (call.name !== SKILL_READ_TOOL_NAME) {
        push({
          type: "tool-call",
          toolCallId: call.callId,
          toolName: call.name,
          toolArgs,
          agentType: options.agentType,
        });
      }

      const [statusResult, outputResult, errorResult] = await settledCall;
      if (statusResult.status === "rejected") throw statusResult.reason;
      const status = statusResult.value;
      if (call.name === SKILL_READ_TOOL_NAME) {
        options.summaryRecorder.recordToolResult({
          toolCallId: call.callId,
          toolName: call.name,
          toolResult: {
            status,
            content: "Skill file content omitted.",
          },
        });
        continue;
      }

      let toolResult: unknown;
      if (status === "finished") {
        if (outputResult.status === "rejected") throw outputResult.reason;
        toolResult = outputResult.value;
      } else {
        const error =
          errorResult.status === "fulfilled"
            ? errorResult.value
            : errorResult.reason;
        const outputError =
          outputResult.status === "rejected" ? outputResult.reason : undefined;
        toolResult = {
          error: getErrorMessage(
            error ?? outputError ?? "Tool execution failed.",
          ),
        };
      }
      options.summaryRecorder.recordToolResult({
        toolCallId: call.callId,
        toolName: call.name,
        toolResult,
      });
      push({
        type: "tool-result",
        toolCallId: call.callId,
        toolName: call.name,
        toolResult,
        agentType: options.agentType,
      });
      const toolError = options.getToolResultError?.(call.name, toolResult);
      if (toolError) throw toolError;
    }
  };

  const consumeSubagents = async () => {
    const watchers: Promise<void>[] = [];
    for await (const subagent of run.subagents) {
      const toolCallId = `subagent:${randomUUID()}`;
      const subagentType = subagent.name;
      const taskInput = await subagent.taskInput;
      invokedSubagentTypes.add(subagentType);
      options.summaryRecorder.recordSubagentCall({
        toolCallId,
        subagentType,
        input: { description: taskInput },
      });
      push({
        type: "subagent-start",
        agentType: options.agentType,
        subagentType,
        toolCallId,
      });

      watchers.push(
        consumeSubagentProjection(
          subagent,
          toolCallId,
          options,
          push,
        ),
      );
    }
    await Promise.all(watchers);
  };

  const producer = Promise.all([
    consumeMessages(),
    consumeToolCalls(),
    consumeSubagents(),
    Promise.resolve(run.output).then(() => undefined),
  ])
    .then(() => {
      completed = true;
      wakeConsumer?.();
    })
    .catch((error: unknown) => {
      failure = error;
      completed = true;
      wakeConsumer?.();
    });

  while (!completed || events.length > 0) {
    if (events.length === 0) {
      await new Promise<void>((resolve) => {
        wakeConsumer = resolve;
      });
      continue;
    }
    yield events.shift()!;
  }

  await producer;
  if (failure !== undefined) throw failure;

  return {
    responseText,
    tokenUsage,
    invokedSubagentTypes,
  };
}

/** 消费单个 SubAgent handle，并保持其 reasoning、文本和结果归属稳定。 */
async function consumeSubagentProjection<AgentType extends string>(
  subagent: AgentSubagentProjection,
  toolCallId: string,
  options: AgentEventStreamAdapterOptions<AgentType>,
  push: (event: AgentRunEvent<AgentType>) => void,
): Promise<void> {
  const startedAt = Date.now();
  let streamedText = "";
  const subagentUsage: { value: ReturnType<typeof getTokenUsage> } = {
    value: null,
  };
  const messages = (async () => {
    for await (const message of subagent.messages) {
      await Promise.all([
        consumeTextChunks(message.text, (content) => {
          streamedText += content;
          options.summaryRecorder.recordSubagentRawOutput({
            toolCallId,
            subagentType: subagent.name,
            content,
          });
        }),
        consumeTextChunks(message.reasoning, (content) => {
          options.summaryRecorder.recordSubagentThinking({
            toolCallId,
            subagentType: subagent.name,
            content,
          });
          push({
            type: "subagent-thinking",
            agentType: options.agentType,
            subagentType: subagent.name,
            toolCallId,
            content,
          });
        }),
      ]);
      subagentUsage.value =
        getTokenUsage(await message.output) ?? subagentUsage.value;
    }
  })();

  const [output] = await Promise.all([subagent.output, messages]);
  const result = extractSubagentOutput(output, streamedText);
  options.summaryRecorder.recordSubagentResult({
    toolCallId,
    subagentType: subagent.name,
    output: result,
  });
  push({
    type: "subagent-result",
    agentType: options.agentType,
    subagentType: subagent.name,
    toolCallId,
    result,
  });
  const selection = options.subagentSelections?.get(subagent.name);
  const tokenUsage = subagentUsage.value;
  if (tokenUsage && selection) {
    const cost = calculateCost(
      tokenUsage.cacheMissInputTokens,
      tokenUsage.cacheHitInputTokens,
      tokenUsage.outputTokens,
      toLlmPricing(selection),
    );
    push({
      type: "token-usage",
      agentType: subagent.name as AgentType,
      ...tokenUsage,
      ...cost,
      durationMs: Date.now() - startedAt,
    });
  }
}

/** 消费可回放的文本 projection。 */
async function consumeTextChunks(
  stream: AsyncIterable<string>,
  consume: (content: string) => void,
): Promise<void> {
  for await (const content of stream) {
    if (content) consume(content);
  }
}

/** 工具 schema 以对象为边界，非对象输入不进入现有 toolArgs 契约。 */
function normalizeToolInput(
  input: unknown,
): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

/** 从 SubAgent 最终状态提取与旧 task ToolMessage 等价的紧凑文本。 */
function extractSubagentOutput(output: unknown, streamedText: string): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const messages = (output as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && typeof lastMessage === "object") {
        const text = getTextContent(lastMessage as BaseMessage);
        if (text) return text;
      }
    }
  }

  return streamedText || output;
}

/**
 * 运行普通或携带 SubAgent 的 DeepAgent。
 */
export async function* runAgent<T, AgentType extends string>(
  options: RunAgentOptions<T, AgentType>,
): AsyncGenerator<AgentRunEvent<AgentType>, T, void> {
  const startTime = Date.now();
  const modelSelection = options.modelGroup
    ? resolveAgentModelSelection(options.modelProfile, options.modelGroup)
    : undefined;
  const subagentSelections = new Map<string, ResolvedAgentModelSelection>();
  for (const [name, group] of Object.entries(
    options.subagentModelGroups ?? {},
  )) {
    const selection = group
      ? resolveAgentModelSelection(options.modelProfile, group)
      : undefined;
    if (selection) subagentSelections.set(name, selection);
  }
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
    model:
      options.modelSummary ?? createModelSummarySnapshot(modelSelection),
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
  const runAbortController = new AbortController();
  const runSignal = options.signal
    ? AbortSignal.any([options.signal, runAbortController.signal])
    : runAbortController.signal;

  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions, modelSelection) as any,
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

    const run = await agent.streamEvents(
      {
        messages: [new HumanMessage(JSON.stringify(options.payload))],
        ...(hasSkillFiles ? { files: skillFiles } : {}),
      },
      {
        version: "v3",
        signal: runSignal,
      },
    );

    const streamResult = yield* adaptAgentEventStream(
      run as AgentEventStreamProjection,
      {
        agentType: options.agentType,
        visibleToolNames,
        summaryRecorder,
        subagentSelections,
        getToolResultError: options.getToolResultError,
      },
    );
    const { responseText, invokedSubagentTypes } = streamResult;
    tokenUsage = streamResult.tokenUsage;

    const tokenUsageSummary = tokenUsage
      ? { ...tokenUsage, durationMs: Date.now() - startTime }
      : undefined;
    if (tokenUsage) {
      const cost = calculateCost(
        tokenUsage.cacheMissInputTokens,
        tokenUsage.cacheHitInputTokens,
        tokenUsage.outputTokens,
        toLlmPricing(modelSelection),
      );
      yield {
        type: "token-usage",
        agentType: options.agentType,
        ...tokenUsage,
        ...cost,
        durationMs: Date.now() - startTime,
      };
    }

    const missingSubagent = getMissingRequiredSubagentError(
      options.requiredSubagentType,
      invokedSubagentTypes,
    );
    if (missingSubagent) {
      await summaryRecorder.finish({
        error: missingSubagent,
        status: "failed",
        tokenUsage: tokenUsageSummary,
      });
      throw new Error(missingSubagent);
    }

    const resolution = options.resolveOutput({
      text: responseText,
      tokenUsage,
      maxTokens:
        modelSelection?.model.maxTokens ?? options.modelOptions?.maxTokens,
    });
    if (resolution.success) {
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
    if (errorMessage.startsWith("required-subagent-not-invoked:")) {
      throw error;
    }
    if (options.throwOnError) {
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
  } finally {
    runAbortController.abort();
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
