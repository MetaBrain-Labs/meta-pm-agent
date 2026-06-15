import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { getLlmConfig } from "./config";
import { DISCOVERY_PROMPT } from "./prompts/discovery";

export function createConversationAgent() {
  const config = getLlmConfig();
  const modelKwargs: Record<string, unknown> = {};

  if (config.enableThinking) {
    modelKwargs.thinking = { type: "enabled" };
    modelKwargs.reasoning_effort = config.reasoningEffort;
  }

  const model = new ChatOpenAI({
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

  return createDeepAgent({
    model: model as any,
    systemPrompt: DISCOVERY_PROMPT,
    tools: [],
    name: "conversation-agent",
    skills: [],
  });
}
