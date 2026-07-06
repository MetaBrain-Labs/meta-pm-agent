/**
 * JSON Agent 通用执行器
 *
 * 为需要 JSON 结构化输出的 DeepAgent（如 Planner、Request Agent）提供统一的
 * 流式执行框架，负责消息构建、推理透传、最终 JSON 解析和确定性回退。
 *
 * Responsibilities:
 * - runJsonAgent()：创建并驱动 DeepAgent，解析最终 JSON 输出
 * - 定义 JSON_AGENT_MODEL_OPTIONS 默认模型参数（responseFormat: json_object）
 * - 定义 JsonAgentEvent / RunJsonAgentOptions 等类型
 * - JSON 解析失败时执行确定性 fallback，确保流程不被阻塞
 *
 * Notes:
 * - Planner Agent 和 Critique Agent 使用此执行器
 * - 支持 Zod schema 校验输出，校验失败时触发 fallback
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type StructuredTool,
} from "langchain";
import { createDeepAgent, type SubAgent } from "deepagents";
import { createChatModel, type ChatModelOptions } from "./model";
import { createDefaultAgentMiddleware } from "./middleware";
import { createDeepAgentToolAllowlistMiddleware } from "./deep-agent-tool-policy";
import { calculateCost } from "../../config";
import { parseJsonObject } from "../../utils/json";
import {
  createAgentRunSummaryMiddleware,
  createAgentRunSummaryRecorder,
} from "./agent-run-summary";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
} from "../../utils/message-adapter";

/**
 * 只输出 JSON 的 DeepAgent 默认模型参数，供结构化 Agent 复用。
 */
export const JSON_AGENT_MODEL_OPTIONS = {
  enableThinking: false,
  responseFormat: "json_object",
  temperature: 0,
} satisfies Omit<ChatModelOptions, "maxTokens">;

/**
 * JSON Agent 在解析最终 JSON 前允许透传的推理事件。
 */
export interface JsonAgentReasoningEvent<AgentType extends string> {
  type: "reasoning";
  agentType: AgentType;
  content: string;
}

export type JsonAgentEvent<AgentType extends string> =
  | JsonAgentReasoningEvent<AgentType>
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

/**
 * 结构化 JSON Agent 的运行配置。
 */
export interface RunJsonAgentOptions<T, AgentType extends string> {
  agentType: AgentType;
  agentLabel: string;
  name: string;
  modelOptions?: ChatModelOptions;
  systemPrompt: string;
  tools?: StructuredTool[];
  /** DeepAgents 技能目录 sources；不是单个技能名称。 */
  skills?: string[];
  /** DeepAgents 同步子代理配置；仅 Orchestrator 等明确需要委派的 Agent 使用。 */
  subagents?: SubAgent[];
  /** DeepAgents 内置工具白名单，例如启用子代理时需要允许 task。默认不作为用户可见工具流输出。 */
  allowedBuiltinToolNames?: string[];
  /** 需要透传给 SSE 和持久化摘要的 DeepAgents 内置工具名称。 */
  visibleBuiltinToolNames?: string[];
  payload: unknown;
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: unknown };
  };
  fallback: (reason: string) => T;
  suppressInvalidJsonReasoning?: boolean;
  signal?: AbortSignal;
  /** 当 DeepAgents task 工具返回 SubAgent 结果时回调，用于提取子代理的结构化产出。 */
  onTaskToolResult?: (content: unknown) => void;
}

/**
 * 运行只输出 JSON 的 DeepAgent，并在模型失败或格式错误时回退到确定性结果。
 */
export async function* runJsonAgent<T, AgentType extends string>(
  options: RunJsonAgentOptions<T, AgentType>,
): AsyncGenerator<JsonAgentEvent<AgentType>, T, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  const tools = options.tools ?? [];
  const allowedToolNames = [
    ...tools.map((tool) => tool.name),
    ...(options.allowedBuiltinToolNames ?? []),
    ...(options.visibleBuiltinToolNames ?? []),
  ];
  const visibleToolNames = [
    ...tools.map((tool) => tool.name),
    ...(options.visibleBuiltinToolNames ?? []),
  ];
  const visibleToolNameSet = new Set(visibleToolNames);
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: options.agentLabel,
    agentName: options.name,
    agentType: options.agentType,
    context: {
      modelOptions: options.modelOptions,
      payload: options.payload,
      skills: options.skills ?? [],
      subagents: compactSubagentDefinitions(options.subagents ?? []),
      systemPrompt: options.systemPrompt,
      tools: compactToolDefinitions(tools),
      allowedBuiltinToolNames: options.allowedBuiltinToolNames ?? [],
      visibleBuiltinToolNames: options.visibleBuiltinToolNames ?? [],
    },
  });

  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools,
      name: options.name,
      // 这里接收 DeepAgents 技能目录 sources；具体技能名由 source 内的 SKILL.md 声明。
      skills: options.skills ?? [],
      subagents: options.subagents ?? [],
      middleware: [
        createDeepAgentToolAllowlistMiddleware({
          agentName: options.name,
          allowedToolNames,
        }),
        ...createDefaultAgentMiddleware(),
        ...createAgentRunSummaryMiddleware(summaryRecorder),
      ] as any,
    });

    const run = await agent.stream(
      {
        messages: [new HumanMessage(JSON.stringify(options.payload))],
      },
      { streamMode: "messages", signal: options.signal },
    );

    let responseText = "";
    for await (const [message] of run) {
      for (const toolCall of getToolCalls(message, visibleToolNameSet)) {
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

      const toolResult = getToolResult(message, visibleToolNameSet);
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
        continue;
      }
      if (ToolMessage.isInstance(message)) {
        // 透出 task 工具返回的 SubAgent 结果，供上层提取结构化产出
        if (message.name === "task" && options.onTaskToolResult) {
          options.onTaskToolResult(message.content);
        }
        continue;
      }

      const reasoning = getReasoningContent(message);
      if (reasoning) {
        summaryRecorder.recordThinking(reasoning);
        yield {
          type: "reasoning",
          agentType: options.agentType,
          content: reasoning,
        };
      }
      const text = getTextContent(message);
      responseText += text;
      summaryRecorder.recordOutput(text);

      // 从每次 AIMessage 中累积 token 用量（最终消息包含完整统计）。
      const usage = getTokenUsage(message);
      if (usage) {
        tokenUsage = usage;
      }
    }

    // 在返回结构化结果前，输出该 Agent 的 token 用量和耗时。
    const tokenUsageSummary = tokenUsage
      ? {
          ...tokenUsage,
          durationMs: Date.now() - startTime,
        }
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
        inputTokens: tokenUsage.inputTokens,
        cacheHitInputTokens: tokenUsage.cacheHitInputTokens,
        cacheMissInputTokens: tokenUsage.cacheMissInputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        costInput: cost.costInput,
        costOutput: cost.costOutput,
        costTotal: cost.costTotal,
        durationMs: Date.now() - startTime,
      };
    }

    const parsed = parseJsonObject(responseText);
    if (parsed === null) {
      const invalidJsonReason = formatInvalidJsonReason(
        responseText,
        tokenUsage,
        options.modelOptions?.maxTokens,
      );
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

    const result = options.schema.safeParse(parsed);
    if (result.success) {
      await summaryRecorder.finish({
        output: result.data,
        status: "completed",
        tokenUsage: tokenUsageSummary,
      });
      return result.data;
    }

    const schemaError = `schema-validation: ${formatSchemaError(result.error)}`;
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
    if (char === "\"") {
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
 * 从模型消息中提取工具调用。
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
 * 从工具响应消息中提取工具结果。
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
