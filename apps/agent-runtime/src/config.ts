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
 * LLM 定价配置（元/百万tokens）。
 * 区分缓存命中（cache hit）与缓存未命中（cache miss）的输入 token 定价。
 */
export interface LlmPricing {
  /** 缓存未命中输入 */
  inputPricePerMillion: number;
  /** 缓存命中输入 */
  cacheHitInputPricePerMillion: number;
  /** 输出 */
  outputPricePerMillion: number;
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
    model: process.env.LLM_MODEL ?? "deepseek-flash",
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "high",
    temperature: 0.3,
    timeout: 30_000,
  };
}

/**
 * 获取 LLM 定价配置（元/百万 tokens），默认使用 DeepSeek 当前高峰价估算快照。
 * 实际账单始终以模型服务商为准。
 */
export function getLlmPricing(): LlmPricing {
  return {
    inputPricePerMillion: parseFloat(
      process.env.LLM_INPUT_PRICE_PER_MILLION ?? "2",
    ),
    cacheHitInputPricePerMillion: parseFloat(
      process.env.LLM_CACHE_HIT_INPUT_PRICE_PER_MILLION ?? "0.04",
    ),
    outputPricePerMillion: parseFloat(
      process.env.LLM_OUTPUT_PRICE_PER_MILLION ?? "8",
    ),
  };
}

/**
 * 根据 token 数量和定价配置计算费用（元）。
 * 输入侧区分为缓存命中（cacheHitInputTokens）与缓存未命中（cacheMissInputTokens）。
 */
export function calculateCost(
  cacheMissInputTokens: number,
  cacheHitInputTokens: number,
  outputTokens: number,
  pricing?: LlmPricing,
): { costInput: number; costOutput: number; costTotal: number } {
  const price = pricing ?? getLlmPricing();
  const costInput =
    (cacheMissInputTokens / 1_000_000) * price.inputPricePerMillion +
    (cacheHitInputTokens / 1_000_000) * price.cacheHitInputPricePerMillion;
  const costOutput = (outputTokens / 1_000_000) * price.outputPricePerMillion;
  return {
    costInput: roundCost(costInput),
    costOutput: roundCost(costOutput),
    costTotal: roundCost(costInput + costOutput),
  };
}

/**
 * 成本四舍五入到小数点后第8位，避免浮点精度问题。
 */
function roundCost(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
