/**
 * Agent Runtime LLM 配置管理
 *
 * 负责加载环境变量并提供统一的 LLM 配置接口。所有 Agent 的模型创建
 * 均通过 getLlmConfig() 获取 API Key、Base URL、模型名、温度、超时等参数。
 *
 * Responsibilities:
 * - 从 .env 文件加载环境变量
 * - 提供 LlmConfig 类型和 getLlmConfig() 工厂函数
 * - 对缺失的 OPENAI_API_KEY 抛出明确错误
 */

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
