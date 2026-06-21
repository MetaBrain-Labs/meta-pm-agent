import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});

export interface LlmConfig {
  apiKey: string;
  baseURL: string;
  enableThinking: boolean;
  maxTokens: number;
  model: string;
  reasoningEffort: string;
  temperature: number;
  timeout: number;
}

/**
 * 获取LLM配置信息
 */
export function getLlmConfig(): LlmConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Please add it to your .env file.",
    );
  }

  return {
    apiKey,
    baseURL: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
    enableThinking: process.env.LLM_ENABLE_THINKING === "true",
    maxTokens: 4096,
    model: process.env.LLM_MODEL ?? "deepseek-chat",
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "high",
    temperature: 0.3,
    timeout: 30_000,
  };
}
