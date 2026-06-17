import { ChatOpenAI } from "@langchain/openai";
import { getLlmConfig } from "../../config";

/**
 * 创建所有 Agent 共用的聊天模型实例，统一读取 LLM 配置和 thinking 参数。
 */
export function createChatModel() {
  const config = getLlmConfig();
  const modelKwargs: Record<string, unknown> = {};

  if (config.enableThinking) {
    modelKwargs.thinking = { type: "enabled" };
    modelKwargs.reasoning_effort = config.reasoningEffort;
  }

  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeout: config.timeout,
    configuration: { baseURL: config.baseURL },
    modelKwargs: Object.keys(modelKwargs).length > 0
      ? modelKwargs
      : undefined,
  });
}
