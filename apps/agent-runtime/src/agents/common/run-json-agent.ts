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
 * - Planner Agent 和 Planner Workflow Review 使用此执行器
 * - 支持 Zod schema 校验输出，校验失败时触发 fallback
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type StructuredTool,
} from "langchain";
import { createDeepAgent } from "deepagents";
import { createChatModel, type ChatModelOptions } from "./model";
import { parseJsonObject } from "../../utils/json";
import {
  getReasoningContent,
  getTextContent,
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
      toolName: string;
      toolArgs?: Record<string, unknown>;
      agentType: AgentType;
    }
  | {
      type: "tool-result";
      toolName: string;
      toolResult: unknown;
      agentType: AgentType;
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
  payload: unknown;
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: unknown };
  };
  fallback: (reason: string) => T;
  suppressInvalidJsonReasoning?: boolean;
  signal?: AbortSignal;
}

/**
 * 运行只输出 JSON 的 DeepAgent，并在模型失败或格式错误时回退到确定性结果。
 */
export async function* runJsonAgent<T, AgentType extends string>(
  options: RunJsonAgentOptions<T, AgentType>,
): AsyncGenerator<JsonAgentEvent<AgentType>, T, void> {
  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools: options.tools ?? [],
      name: options.name,
      // 这里接收 DeepAgents 技能目录 sources；具体技能名由 source 内的 SKILL.md 声明。
      skills: options.skills ?? [],
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
    }

    const parsed = parseJsonObject(responseText);
    const result = options.schema.safeParse(parsed);
    if (result.success) return result.data;

    if (!options.suppressInvalidJsonReasoning) {
      yield {
        type: "reasoning",
        agentType: options.agentType,
        content: `结构化输出校验失败，已使用 ${options.agentLabel} 的 MVP 回退结果。\n`,
      };
    }
    return options.fallback("invalid-json");
  } catch (error) {
    const message = getErrorMessage(error);
    yield {
      type: "reasoning",
      agentType: options.agentType,
      content: `${options.agentLabel} 执行失败，已使用 MVP 回退结果：${message}\n`,
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
