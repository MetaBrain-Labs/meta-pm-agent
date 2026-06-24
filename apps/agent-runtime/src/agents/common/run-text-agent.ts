/**
 * 文本 Agent 通用执行器
 *
 * 为非 JSON 输出的 DeepAgent（如 Executor Agent）提供统一的流式执行框架，
 * 管理消息构建、模型调用、推理和文本内容提取，并过滤内部工具/环境噪声。
 *
 * Responsibilities:
 * - runTextAgent()：创建并驱动 DeepAgent，按事件流提取推理/工具/文本内容
 * - 定义 TEXT_AGENT_MODEL_OPTIONS 默认模型参数
 * - 定义 TextAgentEvent / RunTextAgentOptions 等类型
 * - 过滤 DeepAgent 内部噪声（如 "No files found in /"）
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
import { calculateCost } from "../../config";
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
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType: AgentType;
    }
  | {
      type: "tool-result";
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
  payload: unknown;
  fallback: (reason: string) => string;
  signal?: AbortSignal;
}

/**
 * 运行输出自由文本的 DeepAgent，适用于 markdown 知识图谱补丁。
 */
export async function* runTextAgent<AgentType extends string>(
  options: RunTextAgentOptions<AgentType>,
): AsyncGenerator<TextAgentEvent<AgentType>, string, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;

  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools: options.tools ?? [],
      name: options.name,
      skills: [],
    });

    const run = await agent.stream(
      {
        messages: [new HumanMessage(JSON.stringify(options.payload))],
      },
      { streamMode: "messages", signal: options.signal },
    );

    const visibleToolNames = new Set(
      (options.tools ?? []).map((toolItem) => toolItem.name),
    );
    let responseText = "";
    for await (const [message] of run) {
      for (const toolCall of getToolCalls(message).filter((item) =>
        visibleToolNames.has(item.name),
      )) {
        yield {
          type: "tool-call",
          toolName: toolCall.name,
          toolArgs: toolCall.args,
          agentType: options.agentType,
        };
      }

      const toolResult = getToolResult(message);
      if (toolResult && visibleToolNames.has(toolResult.name)) {
        yield {
          type: "tool-result",
          toolName: toolResult.name,
          toolResult: toolResult.content,
          agentType: options.agentType,
        };
        continue;
      }
      if (toolResult) {
        // DeepAgents 内置工具结果只用于内部状态，不进入用户可见 SSE。
        continue;
      }

      const reasoning = getReasoningContent(message);
      if (reasoning) {
        yield {
          type: "reasoning",
          agentType: options.agentType,
          content: reasoning,
        };
      }
      responseText += getTextContent(message);

      // 从每次 AIMessage 中累积 token 用量（最终消息包含完整统计）。
      const usage = getTokenUsage(message);
      if (usage) {
        tokenUsage = usage;
      }
    }

    // 在返回最终文本前，输出该 Agent 的 token 用量和耗时。
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
    return patch || options.fallback("empty-output");
  } catch (error) {
    const message = getErrorMessage(error);
    yield {
      type: "reasoning",
      agentType: options.agentType,
      content: `${options.agentLabel} 执行失败，已使用知识图谱补丁回退结果：${message}\n`,
    };
    return options.fallback(message);
  }
}

/**
 * 提取异常的可读消息，避免把未知错误对象直接写入用户流。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 从模型消息中提取工具调用。
 */
function getToolCalls(
  message: BaseMessage,
): Array<{ name: string; args?: Record<string, unknown> }> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.name)
    .map((toolCall) => ({
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
): { name: string; content: unknown } | null {
  if (!ToolMessage.isInstance(message)) return null;

  return {
    name: message.name ?? "unknown",
    content: message.content,
  };
}
