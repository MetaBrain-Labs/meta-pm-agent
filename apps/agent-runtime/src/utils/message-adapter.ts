/**
 * LangChain 消息适配器
 *
 * 提供 ChatMessage（API 层）与 LangChain BaseMessage（Agent 运行时）之间的
 * 双向转换，并集中处理推理内容、文本内容和 token 用量的读取。
 *
 * Responsibilities:
 * - 将 ChatMessage[] 转换为 LangChain HumanMessage / AIMessage
 * - 从 BaseMessage 中提取 reasoning_content 和纯文本 content
 * - 从 AIMessage 中提取 provider usage，并用 DeepSeek tokenizer 校正 completion token
 */

import { AIMessage, HumanMessage, type BaseMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";
import { countDeepSeekTokens } from "./deepseek-tokenizer";

/**
 * token 用量结构。
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 缓存命中的输入 token 数。 */
  cacheHitInputTokens: number;
  /** 缓存未命中的输入 token 数。 */
  cacheMissInputTokens: number;
}

/**
 * 将 ChatMessage 转换为 LangChain 消息。
 */
export function toLangChainMessages(
  messages: ChatMessage[],
): Array<HumanMessage | AIMessage> {
  return messages.map((message) => {
    if (message.role === "user") {
      return new HumanMessage(message.content);
    }

    return new AIMessage({
      content: message.content,
      ...(message.reasoningContent
        ? {
            additional_kwargs: {
              reasoning_content: message.reasoningContent,
            },
          }
        : {}),
    });
  });
}

/**
 * 从消息中读取推理内容。
 */
export function getReasoningContent(message: BaseMessage): string {
  const reasoning = message.additional_kwargs?.reasoning_content;
  if (typeof reasoning === "string") return reasoning;
  if (typeof message.content === "string") return "";

  return message.content
    .filter(
      (
        block,
      ): block is
        | { type: "reasoning"; reasoning: string }
        | { type: "thinking"; thinking: string } =>
        typeof block === "object" &&
        block !== null &&
        ((block.type === "reasoning" &&
          "reasoning" in block &&
          typeof block.reasoning === "string") ||
          (block.type === "thinking" &&
            "thinking" in block &&
            typeof block.thinking === "string")),
    )
    .map((block) =>
      block.type === "reasoning" ? block.reasoning : block.thinking,
    )
    .join("");
}

/**
 * 从消息中读取可见文本内容。
 */
export function getTextContent(message: BaseMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * 从 AIMessage 中提取 token 用量。
 *
 * provider usage 仍然是输入 token、缓存命中和官方计费的主来源；本地 DeepSeek
 * tokenizer 只用于 completion 侧兜底，避免兼容层漏报可见文本或推理文本时低估。
 */
export function getTokenUsage(message: BaseMessage): TokenUsage | null {
  if (!AIMessage.isInstance(message)) return null;

  const usage = message.usage_metadata as
    | Record<string, unknown>
    | undefined;
  const responseUsage = extractResponseMetadataUsage(message);
  if (!usage && !responseUsage) return null;

  const inputTokens =
    readNumber(usage, "input_tokens") ??
    readNumber(responseUsage, "input_tokens") ??
    readNumber(responseUsage, "prompt_tokens") ??
    readNumber(responseUsage, "promptTokens") ??
    0;
  const providerOutputTokens =
    readNumber(usage, "output_tokens") ??
    readNumber(responseUsage, "output_tokens") ??
    readNumber(responseUsage, "completion_tokens") ??
    readNumber(responseUsage, "completionTokens") ??
    0;
  const localOutputTokens = countDeepSeekTokens(
    `${getReasoningContent(message)}${getTextContent(message)}`,
  );
  const outputTokens = Math.max(providerOutputTokens, localOutputTokens ?? 0);
  const totalTokens = Math.max(
    readNumber(usage, "total_tokens") ??
      readNumber(responseUsage, "total_tokens") ??
      readNumber(responseUsage, "totalTokens") ??
      0,
    inputTokens + outputTokens,
  );

  const inputDetails = readObject(usage, "input_token_details");
  const cacheHitInputTokens =
    readNumber(inputDetails, "cache_read") ??
    readNumber(inputDetails, "cached_tokens") ??
    readNumber(responseUsage, "prompt_cache_hit_tokens") ??
    readNumber(responseUsage, "promptCacheHitTokens") ??
    0;
  const cacheMissInputTokens =
    readNumber(responseUsage, "prompt_cache_miss_tokens") ??
    readNumber(responseUsage, "promptCacheMissTokens") ??
    Math.max(0, inputTokens - cacheHitInputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheHitInputTokens,
    cacheMissInputTokens,
  };
}

/**
 * 从 LangChain response_metadata 中读取不同兼容接口暴露的原始 usage。
 */
function extractResponseMetadataUsage(
  message: BaseMessage,
): Record<string, unknown> | undefined {
  const metadata = (message as { response_metadata?: Record<string, unknown> })
    .response_metadata;
  if (!metadata) return undefined;

  const usage =
    readObject(metadata, "tokenUsage") ??
    readObject(metadata, "token_usage") ??
    readObject(metadata, "usage");
  return usage ?? metadata;
}

/**
 * 安全读取数字字段。
 */
function readNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const item = value?.[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

/**
 * 安全读取对象字段。
 */
function readObject(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const item = value?.[key];
  return item && typeof item === "object" && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : undefined;
}
