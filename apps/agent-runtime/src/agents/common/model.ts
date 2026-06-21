import { ChatOpenAI } from "@langchain/openai";
import { getLlmConfig } from "../../config";

/**
 * 单个 Agent 覆盖默认模型参数的配置。
 */
export interface ChatModelOptions {
  enableThinking?: boolean;
  maxTokens?: number;
  responseFormat?: "json_object";
  temperature?: number;
}

/**
 * 创建所有 Agent 共用的聊天模型实例，统一读取 LLM 配置，并允许特定 Agent 覆盖结构化输出参数。
 */
export function createChatModel(options: ChatModelOptions = {}) {
  const config = getLlmConfig();
  const modelKwargs: Record<string, unknown> = {};
  const enableThinking = options.enableThinking ?? config.enableThinking;

  if (enableThinking) {
    modelKwargs.thinking = { type: "enabled" };
    modelKwargs.reasoning_effort = config.reasoningEffort;
  }
  if (options.responseFormat) {
    modelKwargs.response_format = { type: options.responseFormat };
  }

  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    temperature: options.temperature ?? config.temperature,
    maxTokens: options.maxTokens ?? config.maxTokens,
    timeout: config.timeout,
    configuration: { baseURL: config.baseURL },
    modelKwargs: Object.keys(modelKwargs).length > 0
      ? modelKwargs
      : undefined,
  });
}
