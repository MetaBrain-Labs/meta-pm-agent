import { HumanMessage } from "langchain";
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

/**
 * 结构化 JSON Agent 的运行配置。
 */
export interface RunJsonAgentOptions<T, AgentType extends string> {
  agentType: AgentType;
  agentLabel: string;
  name: string;
  modelOptions?: ChatModelOptions;
  systemPrompt: string;
  payload: unknown;
  schema: {
    safeParse(value: unknown):
      | { success: true; data: T }
      | { success: false; error: unknown };
  };
  fallback: (reason: string) => T;
  signal?: AbortSignal;
}

/**
 * 运行只输出 JSON 的 DeepAgent，并在模型失败或格式错误时回退到确定性结果。
 */
export async function* runJsonAgent<T, AgentType extends string>(
  options: RunJsonAgentOptions<T, AgentType>,
): AsyncGenerator<JsonAgentReasoningEvent<AgentType>, T, void> {
  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools: [],
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

    yield {
      type: "reasoning",
      agentType: options.agentType,
      content: `结构化输出校验失败，已使用 ${options.agentLabel} 的 MVP 回退结果。\n`,
    };
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
