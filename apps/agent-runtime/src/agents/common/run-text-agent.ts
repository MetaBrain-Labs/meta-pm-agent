import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { createDeepAgent } from "deepagents";
import type { StructuredTool } from "langchain";
import { createChatModel, type ChatModelOptions } from "./model";
import {
  getReasoningContent,
  getTextContent,
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

    let responseText = "";
    for await (const [message] of run) {
      for (const toolCall of getToolCalls(message)) {
        yield {
          type: "tool-call",
          toolName: toolCall.name,
          toolArgs: toolCall.args,
          agentType: options.agentType,
        };
      }

      const toolResult = getToolResult(message);
      if (toolResult) {
        yield {
          type: "tool-result",
          toolName: toolResult.name,
          toolResult: toolResult.content,
          agentType: options.agentType,
        };
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
