/**
 * 文本 Agent 通用执行器
 *
 * 为非 JSON 输出的 DeepAgent（如 Executor Agent）提供统一的流式执行框架，
 * 管理消息构建、模型调用、推理和文本内容提取，并透传 DeepAgents 工具轨迹。
 *
 * Responsibilities:
 * - runTextAgent()：创建并驱动 DeepAgent，按事件流提取推理/工具/文本内容
 * - 定义 TEXT_AGENT_MODEL_OPTIONS 默认模型参数
 * - 定义 TextAgentEvent / RunTextAgentOptions 等类型
 * - 透传 DeepAgents 内置工具和业务授权工具，方便前端观察执行过程
 *
 * Notes:
 * - Executor Agent 使用此执行器产出 markdown 图谱补丁而非 JSON
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { createDeepAgent } from "deepagents";
import type { StructuredTool } from "langchain";
import { createChatModel, type ChatModelOptions } from "./model";
import { createDefaultAgentMiddleware } from "./middleware";
import { createDeepAgentToolAllowlistMiddleware } from "./deep-agent-tool-policy";
import { calculateCost } from "../../config";
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
 * 文本 Agent 默认模型参数，供非 JSON 结构化产出的 Agent 使用。
 */
export const TEXT_AGENT_MODEL_OPTIONS = {
  enableThinking: false,
  temperature: 0,
} satisfies Omit<ChatModelOptions, "maxTokens">;

/**
 * 文本 Agent 在最终文本前允许透传的推理事件。
 */
export interface TextAgentReasoningEvent<AgentType extends string> {
  type: "reasoning";
  agentType: AgentType;
  content: string;
}

export type TextAgentEvent<AgentType extends string> =
  | TextAgentReasoningEvent<AgentType>
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
 * 文本 Agent 的运行配置。
 */
export interface RunTextAgentOptions<AgentType extends string> {
  agentType: AgentType;
  agentLabel: string;
  name: string;
  modelOptions?: ChatModelOptions;
  systemPrompt: string;
  tools?: StructuredTool[];
  /** DeepAgents 技能目录 sources；具体技能由 source 内的 SKILL.md 声明。 */
  skills?: string[];
  payload: unknown;
  fallback: (reason: string) => string;
  signal?: AbortSignal;
  /** 是否把模型/工具运行时异常继续上抛，交给上层 workflow 决定是否 HITL。 */
  throwOnError?: boolean;
}

/**
 * 运行输出自由文本的 DeepAgent，适用于 markdown 知识图谱补丁。
 */
export async function* runTextAgent<AgentType extends string>(
  options: RunTextAgentOptions<AgentType>,
): AsyncGenerator<TextAgentEvent<AgentType>, string, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  const tools = options.tools ?? [];
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: options.agentLabel,
    agentName: options.name,
    agentType: options.agentType,
    context: {
      modelOptions: options.modelOptions,
      payload: options.payload,
      skills: options.skills ?? [],
      systemPrompt: options.systemPrompt,
      tools: compactToolDefinitions(tools),
    },
  });

  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools,
      name: options.name,
      skills: options.skills ?? [],
      middleware: [
        createDeepAgentToolAllowlistMiddleware({
          agentName: options.name,
          allowedToolNames: tools.map((tool) => tool.name),
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
      for (const toolCall of getToolCalls(message)) {
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

      const toolResult = getToolResult(message);
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

    // 在返回最终文本前，输出该 Agent 的 token 用量和耗时。
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

    const patch = responseText.trim();

    // 检测模型输出是否被 maxTokens 截断，防止静默丢失结构化写入产物。
    if (
      isModelOutputTruncated(tokenUsage, options.modelOptions?.maxTokens) &&
      !patch
    ) {
      const reason = `output-truncated: model reached maxTokens (${options.modelOptions?.maxTokens}) before completing`;
      const fallbackResult = options.fallback(reason);
      const truncateMsg = `${options.agentLabel} 输出疑似在模型 maxTokens 前被截断，已使用回退结果。\n`;
      summaryRecorder.recordThinking(truncateMsg);
      yield {
        type: "reasoning",
        agentType: options.agentType,
        content: truncateMsg,
      };
      await summaryRecorder.finish({
        error: reason,
        output: fallbackResult,
        status: "fallback",
        tokenUsage: tokenUsageSummary,
      });
      return fallbackResult;
    }

    const output = patch || options.fallback("empty-output");
    await summaryRecorder.finish({
      output,
      status: patch ? "completed" : "fallback",
      tokenUsage: tokenUsageSummary,
    });
    return output;
  } catch (error) {
    const message = getErrorMessage(error);
    if (options.throwOnError) {
      await summaryRecorder.finish({
        error: message,
        status: "failed",
      });
      throw error;
    }
    const fallbackResult = options.fallback(message);
    const content = `${options.agentLabel} 执行失败，已使用知识图谱补丁回退结果：${message}\n`;
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
 * 从模型消息中提取工具调用。
 */
function getToolCalls(
  message: BaseMessage,
): Array<{ id?: string; name: string; args?: Record<string, unknown> }> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.name)
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
): { id?: string; name: string; content: unknown } | null {
  if (!ToolMessage.isInstance(message)) return null;

  return {
    id: (message as { tool_call_id?: string }).tool_call_id,
    name: message.name ?? "unknown",
    content: message.content,
  };
}

/**
 * 判断模型输出是否已被 maxTokens 截断；此时未完成的文本和未调用的写入工具都会丢失。
 */
function isModelOutputTruncated(
  tokenUsage: ReturnType<typeof getTokenUsage>,
  maxTokens: number | undefined,
): boolean {
  return (
    typeof maxTokens === "number" &&
    tokenUsage !== null &&
    tokenUsage.outputTokens >= maxTokens
  );
}
